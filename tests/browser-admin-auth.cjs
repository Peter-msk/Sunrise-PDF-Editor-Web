'use strict';
// End-to-end administrator security with an ACTUAL Chromium browser and local
// SQLite schema. Only synthetic credentials; never contacts production.
const assert=require('node:assert/strict'),fs=require('node:fs'),https=require('node:https'),os=require('node:os'),path=require('node:path');
const {execFileSync}=require('node:child_process');
const {webcrypto}=require('node:crypto');globalThis.crypto ||=webcrypto;
const {DatabaseSync}=require('node:sqlite');
const {chromium}=require('playwright');
const root=path.resolve(__dirname,'..'),publicDir=path.join(root,'dist');
const account='admin',bootstrap='synthetic-setup-only-token-2026-10-31-very-long';
const initial='synthetic-admin-password-very-long-2026',changed='completely-different-admin-password-2026';
const mime={'.html':'text/html;charset=utf-8','.js':'text/javascript;charset=utf-8','.css':'text/css;charset=utf-8'};
async function main(){
 const sqlite=new DatabaseSync(':memory:');
 for(const file of ['0001_inquiries_and_site_updates.sql','0002_admin_analytics.sql','0003_password_admin.sql','0004_publication_lifetime.sql'])
  sqlite.exec(fs.readFileSync(path.join(root,'migrations',file),'utf8'));
 const DB={prepare(sql){const stmt=sqlite.prepare(sql);
   return {args:[],bind(...items){this.args=items;return this},async first(){return stmt.get(...this.args)||null},
    async all(){return {results:stmt.all(...this.args)}},
    async run(){const x=stmt.run(...this.args);return {meta:{changes:x.changes}}}};
 }};
 const env={DB,ADMIN_BOOTSTRAP_TOKEN:bootstrap,INQUIRY_HASH_SALT:'synthetic-secret-server-only-HMAC-2026',
  ASSETS:{async fetch(request){
   const pathname=decodeURIComponent(new URL(request.url).pathname);
   const file=path.resolve(publicDir,'.'+(pathname.endsWith('/')?pathname+'index.html':pathname));
   if(!file.startsWith(publicDir+path.sep))return new Response('Forbidden',{status:403});
   try{return new Response(fs.readFileSync(file),{headers:{'content-type':mime[path.extname(file)]||'application/octet-stream'}})}
   catch{return new Response('Not found',{status:404})}
  }}};
 const {default:worker}=await import('../src/worker.mjs');
 const serve=async(req,res)=>{
  try{
   const url='http://'+req.headers.host+req.url;
   let body; if(req.method==='POST'||req.method==='PATCH'){
    const chunks=[];for await(const chunk of req)chunks.push(chunk);body=Buffer.concat(chunks);
   }
   const input=new Request(url,{method:req.method,headers:req.headers,body});
   const output=await worker.fetch(input,env,{});
   res.statusCode=output.status;
   for(const [key,value] of output.headers)res.setHeader(key,value);
   res.end(Buffer.from(await output.arrayBuffer()));
  }catch(error){console.error('Local auth route failure',error);res.writeHead(500);res.end('Error')}
 };
 // A __Host- Secure cookie requires real HTTPS, even for local E2E.
 // Ephemeral self-signed cert is isolated to the CI temp directory.
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'sunrise-auth-https-'));
 const certFile=path.join(temp,'cert.pem'),keyFile=path.join(temp,'key.pem');
 execFileSync('openssl',['req','-x509','-nodes','-newkey','rsa:2048','-keyout',keyFile,
   '-out',certFile,'-days','1','-subj','/CN=127.0.0.1',
   '-addext','subjectAltName=IP:127.0.0.1'],{stdio:'ignore'});
 const server=https.createServer({key:fs.readFileSync(keyFile),cert:fs.readFileSync(certFile)},(req,res)=>{serve(req,res)});
 let browser;
 try{
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve)});
  const base='https://127.0.0.1:'+server.address().port;
  browser=await chromium.launch({headless:true,args:['--no-sandbox']});
  const first=await browser.newContext({viewport:{width:1250,height:820},ignoreHTTPSErrors:true}),
   second=await browser.newContext({ignoreHTTPSErrors:true});
  const page=await first.newPage(),other=await second.newPage(),errors=[];
  page.on('pageerror',e=>errors.push(e.message));other.on('pageerror',e=>errors.push(e.message));

  await page.goto(base+'/admin/setup/');
  await page.locator('[name=bootstrapToken]').fill(bootstrap);
  await page.locator('[name=username]').fill(account);
  await page.locator('[name=password]').fill(initial);
  await page.locator('[name=confirm]').fill(initial);
  await page.locator('#submit').click();
  try{await page.waitForURL(base+'/admin/login/',{timeout:15000})}
  catch(error){
   console.error('Setup browser state:',{
    url:page.url(),
    status:await page.locator('#status').textContent().catch(()=>null),
    formVisible:await page.locator('#authForm').isVisible().catch(()=>null),
    pageErrors:errors
   });
   throw error;
  }
  assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM admin_accounts').get().n,1);
  const saved=sqlite.prepare('SELECT password_hash,password_salt FROM admin_accounts').get();
  assert(saved.password_salt.startsWith('browser-pbkdf2-v1:'));
  assert(!JSON.stringify(saved).includes(initial),'plaintext password cannot be saved');

  async function login(p,password){
   await p.goto(base+'/admin/login/');
   await p.locator('[name=username]').fill(account);
   await p.locator('[name=password]').fill(password);
   await p.locator('#submit').click();
   await p.waitForURL(base+'/admin/',{timeout:35000});
  }
  await login(page,initial);
  const cookies=await first.cookies(base);
  const sessionCookie=cookies.find(c=>c.name==='__Host-sunrise_pdf_admin');
  assert(sessionCookie,'secure __Host cookie must be persisted by Chromium');
  assert(sessionCookie.secure&&sessionCookie.httpOnly&&sessionCookie.sameSite==='Strict');
  await login(other,initial);
  assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM admin_sessions').get().n,2);

  await page.goto(base+'/admin/password/');
  await page.locator('[name=oldPassword]').fill(initial);
  await page.locator('[name=newPassword]').fill(changed);
  await page.locator('[name=confirmPassword]').fill(changed);
  await page.locator('#submitButton').click();
  await page.waitForURL(base+'/admin/login/',{timeout:35000});
  assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM admin_sessions').get().n,0,'password change revokes ALL sessions');
  const oldSession=await other.evaluate(async()=>{const r=await fetch('/api/auth/me');return r.status});
  assert.equal(oldSession,401,'second browser must lose authorization after rotation');
  assert.equal((await other.goto(base+'/admin/password/')).url(),base+'/admin/login/');
  await login(page,changed);
  assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM admin_sessions').get().n,1);
  const oldVerifier=sqlite.prepare('SELECT password_hash FROM admin_accounts').get().password_hash;
  assert(!oldVerifier.includes(changed));
  // Logout invalidates the current cookie and prevents access to private APIs.
  await page.evaluate(async()=>{const r=await fetch('/api/auth/logout',{method:'POST',headers:{'content-type':'application/json'},body:'{}'});if(!r.ok)throw Error('logout failed')});
  assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM admin_sessions').get().n,0);
  assert.equal(await page.evaluate(async()=>{return (await fetch('/api/auth/me')).status}),401);
  assert.equal(errors.length,0,'Browser JS errors: '+errors.join(' | '));
  console.log('PASS: real Chromium + SQLite setup/login in 2 browser contexts, secure cookie, rotate all sessions, new login and logout');
  await first.close();await second.close();
 }finally{
  await browser?.close();
  await new Promise(resolve=>server.close(resolve));
  sqlite.close();fs.rmSync(temp,{recursive:true,force:true});
 }
}
main().catch(error=>{console.error('Administrator real-browser security:',error);process.exitCode=1});
