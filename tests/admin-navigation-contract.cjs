'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
(async()=>{
 const fixture=require('./helpers/d1-sqlite.cjs').createD1Fixture();
 try{
  const worker=(await import('../src/worker.mjs')).default;
  const origin='https://example.test';
  const routed=[];
  const env={DB:fixture.db,ADMIN_BOOTSTRAP_TOKEN:'fixture-bootstrap-only-token-12345678901234567890',INQUIRY_HASH_SALT:'PRIVATE_FIXTURE_VERIFIER_SECRET',ASSETS:{fetch:async req=>{routed.push(new URL(req.url).pathname);return new Response('ADMIN_SHELL',{status:200})}}};
  const call=(p,opts={})=>worker.fetch(new Request(origin+p,opts),env,{});
  const paths=['overview','usage','errors','inquiries','publications','system','security'];
  for(const view of paths){
   const response=await call('/admin/'+view+'/');
   assert.equal(response.status,302,'anonymous '+view+' page must redirect');
   assert.equal(response.headers.get('location'),origin+'/admin/login/');
  }
  assert.equal(routed.length,0,'no private page asset served to anonymous visitors');
  const json=(data)=>JSON.stringify(data);
  const headers={'origin':origin,'content-type':'application/json'};
  let response=await call('/api/auth/setup',{method:'POST',headers,body:json({username:'admin',passwordProof:'a'.repeat(64),passwordSalt:'b'.repeat(32),bootstrapToken:env.ADMIN_BOOTSTRAP_TOKEN})});
  assert.equal(response.status,201);
  response=await call('/api/auth/login',{method:'POST',headers,body:json({username:'admin',passwordProof:'a'.repeat(64)})});
  assert.equal(response.status,200);
  const cookie=response.headers.get('set-cookie').split(';')[0];
  for(const view of paths){
   response=await call('/admin/'+view+'/',{headers:{cookie}});
   assert.equal(response.status,200,'authenticated '+view+' page');
   assert.equal(await response.text(),'ADMIN_SHELL');
   assert.equal(routed.at(-1),'/admin/','all views share vetted admin shell');
   response=await call('/admin/'+view+'/',{method:'POST',headers:{cookie}});
   assert.equal(response.status,405,'no write methods to navigation routes');
  }
  assert.equal((await call('/api/admin/diagnostics',{headers:{cookie}})).status,200,'diagnostics API remains protected and operational');
  response=await call('/api/admin/diagnostics');
  assert.equal(response.status,401);
  const html=fs.readFileSync('dist/admin/index.html','utf8');
  for(const view of paths)assert(html.includes('data-admin-link="'+view+'"'),'missing navigation link '+view);
  for(const id of ['adminMenuToggle','adminSidebar','adminPageTitle','diagnosticRows','inquiryRows','publicationForm','sessionsRevoke','visitsToday'])assert(html.includes('id="'+id+'"'),'original element missing '+id);
  assert(html.includes('popstate')&&html.includes('aria-current')&&html.includes('history.pushState'),'navigation history and accessibility contract');
  console.log('PASS: seven authenticated admin routes, protected APIs, navigation markup and no regression to form IDs');
 }finally{fixture.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
