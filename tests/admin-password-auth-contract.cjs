const assert=require('node:assert/strict');
const fs=require('node:fs');
const {webcrypto}=require('node:crypto');globalThis.crypto ||=webcrypto;
const toHex=x=>Buffer.from(x).toString('hex');
async function browserProof(password,salt,iterations=600000){
 const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(password),'PBKDF2',false,['deriveBits']);
 return toHex(await crypto.subtle.deriveBits({name:'PBKDF2',salt:Buffer.from(salt,'hex'),iterations,hash:'SHA-256'},key,256));
}
(async()=>{
 const {default:worker}=await import('../src/worker.mjs');
 const origin='https://example.test';
 const accounts={value:null},sessions=new Map(),attempts=[],limits=new Map();
 const db={prepare(sql){return {
  args:[],bind(...args){this.args=args;return this},
  async first(){
   if(sql.includes('SELECT id FROM admin_accounts'))return accounts.value?{id:1}:null;
   if(sql.includes('SELECT password_salt FROM admin_accounts'))return accounts.value?{password_salt:accounts.value.password_salt}:null;
   if(sql.startsWith('INSERT INTO admin_login_limits')){
    attempts.push(this.args);const key=this.args[0],count=(limits.get(key)||0)+1;limits.set(key,count);return {attempts:count,blocked_until_ms:count>=5?Date.now()+900000:0};
   }
   if(sql.includes('SELECT id,username,password_salt,password_hash,iterations'))return accounts.value;
   if(sql.startsWith('UPDATE admin_sessions SET last_seen_ms')){
    const [,key,now,cutoff]=this.args,session=sessions.get(key);
    return session&&session.expires_ms>now&&session.last_seen_ms>cutoff?{admin_id:1}:null;
   }
   if(sql.includes('SELECT username FROM admin_accounts'))return accounts.value?{username:accounts.value.username}:null;
   if(sql.startsWith('SELECT COALESCE(SUM(visits)'))return {visits:0,seconds:0};
   if(sql.startsWith('SELECT COALESCE(visits'))return {visits:0,seconds:0};
   return null;
  },
  async run(){
   if(sql.startsWith('INSERT OR IGNORE INTO admin_accounts')){
    if(accounts.value)return {meta:{changes:0}};
    const [username,password_salt,password_hash,iterations]=this.args;
    accounts.value={id:1,username,password_salt,password_hash,iterations};return {meta:{changes:1}};
   }
   if(sql.startsWith('INSERT INTO admin_sessions')){
    const [hash,id,created,last,expiry]=this.args;
    sessions.set(hash,{id,created_ms:created,last_seen_ms:last,expires_ms:expiry});return {meta:{changes:1}};
   }
   if(sql.startsWith('DELETE FROM admin_sessions')){sessions.delete(this.args[0]);return {meta:{changes:1}};}
   return {meta:{changes:1}};
  },
  async all(){return {results:[]}}
 }}};
 const env={DB:db,ASSETS:{fetch:async()=>new Response('admin protected asset')},INQUIRY_HASH_SALT:'server-test-only-key-must-stay-secret',ADMIN_BOOTSTRAP_TOKEN:'random-test-bootstrap-token-1234567890-abcd'};
 const request=(path,options={})=>new Request(origin+path,options);
 const post=(path,body,withEnv=env)=>worker.fetch(request(path,{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify(body)}),withEnv,{});
 const username='admin',password='correct-horse-battery-staple';
 let response=await worker.fetch(request('/admin/'),env,{});
 assert.equal(response.status,302);
 response=await worker.fetch(request('/api/admin/overview'),env,{});
 assert.equal(response.status,401);
 response=await worker.fetch(request('/api/auth/challenge'),env,{});
 assert.equal(response.status,200);
 assert.match((await response.json()).salt,/^[a-f0-9]{32}$/);
 const salt='0123456789abcdef0123456789abcdef',proof=await browserProof(password,salt);
 const registration={username,passwordSalt:salt,passwordProof:proof,bootstrapToken:env.ADMIN_BOOTSTRAP_TOKEN};
 response=await post('/api/auth/setup',registration,{...env,ADMIN_BOOTSTRAP_TOKEN:undefined});
 assert.equal(response.status,503);
 assert.equal(attempts.length,0,'missing setup secret must not be rate-limited');
 for(let i=0;i<5;i++){
  response=await post('/api/auth/setup',{...registration,bootstrapToken:'wrong-test-bootstrap-token-at-least-32-bytes'});
  assert.equal(response.status,i===4?429:403);
 }
 response=await post('/api/auth/setup',registration);
 assert.equal(response.status,201,'valid bootstrap token must bypass previous invalid-token blocks');
 assert.equal(accounts.value.username,username);
 assert.equal(accounts.value.password_salt,'browser-pbkdf2-v1:'+salt);
 assert.equal(accounts.value.iterations,600000);
 assert.notEqual(accounts.value.password_hash,proof);
 assert.match(accounts.value.password_hash,/^[a-f0-9]{64}$/);
 response=await worker.fetch(request('/api/auth/challenge'),env,{});
 const challenge=await response.json();
 assert.equal(challenge.salt,salt);
 assert.equal(challenge.iterations,600000);
 response=await post('/api/auth/setup',registration);assert.equal(response.status,409);
 response=await post('/api/auth/login',{username,passwordProof:await browserProof('incorrect-password-123456789',salt)});
 assert.equal(response.status,401);
 response=await post('/api/auth/login',{username,passwordProof:proof});
 assert.equal(response.status,200);
 const cookie=response.headers.get('set-cookie');assert(cookie.includes('HttpOnly'));assert(cookie.includes('Secure'));
 assert(cookie.includes('SameSite=Strict'));assert(cookie.includes('Max-Age=28800'));
 const cookieHeader=cookie.split(';')[0];
 response=await worker.fetch(request('/admin/',{headers:{cookie:cookieHeader}}),env,{});
 assert.equal(response.status,200);assert.equal(await response.text(),'admin protected asset');
 response=await worker.fetch(request('/api/admin/overview',{headers:{cookie:cookieHeader}}),env,{});
 assert.equal(response.status,200);
 response=await worker.fetch(request('/api/admin/inquiries',{headers:{cookie:cookieHeader}}),env,{});
 assert.equal(response.status,200);
 response=await worker.fetch(request('/api/auth/logout',{method:'POST',headers:{origin,'content-type':'application/json',cookie:cookieHeader},body:'{}'}),env,{});
 assert.equal(response.status,200);assert(response.headers.get('set-cookie').includes('Max-Age=0'));
 response=await worker.fetch(request('/api/admin/overview',{headers:{cookie:cookieHeader}}),env,{});
 assert.equal(response.status,401);
 const client=fs.readFileSync('dist/assets/sunrise-admin-login.js','utf8');
 assert(client.includes('crypto.subtle.deriveBits'),'browser must perform PBKDF2');
 assert(client.includes('content-type'),'frontend must reject non-JSON replies without a JSON syntax error');
 assert(!client.includes('password,bootstrapToken'),'raw password must not be posted');
 assert(attempts.length>=6);
 console.log('PASS: first registration and login use browser PBKDF2 and server-only HMAC; rate limits, secure session, logout, HTML error handling');
})().catch(error=>{console.error(error);process.exitCode=1});
