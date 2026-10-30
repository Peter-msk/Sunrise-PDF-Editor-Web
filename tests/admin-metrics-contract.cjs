const assert=require('node:assert/strict'),fs=require('node:fs');
const {webcrypto}=require('node:crypto');globalThis.crypto ||= webcrypto;
(async()=>{
 const {default:worker}=await import('../src/worker.mjs');
 const origin='https://example.test';
 let visits=0,seconds=0,errors=0;
 const db={prepare(sql){return {
   args:[],bind(...args){this.args=args;return this},
   async run(){
     if(sql.startsWith('INSERT OR IGNORE INTO analytics_sessions'))visits++;
     if(sql.includes('INSERT INTO analytics_daily')&&sql.includes('editor_seconds'))seconds+=Number(this.args[1]);
     if(sql.includes('INSERT INTO analytics_errors'))errors++;
     return {meta:{changes:1}};
   },
   async first(){
     if(sql.startsWith('UPDATE analytics_sessions'))return {session_id:'ok'};
     return null;
   },
   async all(){return {results:[]}}
 }}};
 const ctx={access:{getIdentity:async()=>({email:'admin@example.test'})}};
 const env={DB:db,ASSETS:{fetch:async()=>new Response('ADMIN_OK')},ADMIN_EMAIL:'admin@example.test',INQUIRY_HASH_SALT:'test'};
 const request=(url,opts)=>new Request(origin+url,opts);
 let res=await worker.fetch(request('/admin/'),env,{});
 assert.equal(res.status,403,'Admin UI must deny when Access not present');
 res=await worker.fetch(request('/api/admin/overview'),env,{});
 assert.equal(res.status,403,'No public admin API');
 res=await worker.fetch(request('/admin/'),{...env,ADMIN_EMAIL:'other@example.test'},ctx);
 assert.equal(res.status,403,'A different authenticated user must not access admin');
 res=await worker.fetch(request('/admin/'),env,ctx);
 assert.equal(res.status,200);assert.equal(await res.text(),'ADMIN_OK');
 res=await worker.fetch(request('/api/admin/overview'),env,ctx);
 assert.equal(res.status,200);const metrics=await res.json();
 assert.equal(metrics.visits.today,0);assert.equal(metrics.usage.total,0);
 const session='123e4567-e89b-42d3-a456-426614174000';
 const event=(payload,headers={'origin':origin,'content-type':'application/json'})=>
   worker.fetch(request('/api/telemetry',{method:'POST',headers,body:JSON.stringify(payload)}),env,{});
 res=await event({type:'visit',session});assert.equal(res.status,200);assert.equal(visits,1);
 res=await event({type:'pulse',session,area:'editor',seconds:15});assert.equal(res.status,200);assert.equal(seconds,15);
 res=await event({type:'failure',session,feature:'압축'});assert.equal(res.status,200);assert.equal(errors,1);
 res=await event({type:'failure',session,feature:'private PDF title'});assert.equal(res.status,400);
 res=await event({type:'visit',session},{'origin':'https://evil.test','content-type':'application/json'});assert.equal(res.status,403);
 res=await event({type:'pulse',session,area:'editor',seconds:999});assert.equal(res.status,400);
 assert.equal((await worker.fetch(request('/api/admin/inquiries?status=all'),env,ctx)).status,200);
 const admin=fs.readFileSync('dist/admin/index.html','utf8'),integrate=fs.readFileSync('scripts/site-integration.cjs','utf8'),settings=fs.readFileSync('wrangler.toml','utf8');
 for(const label of ['오늘 방문 세션','금주 방문 세션','누적 방문 세션','오늘 편집기 활성 사용시간','누적 편집기 활성 사용시간','기능별 오류','문의사항'])assert(admin.includes(label),label);
 assert(integrate.includes('adminNavButton')&&integrate.includes('sunrise-telemetry.js'));
 assert(settings.includes('"/admin/*"')&&settings.includes('"/api/*"'));
 console.log('PASS: admin Access authentication, aggregate metrics, telemetry whitelist, browser instrumentation and dashboard');
})().catch(e=>{console.error(e);process.exitCode=1});
