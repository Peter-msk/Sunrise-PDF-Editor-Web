const assert=require('node:assert/strict');
const {webcrypto}=require('node:crypto');globalThis.crypto ||=webcrypto;
(async()=>{
 const {default:worker}=await import('../src/worker.mjs');
 const origin='https://example.test';
 const accounts={value:null},sessions=new Map(),attempts=[];
 const db={prepare(sql){const statement={args:[],bind(...args){this.args=args;return this},
  async first(){
   if(sql.includes('SELECT id FROM admin_accounts'))return accounts.value?{id:1}:null;
   if(sql.startsWith('INSERT INTO admin_login_limits')){attempts.push(this.args);return {attempts:1,blocked_until_ms:0}}
   if(sql.includes('SELECT id,username,password_salt,password_hash,iterations'))return accounts.value;
   if(sql.startsWith('UPDATE admin_sessions SET last_seen_ms')){
    const [,key,now,cutoff]=this.args;const item=sessions.get(key);
    return item&&item.expires_ms>now&&item.last_seen_ms>cutoff?{admin_id:1}:null;
   }
   if(sql.includes('SELECT username FROM admin_accounts'))return accounts.value?{username:accounts.value.username}:null;
   if(sql.startsWith('SELECT COALESCE(SUM(visits)'))return {visits:0,seconds:0};
   if(sql.startsWith('SELECT COALESCE(visits'))return {visits:0,seconds:0};
   if(sql.startsWith('SELECT COALESCE(SUM(visits)'))return {visits:0};
   throw new Error('Unhandled first '+sql);
  },
  async run(){
   if(sql.startsWith('INSERT OR IGNORE INTO admin_accounts')){
    if(accounts.value)return {meta:{changes:0}};
    const [username,password_salt,password_hash,iterations]=this.args;
    accounts.value={id:1,username,password_salt,password_hash,iterations};return {meta:{changes:1}};
   }
   if(sql.startsWith('INSERT INTO admin_sessions')){const [hash,id,created,last,expiry]=this.args;sessions.set(hash,{id,created_ms:created,last_seen_ms:last,expires_ms:expiry});return {meta:{changes:1}}}
   if(sql.startsWith('DELETE FROM admin_sessions')){sessions.delete(this.args[0]);return {meta:{changes:1}}}
   return {meta:{changes:1}};
  },
  async all(){return {results:[]}}
 };return statement}};
 const env={DB:db,ASSETS:{fetch:async()=>new Response('admin protected asset')},INQUIRY_HASH_SALT:'test-only-key',ADMIN_BOOTSTRAP_TOKEN:'super-long-bootstrap-token-with-high-entropy-123456789'};
 const request=(path,options={})=>new Request(origin+path,options);
 const post=(path,body,extra={})=>worker.fetch(request(path,{method:'POST',headers:{origin,'content-type':'application/json',...extra},body:JSON.stringify(body)}),env,{});
 let r=await worker.fetch(request('/admin/'),env,{});
 assert.equal(r.status,302);
 r=await worker.fetch(request('/api/admin/overview'),env,{});
 assert.equal(r.status,401);
 r=await post('/api/auth/setup',{bootstrapToken:'wrong',username:'admin',password:'correct-horse-battery-staple'});
 assert.equal(r.status,403);
 r=await post('/api/auth/setup',{bootstrapToken:env.ADMIN_BOOTSTRAP_TOKEN,username:'admin',password:'correct-horse-battery-staple'});
 assert.equal(r.status,201);assert.equal(accounts.value.username,'admin');
 assert.notEqual(accounts.value.password_hash,'correct-horse-battery-staple');
 assert.equal(accounts.value.password_hash.length,64);
 assert.equal(accounts.value.iterations,600000);
 r=await post('/api/auth/setup',{bootstrapToken:env.ADMIN_BOOTSTRAP_TOKEN,username:'other',password:'this-is-long-enough-to-use'});
 assert.equal(r.status,409);
 r=await post('/api/auth/login',{username:'admin',password:'wrong-password-123456789'});
 assert.equal(r.status,401);
 r=await post('/api/auth/login',{username:'admin',password:'correct-horse-battery-staple'});
 assert.equal(r.status,200);
 const cookie=r.headers.get('set-cookie');assert(cookie.includes('HttpOnly'));assert(cookie.includes('Secure'));assert(cookie.includes('SameSite=Strict'));assert(cookie.includes('Max-Age=28800'));
 const cookieHeader=cookie.split(';')[0];
 r=await worker.fetch(request('/admin/',{headers:{cookie:cookieHeader}}),env,{});
 assert.equal(r.status,200);assert.equal(await r.text(),'admin protected asset');
 r=await worker.fetch(request('/api/admin/overview',{headers:{cookie:cookieHeader}}),env,{});
 assert.equal(r.status,200);
 r=await worker.fetch(request('/api/admin/inquiries',{headers:{cookie:cookieHeader}}),env,{});
 assert.equal(r.status,200);
 r=await worker.fetch(request('/api/auth/logout',{method:'POST',headers:{origin,'content-type':'application/json',cookie:cookieHeader},body:'{}'}),env,{});
 assert.equal(r.status,200);assert(r.headers.get('set-cookie').includes('Max-Age=0'));
 r=await worker.fetch(request('/api/admin/overview',{headers:{cookie:cookieHeader}}),env,{});
 assert.equal(r.status,401,'Deleted session must not be reusable');
 const state=await worker.fetch(request('/api/auth/status'),env,{});
 assert.equal((await state.json()).configured,true);
 assert(attempts.length>=3);
 console.log('PASS: password-only registration, password hashing, login, secure cookie, admin gates, and session revocation');
})().catch(e=>{console.error(e);process.exitCode=1});
