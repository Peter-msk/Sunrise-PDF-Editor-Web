// Password-only, single-admin authentication for Sunrise PDF Editor.
// Cloudflare Access is not required. Fail closed until an operator configures
// a high-entropy ADMIN_BOOTSTRAP_TOKEN secret and registers the first account.
const COOKIE='__Host-sunrise_pdf_admin';
const ITERATIONS=600000, ABS_MS=8*60*60*1000, IDLE_MS=30*60*1000;
const LIMIT_WINDOW_MS=15*60*1000;
const json=(value,status=200,extra={})=>new Response(JSON.stringify(value),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff',...extra}});
const digest=async data=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(data))),x=>x.toString(16).padStart(2,'0')).join('');
const randomHex=n=>Array.from(crypto.getRandomValues(new Uint8Array(n)),x=>x.toString(16).padStart(2,'0')).join('');
const originOK=(req,url)=>req.headers.get('Origin')===url.origin;
const credentialsOK=(username,password)=>typeof username==='string'&&/^[a-z][a-z0-9._-]{3,31}$/.test(username)&&typeof password==='string'&&password.length>=16&&password.length<=128&&!/[\u0000-\u001f\u007f]/.test(password);
async function passwordHash(password,salt,iterations){
 const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(password),'PBKDF2',false,['deriveBits']);
 const bits=await crypto.subtle.deriveBits({name:'PBKDF2',salt:Uint8Array.from(salt.match(/../g),x=>parseInt(x,16)),iterations,hash:'SHA-256'},key,256);
 return Array.from(new Uint8Array(bits),x=>x.toString(16).padStart(2,'0')).join('');
}
function equalDigest(a,b){if(!a||!b||a.length!==b.length)return false;let diff=0;for(let i=0;i<a.length;i++)diff|=a.charCodeAt(i)^b.charCodeAt(i);return diff===0}
async function payload(request){
 if(!request.headers.get('content-type')?.toLowerCase().startsWith('application/json'))return null;
 if(Number(request.headers.get('content-length')||0)>4096)return null;
 let text;try{text=await request.text()}catch{return null}
 if(text.length>4096)return null;
 try{const value=JSON.parse(text);return value&&typeof value==='object'&&!Array.isArray(value)?value:null}catch{return null}
}
function cookieValue(request){
 const cookie=request.headers.get('cookie')||'';
 const parts=cookie.split(';').map(x=>x.trim());
 const found=parts.find(x=>x.startsWith(COOKIE+'='));
 const token=found?.slice(COOKIE.length+1);
 return token&&/^[a-f0-9]{64}$/.test(token)?token:null;
}
function sessionCookie(token,maxAge){
 return COOKIE+'='+(token||'')+'; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age='+maxAge;
}
export async function getAdminSession(request,env){
 if(!env?.DB)return null;
 const token=cookieValue(request);if(!token)return null;
 const now=Date.now(),hash=await digest(token);
 const existing=await env.DB.prepare('UPDATE admin_sessions SET last_seen_ms=? WHERE token_hash=? AND expires_ms>? AND last_seen_ms>? RETURNING admin_id').bind(now,hash,now,now-IDLE_MS).first();
 if(!existing)return null;
 const account=await env.DB.prepare('SELECT username FROM admin_accounts WHERE id=?').bind(existing.admin_id).first();
 return account?.username||null;
}
async function throttle(request,env,namespace){
 const ip=request.headers.get('cf-connecting-ip')||'unknown';
 if(!env.INQUIRY_HASH_SALT)return false;
 const key=await digest(env.INQUIRY_HASH_SALT+':admin:'+namespace+':'+ip);
 const now=Date.now();
 const item=await env.DB.prepare(
  'INSERT INTO admin_login_limits(key,window_start_ms,attempts,blocked_until_ms) VALUES (?, ?, 1, 0) '+
  'ON CONFLICT(key) DO UPDATE SET attempts=CASE WHEN window_start_ms<? THEN 1 ELSE attempts+1 END, '+
  'window_start_ms=CASE WHEN window_start_ms<? THEN ? ELSE window_start_ms END, '+
  'blocked_until_ms=CASE WHEN window_start_ms>=? AND attempts>=4 THEN ? ELSE 0 END RETURNING attempts,blocked_until_ms'
 ).bind(key,now,now-LIMIT_WINDOW_MS,now-LIMIT_WINDOW_MS,now,now-LIMIT_WINDOW_MS,now+LIMIT_WINDOW_MS).first();
 return !item||item.blocked_until_ms>now;
}
async function configured(env){return !!(await env.DB.prepare('SELECT id FROM admin_accounts WHERE id=1').first())}
export async function authRoutes(request,env,url){
 const path=url.pathname,method=request.method,db=env.DB;
 if(path==='/api/auth/status'&&method==='GET'){
  return json({configured:await configured(env),setupEnabled:!!env.ADMIN_BOOTSTRAP_TOKEN});
 }
 if(path==='/api/auth/me'&&method==='GET'){
  const user=await getAdminSession(request,env);
  return user?json({authenticated:true,username:user}):json({authenticated:false},401);
 }
 if(!['/api/auth/setup','/api/auth/login','/api/auth/logout'].includes(path))return json({error:'요청한 인증 경로가 없습니다.'},404);
 if(method!=='POST')return json({error:'허용되지 않은 요청입니다.'},405,{Allow:'POST'});
 if(!originOK(request,url))return json({error:'잘못된 요청 출처입니다.'},403);
 if(path==='/api/auth/logout'){
  const token=cookieValue(request);
  if(token)await db.prepare('DELETE FROM admin_sessions WHERE token_hash=?').bind(await digest(token)).run();
  return json({ok:true},200,{'set-cookie':sessionCookie('',0)});
 }
 const data=await payload(request);
 if(!data)return json({error:'입력 형식을 확인하세요.'},400);
 if(await throttle(request,env,path==='/api/auth/setup'?'setup':'login'))return json({error:'로그인 시도 제한입니다. 15분 후 다시 시도하세요.'},429);
 if(path==='/api/auth/setup'){
  if(await configured(env))return json({error:'관리자 계정은 이미 등록되어 있습니다.'},409);
  const token=data.bootstrapToken;
  if(typeof token!=='string'||token.length<32||token.length>256||!env.ADMIN_BOOTSTRAP_TOKEN){
   return json({error:'관리자 초기 설정을 확인하세요.'},403);
  }
  if(!equalDigest(await digest(token),await digest(env.ADMIN_BOOTSTRAP_TOKEN))){
   return json({error:'관리자 초기 설정을 확인하세요.'},403);
  }
  if(!credentialsOK(data.username,data.password))return json({error:'아이디는 영문 소문자 4~32자, 비밀번호는 16~128자로 지정하세요.'},400);
  const salt=randomHex(16),hash=await passwordHash(data.password,salt,ITERATIONS);
  const result=await db.prepare('INSERT OR IGNORE INTO admin_accounts(id,username,password_salt,password_hash,iterations) VALUES (1,?,?,?,?)').bind(data.username,salt,hash,ITERATIONS).run();
  if(!result.meta?.changes)return json({error:'관리자 계정은 이미 등록되어 있습니다.'},409);
  return json({ok:true,message:'관리자 계정이 등록되었습니다. 로그인해 주세요.'},201);
 }
 const account=await db.prepare('SELECT id,username,password_salt,password_hash,iterations FROM admin_accounts WHERE id=1').first();
 if(!account)return json({error:'관리자 계정 등록이 필요합니다.'},503);
 // Calculate the PBKDF2 hash even for an unknown user to reduce username probing.
 const candidate=typeof data.password==='string'&&data.password.length<=128&&data.password.length>0?data.password:'invalid';
 const derived=await passwordHash(candidate,account.password_salt,account.iterations);
 if(typeof data.username!=='string'||data.username!==account.username||!equalDigest(derived,account.password_hash)){
  return json({error:'아이디 또는 비밀번호가 올바르지 않습니다.'},401);
 }
 const token=randomHex(32),now=Date.now();
 await db.prepare('INSERT INTO admin_sessions(token_hash,admin_id,created_ms,last_seen_ms,expires_ms) VALUES (?,?,?,?,?)')
  .bind(await digest(token),account.id,now,now,now+ABS_MS).run();
 return json({ok:true},200,{'set-cookie':sessionCookie(token,ABS_MS/1000)});
}
