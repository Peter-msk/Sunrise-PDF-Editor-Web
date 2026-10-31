const assert=require('node:assert/strict');
const {webcrypto}=require('node:crypto');globalThis.crypto||=webcrypto;
const toHex=x=>Buffer.from(x).toString('hex');
async function derive(password,salt){
 const k=await crypto.subtle.importKey('raw',new TextEncoder().encode(password),'PBKDF2',false,['deriveBits']);
 return toHex(await crypto.subtle.deriveBits({name:'PBKDF2',salt:Buffer.from(salt,'hex'),iterations:600000,hash:'SHA-256'},k,256));
}
(async()=>{
 const {default:worker}=await import('../src/worker.mjs');
 const origin='https://unit.test',sessions=new Map();
 let account=null;
 const DB={prepare(sql){return {
  args:[],bind(...args){this.args=args;return this},
  async first(){
   if(sql.startsWith('SELECT id FROM admin_accounts'))return account?{id:1}:null;
   if(sql.startsWith('SELECT id,username,password_salt,password_hash FROM admin_accounts'))return account;
   if(sql.startsWith('SELECT id,username,password_salt,password_hash,iterations FROM admin_accounts'))return account;
   if(sql.startsWith('SELECT password_salt FROM admin_accounts'))return account?{password_salt:account.password_salt}:null;
   if(sql.startsWith('SELECT username,updated_at FROM admin_accounts'))return account?{username:account.username,updated_at:account.updated_at}:null;
   if(sql.startsWith('UPDATE admin_sessions SET last_seen_ms')){
    const [,key,now,idle]=this.args,s=sessions.get(key);
    if(!s||s.expires_ms<=now||s.last_seen_ms<=idle)return null;
    s.last_seen_ms=now;return {admin_id:1,created_ms:s.created_ms};
   }
   if(sql.startsWith('INSERT INTO admin_login_limits'))return {attempts:1,blocked_until_ms:0};
   return null;
  },
  async run(){
   if(sql.startsWith('INSERT OR IGNORE INTO admin_accounts')){
    if(account)return {meta:{changes:0}};
    const [username,salt,hash,iterations]=this.args;
    account={id:1,username,password_salt:salt,password_hash:hash,iterations,updated_at:null};return {meta:{changes:1}};
   }
   if(sql.startsWith('INSERT INTO admin_sessions')){
    const [hash,id,created,last,expires_ms]=this.args;
    sessions.set(hash,{id,created_ms:created,last_seen_ms:last,expires_ms});return {meta:{changes:1}};
   }
   if(sql.startsWith('UPDATE admin_accounts SET password_salt=')){
    const [salt,hash,iterations,original]=this.args;
    if(!account||account.password_hash!==original)return {meta:{changes:0}};
    account={...account,password_salt:salt,password_hash:hash,iterations,updated_at:new Date().toISOString()};
    return {meta:{changes:1}};
   }
   if(sql.startsWith('DELETE FROM admin_sessions WHERE admin_id=1')){sessions.clear();return {meta:{changes:1}};
   }
   if(sql.startsWith('DELETE FROM admin_sessions WHERE token_hash=')){sessions.delete(this.args[0]);return {meta:{changes:1}}}
   return {meta:{changes:0}};
  },
  async all(){return {results:[]}}
 }}};
 const env={DB,ASSETS:{fetch:async()=>new Response('admin-only')},INQUIRY_HASH_SALT:'test-server-secret-for-password-verifier',ADMIN_BOOTSTRAP_TOKEN:'random-test-bootstrap-token-length-48-abcdef'};
 const req=(path,opt)=>new Request(origin+path,opt);
 const post=(path,data,cookie='',reqOrigin=origin)=>worker.fetch(req(path,{method:'POST',headers:{origin:reqOrigin,'content-type':'application/json',...(cookie?{cookie}:{})},body:JSON.stringify(data)}),env,{});
 const oldPassword='correct-horse-battery-staple',newPassword='another-correct-password-2026';
 const oldSalt='0123456789abcdef0123456789abcdef',newSalt='fedcba9876543210fedcba9876543210';
 const oldProof=await derive(oldPassword,oldSalt),newProof=await derive(newPassword,newSalt);
 let r=await post('/api/auth/setup',{username:'admin',bootstrapToken:env.ADMIN_BOOTSTRAP_TOKEN,passwordSalt:oldSalt,passwordProof:oldProof});
 assert.equal(r.status,201);
 r=await post('/api/auth/login',{username:'admin',passwordProof:oldProof});
 assert.equal(r.status,200);const cookie=r.headers.get('set-cookie').split(';')[0];
 r=await post('/api/auth/change-password',{currentProof:oldProof,newSalt,newProof});
 assert.equal(r.status,401,'unauthenticated change must not modify password');
 r=await post('/api/auth/change-password',{currentProof:oldProof,newSalt,newProof},cookie,'https://attacker.test');
 assert.equal(r.status,403,'cross-origin change forbidden');
 r=await post('/api/auth/change-password',{currentProof:await derive('wrong-old-password-xxxx',oldSalt),newSalt,newProof},cookie);
 assert.equal(r.status,401,'incorrect old password rejected');
 assert.equal(account.password_salt,'browser-pbkdf2-v1:'+oldSalt);
 r=await post('/api/auth/change-password',{currentProof:oldProof,newSalt,newProof},cookie);
 assert.equal(r.status,200);assert.equal((await r.json()).ok,true);
 assert(r.headers.get('set-cookie').includes('Max-Age=0'));
 assert.equal(account.password_salt,'browser-pbkdf2-v1:'+newSalt);
 assert.equal(sessions.size,0,'all sessions must be revoked');
 r=await worker.fetch(req('/api/auth/me',{headers:{cookie}}),env,{});
 assert.equal(r.status,401,'old cookie unusable after password update');
 r=await post('/api/auth/login',{username:'admin',passwordProof:oldProof});
 assert.equal(r.status,401,'old password must not log in');
 r=await post('/api/auth/login',{username:'admin',passwordProof:newProof});
 assert.equal(r.status,200,'new password logs in');
 const path=await worker.fetch(req('/admin/password/',{headers:{cookie:r.headers.get('set-cookie').split(';')[0]}}),env,{});
 assert.equal(path.status,200);
 console.log('PASS: password rotation requires valid session, old password proof and same origin; all sessions revoked, new password succeeds');
})().catch(error=>{console.error(error);process.exitCode=1});
