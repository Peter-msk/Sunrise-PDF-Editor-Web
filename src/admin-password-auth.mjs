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
// PBKDF2 (600k SHA-256) runs in the user's browser to stay within
// Cloudflare Workers Free 10ms CPU budget. Treat the derived key as a
// password-equivalent secret, and bind it to a server-only keyed verifier.
const SCHEME='browser-pbkdf2-v1:';
const isHex=(value,length)=>typeof value==='string'&&value.length===length&&/^[a-f0-9]+$/.test(value);
const credentialsOK=(username,proof,salt)=>typeof username==='string'&&/^[a-z][a-z0-9._-]{3,31}$/.test(username)&&isHex(proof,64)&&isHex(salt,32);
async function passwordVerifier(proof,salt,env){
 if(!env.INQUIRY_HASH_SALT)throw new Error('Admin verifier secret unavailable');
 const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(env.INQUIRY_HASH_SALT),{name:'HMAC',hash:'SHA-256'},false,['sign']);
 const signature=await crypto.subtle.sign('HMAC',key,new TextEncoder().encode('sunrise-admin-password-v1:'+salt+':'+proof));
 return Array.from(new Uint8Array(signature),x=>x.toString(16).padStart(2,'0')).join('');
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
 const existing=await env.DB.prepare('UPDATE admin_sessions SET last_seen_ms=? WHERE token_hash=? AND expires_ms>? AND last_seen_ms>? RETURNING admin_id,created_ms').bind(now,hash,now,now-IDLE_MS).first();
 if(!existing)return null;
 const account=await env.DB.prepare('SELECT username,updated_at FROM admin_accounts WHERE id=?').bind(existing.admin_id).first();
 if(!account)return null;
 // A password rotation invalidates all sessions created before that change,
 // even if later session table cleanup fails.
 const changed=account.updated_at?Date.parse(account.updated_at):0;
 return Number.isFinite(changed)&&changed>0&&existing.created_ms<=changed?null:account.username;
}
async function throttle(request,env,namespace){
 const ip=request.headers.get('cf-connecting-ip')||'unknown';
 if(!env.INQUIRY_HASH_SALT)throw new Error('Admin rate limiter secret is required');
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
 if(path==='/api/auth/challenge'&&method==='GET'){
  const account=await db.prepare('SELECT password_salt FROM admin_accounts WHERE id=1').first();
  const salt=typeof account?.password_salt==='string'&&account.password_salt.startsWith(SCHEME)?account.password_salt.slice(SCHEME.length):randomHex(16);
  return json({salt,iterations:ITERATIONS});
 }
 if(path==='/api/auth/me'&&method==='GET'){
  const user=await getAdminSession(request,env);
  return user?json({authenticated:true,username:user}):json({authenticated:false},401);
 }
 if(path==='/api/auth/sessions'&&method==='GET'){
  const user=await getAdminSession(request,env);
  if(!user)return json({error:'관리자 로그인이 필요합니다.'},401);
  const now=Date.now();
  const account=await db.prepare('SELECT updated_at FROM admin_accounts WHERE id=1').first();
  const changed=account?.updated_at?Date.parse(account.updated_at):0;
  if(!Number.isFinite(changed))return json({error:'계정 상태를 확인하지 못했습니다.'},503);
  const count=await db.prepare('SELECT COUNT(*) count FROM admin_sessions WHERE admin_id=1 AND expires_ms>? AND last_seen_ms>? AND created_ms>?').bind(now,now-IDLE_MS,changed).first();
  return json({activeSessions:Number(count?.count||0),idleMinutes:IDLE_MS/60000,absoluteHours:ABS_MS/3600000});
 }
 if(!['/api/auth/setup','/api/auth/login','/api/auth/logout','/api/auth/logout-all','/api/auth/change-password'].includes(path))return json({error:'요청한 인증 경로가 없습니다.'},404);
 if(method!=='POST')return json({error:'허용되지 않은 요청입니다.'},405,{Allow:'POST'});
 if(!originOK(request,url))return json({error:'잘못된 요청 출처입니다.'},403);
 if(path==='/api/auth/logout-all'){
  if(!await getAdminSession(request,env))return json({error:'관리자 로그인이 필요합니다.'},401);
  await db.prepare('DELETE FROM admin_sessions WHERE admin_id=1').run();
  return json({ok:true},200,{'set-cookie':sessionCookie('',0)});
 }
 if(path==='/api/auth/logout'){
  const token=cookieValue(request);
  if(token)await db.prepare('DELETE FROM admin_sessions WHERE token_hash=?').bind(await digest(token)).run();
  return json({ok:true},200,{'set-cookie':sessionCookie('',0)});
 }
 const data=await payload(request);
 if(!data)return json({error:'입력 형식을 확인하세요.'},400);
 if(path==='/api/auth/change-password'){
  const user=await getAdminSession(request,env);
  if(!user)return json({error:'관리자 로그인이 필요합니다.'},401);
  if(!isHex(data.currentProof,64)||!isHex(data.newProof,64)||!isHex(data.newSalt,32)){
   return json({error:'비밀번호 변경 요청 형식을 확인하세요.'},400);
  }
  const account=await db.prepare('SELECT id,username,password_salt,password_hash FROM admin_accounts WHERE id=1').first();
  if(!account||account.username!==user||!String(account.password_salt).startsWith(SCHEME)){
   return json({error:'관리자 계정 상태를 확인하지 못했습니다.'},503);
  }
  const oldSalt=account.password_salt.slice(SCHEME.length);
  if(data.newSalt===oldSalt)return json({error:'새 비밀번호를 위해 새로운 암호화 설정이 필요합니다.'},400);
  const oldVerifier=await passwordVerifier(data.currentProof,oldSalt,env);
  if(!equalDigest(oldVerifier,account.password_hash)){
   if(await throttle(request,env,'change-password'))return json({error:'비밀번호 확인에 실패했습니다. 15분 후 다시 시도하세요.'},429);
   return json({error:'기존 비밀번호가 올바르지 않습니다.'},401);
  }
  const newVerifier=await passwordVerifier(data.newProof,data.newSalt,env);
  // The browser rejects unchanged plaintext. Different salts intentionally
  // produce different proofs, so the server does not claim to compare them.
  const updated=await db.prepare("UPDATE admin_accounts SET password_salt=?,password_hash=?,iterations=?,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=1 AND password_hash=?")
   .bind(SCHEME+data.newSalt,newVerifier,ITERATIONS,account.password_hash).run();
  if(updated.meta?.changes!==1)return json({error:'다른 비밀번호 변경 요청이 처리되었습니다. 다시 로그인하세요.'},409);
  await db.prepare('DELETE FROM admin_sessions WHERE admin_id=1').run();
  return json({ok:true,message:'비밀번호가 변경됐습니다. 모든 관리자 세션이 종료됩니다.'},200,{'set-cookie':sessionCookie('',0)});
 }
 if(path==='/api/auth/setup'){
  if(await configured(env))return json({error:'관리자 계정은 이미 등록되어 있습니다.'},409);
  // A missing bootstrap secret is a setup problem, not a failed login attempt.
  if(!env.ADMIN_BOOTSTRAP_TOKEN)return json({error:'초기 등록용 비밀값이 아직 적용되지 않았습니다. Cloudflare Worker 설정을 확인해 주세요.'},503);
  const token=data.bootstrapToken;
  if(typeof token!=='string'||token.length<32||token.length>256)return json({error:'초기 설정 토큰은 32~256자로 입력해야 합니다.'},400);
  if(!credentialsOK(data.username,data.passwordProof,data.passwordSalt))return json({error:'관리자 인증 정보 형식을 확인해 주세요.'},400);
  // Valid possession of the strong bootstrap token overrides stale setup
  // rate limits. Only incorrect tokens are throttled in a fresh namespace.
  if(!equalDigest(await digest(token),await digest(env.ADMIN_BOOTSTRAP_TOKEN))){
   if(await throttle(request,env,'setup-invalid-v2'))return json({error:'초기 설정 토큰 오류가 반복되었습니다. 15분 후 다시 시도하세요.'},429);
   return json({error:'초기 설정 토큰이 올바르지 않습니다.'},403);
  }
  const salt=data.passwordSalt,hash=await passwordVerifier(data.passwordProof,salt,env);
  const result=await db.prepare('INSERT OR IGNORE INTO admin_accounts(id,username,password_salt,password_hash,iterations) VALUES (1,?,?,?,?)').bind(data.username,SCHEME+salt,hash,ITERATIONS).run();
  if(!result.meta?.changes)return json({error:'관리자 계정은 이미 등록되어 있습니다.'},409);
  return json({ok:true,message:'관리자 계정이 등록되었습니다. 로그인해 주세요.'},201);
 }
 const account=await db.prepare('SELECT id,username,password_salt,password_hash,iterations FROM admin_accounts WHERE id=1').first();
 if(!account)return json({error:'관리자 계정 등록이 필요합니다.'},503);
 if(await throttle(request,env,'login'))return json({error:'로그인 시도 제한입니다. 15분 후 다시 시도하세요.'},429);
 // A legacy server-side PBKDF2 record must be migrated, never silently weakened.
 if(typeof account.password_salt!=='string'||!account.password_salt.startsWith(SCHEME))return json({error:'기존 인증 기록을 관리자가 점검해야 합니다.'},503);
 const salt=account.password_salt.slice(SCHEME.length);
 if(!isHex(data.passwordProof,64))return json({error:'아이디 또는 비밀번호가 올바르지 않습니다.'},401);
 const verifier=await passwordVerifier(data.passwordProof,salt,env);
 if(typeof data.username!=='string'||data.username!==account.username||!equalDigest(verifier,account.password_hash)){
  return json({error:'아이디 또는 비밀번호가 올바르지 않습니다.'},401);
 }
 const token=randomHex(32),now=Date.now();
 await db.prepare('INSERT INTO admin_sessions(token_hash,admin_id,created_ms,last_seen_ms,expires_ms) VALUES (?,?,?,?,?)')
  .bind(await digest(token),account.id,now,now,now+ABS_MS).run();
 return json({ok:true},200,{'set-cookie':sessionCookie(token,ABS_MS/1000)});
}
