'use strict';
// DEV2: strict backwards-compatible Trace v2 contract on real local SQLite/D1.
// No customer document data, file name, stack, IP or raw exception is sent.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const rules=require('../src/assets/sunrise-diagnostics.js');
const {createD1Fixture}=require('./helpers/d1-sqlite.cjs');
const uuid=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
const origin='https://sunrise.example';
const poison='SECRET_CLIENT_NAME.pdf abc@example.com /private/documents/ ID123';
(async()=>{
 const specs=[
  ['batch_split','batch_copy_failed','copy_pages','batch_pages','copy_start'],
  ['open','read_failed','read_file','document_open','read_failed'],
  ['save_prepare','save_verify_failed','verify_saved_bytes','document_save','verify_start'],
  ['page_duplicate','page_save_failed','serialize_pages','page_editor','save_start'],
  ['page_delete','page_display_failed','refresh_pages','page_editor','render_start']
 ];
 const old=rules.createTrace('batch_split');old.mark('copy_start');old.mark('copy_failed');
 const past=old.failure('batch_copy_failed');
 assert(past);
 assert(rules.normalizeTrace({...past,client_release:'trace2-dev1-20261109'}),'DEV1 records must remain valid');
 assert.equal(rules.normalizeTrace({...past,client_release:'trace2-dev0-unknown'}),null);
 assert.equal(rules.normalizeTrace({...past,feature:'open',client_release:'trace2-dev1-20261109'}),null);
 assert.equal(rules.normalizeTrace({...past,feature:{toString:null}}),null);
 assert.equal(rules.normalizeTrace({...past,id:{toString:null}}),null);
 assert.equal(rules.normalize({code:{toString:null},phase:'read'}),null);
 assert.equal(rules.createTrace('unknown'),null);
 assert(rules.createTrace('page_rotate'),'DEV3 instruments rotation via the safe generic operation boundary');
 for(const [feature,code,callsite,module,step] of specs){
  const t=rules.createTrace(feature);assert(t,feature);
  t.mark(step);t.structure({has_digital_signature:false,has_acroform:null});
  const trace=t.failure(code);assert(trace&&rules.normalizeTrace(trace));
  assert.equal(trace.feature,feature);assert.equal(trace.callsite,callsite);assert.equal(trace.module,module);
  assert.equal(trace.client_release,rules.TRACE_BUILD);
  const captured={...rules.capture({sunriseDiagnosticCode:code,message:poison},{origin:'file',bytes:100,pageCount:5,ua:'Edg/132'}),trace};
  assert.deepEqual(rules.normalize(captured),captured);
  for(const violation of [
   {...trace,module:poison},{...trace,callsite:'untrustedFunction'},
   {...trace,structure:{...trace.structure,fileName:poison}},
   {...trace,steps:[...trace.steps,{step:'verify_start',duration:'0to99',message:poison}]},
   {...trace,steps:Array(13).fill(trace.steps[0])},
   {...trace,code:specs.find(v=>v[0]!==feature)[1]},
   {...trace,client_release:poison}
  ])assert.equal(rules.normalizeTrace(violation),null,'reject forged or private trace');
  assert(!JSON.stringify(captured).includes(poison));
  assert.equal(t.failure(code),null,'trace only finalizes once');
 }
 const {sqlite,db,close}=createD1Fixture();
 try{
  const {telemetry,adminApi}=await import('../src/admin-api.mjs');
  const worker= (await import('../src/worker.mjs')).default;
  const today=new Date(Date.now()+9*3600000).toISOString().slice(0,10);
  const env={DB:db,CF_VERSION_METADATA:{id:'11111111-1111-4111-8111-111111111111'}};
  const session=uuid(1);
  const send=async data=>telemetry(new Request(origin+'/api/telemetry',{
   method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify({session,...data})}),env,new URL(origin+'/api/telemetry'));
  const query=async path=>{const url=new URL(origin+path);return adminApi(new Request(url),env,url,'admin')};
  assert.equal((await send({type:'visit'})).status,200);
  const traceIds=[];
  for(const [i,[feature,code,callsite,module,step]] of specs.entries()){
   const operationId=uuid(40+i);
   const traceRecorder=rules.createTrace(feature);
   traceRecorder.mark(step);traceRecorder.mark(step.endsWith('start')?'save_failed':step);
   const trace=traceRecorder.failure(code);
   traceIds.push(trace.id);
   const diagnostic={...rules.capture({sunriseDiagnosticCode:code,message:poison},{origin:'file',bytes:45612,pages:3,ua:'Edg/132'}),trace};
   assert.equal((await send({type:'operation',operationId,feature,stage:'started'})).status,200);
   assert.equal((await send({type:'operation',operationId,feature,stage:'failed',diagnostic})).status,200);
   assert.equal((await send({type:'operation',operationId,feature,stage:'failed',diagnostic})).status,200,'retry is idempotent');
   assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM analytics_diagnostics WHERE trace_id=?').get(trace.id).n,1);
   const one=sqlite.prepare('SELECT trace_json,feature,code FROM analytics_diagnostics WHERE trace_id=?').get(trace.id);
   assert.equal(one.feature,feature);assert.equal(one.code,code);assert.equal(JSON.parse(one.trace_json).callsite,callsite);
   assert(!one.trace_json.includes(poison));
   const response=await query('/api/admin/diagnostic-traces?days=14&feature='+encodeURIComponent(feature));
   assert.equal(response.status,200);
   const list=await response.json();assert(list.items.some(x=>x.id===trace.id));
   assert(!JSON.stringify(list).includes(session));
  }
  // Legacy record remains queryable after DEV2 (no migration or data conversion).
  const legacy=rules.createTrace('batch_split');legacy.mark('copy_start');
  const legacyRaw={...legacy.failure('batch_copy_failed'),client_release:'trace2-dev1-20261109'};
  const legacyId=uuid(90);
  assert.equal((await send({type:'operation',operationId:legacyId,feature:'batch_split',stage:'started'})).status,200);
  assert.equal((await send({type:'operation',operationId:legacyId,feature:'batch_split',stage:'failed',diagnostic:{...rules.capture({sunriseDiagnosticCode:'batch_copy_failed'},{ua:'Edg/132'}),trace:legacyRaw}})).status,200);
  const oldRead=await query('/api/admin/diagnostic-trace?trace_id='+legacyRaw.id);
  assert.equal(oldRead.status,200);assert.equal((await oldRead.json()).trace.client_release,'trace2-dev1-20261109');
  assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM analytics_diagnostics WHERE trace_schema_version=2').get().n,6);
  assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM analytics_operations WHERE state=\'failed\'').get().n,6);
  assert.equal(sqlite.prepare("SELECT count FROM analytics_errors WHERE day=? AND feature='페이지'").get(today).count,4);
  assert.equal(sqlite.prepare("SELECT count FROM analytics_errors WHERE day=? AND feature='문서 열기'").get(today).count,1);
  assert.equal(sqlite.prepare("SELECT count FROM analytics_errors WHERE day=? AND feature='저장'").get(today).count,1);
  assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM analytics_save_operations').get().n,0,'existing save retry metric remains independent');
  const all=await query('/api/admin/diagnostic-traces?days=14&feature=all');assert.equal(all.status,200);
  const ids=(await all.json()).items.map(x=>x.id);assert.equal(ids.length,6);
  for(const id of traceIds)assert(ids.includes(id));
  for(const feature of ['open','save_prepare','page_duplicate','page_delete']){
   const result=await query('/api/admin/diagnostics?days=14&feature='+feature);
   assert.equal(result.status,200);assert((await result.json()).items.some(x=>x.feature===feature));
  }
  assert.equal((await query('/api/admin/diagnostic-traces?feature=client-secret.pdf')).status,400);
  assert.equal((await query('/api/admin/diagnostic-trace?trace_id=../../private')).status,400);
  assert.equal((await worker.fetch(new Request(origin+'/api/admin/diagnostic-traces'),env,{})).status,401);
  assert.equal((await worker.fetch(new Request(origin+'/api/admin/diagnostic-trace?trace_id='+traceIds[0]),env,{})).status,401);
  const invalid=uuid(99);assert.equal((await send({type:'operation',operationId:invalid,feature:'open',stage:'started'})).status,200);
  const bad=rules.createTrace('save_prepare').failure('save_verify_failed');
  assert.equal((await send({type:'operation',operationId:invalid,feature:'open',stage:'failed',diagnostic:{...rules.capture({sunriseDiagnosticCode:'save_verify_failed'}),trace:bad}})).status,400);
  assert.equal(sqlite.prepare('SELECT state FROM analytics_operations WHERE operation_id=?').get(invalid).state,'started','reject mismatch atomically');
  sqlite.prepare('DELETE FROM analytics_sessions WHERE session_id=?').run(session);
  assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM analytics_diagnostics').get().n,0,'foreign-key cascade retention');
 } finally{close()}
 const html=fs.readFileSync('dist/admin/index.html','utf8');
 const js=fs.readFileSync('src/editor/index.html','utf8');
 for(const feature of ['save_prepare','page_duplicate','page_delete'])assert(html.includes(`<option value="${feature}">`));
 for(const marker of ['createTrace(\'open\')','createTrace(\'save_prepare\')','createTrace(\'page_duplicate\')','createTrace(\'page_delete\')'])assert(js.includes(marker),marker);
 for(const input of html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g))if(input[1].trim())new (require('node:vm').Script)(input[1]);
 for(const input of js.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g))if(input[1].trim())new (require('node:vm').Script)(input[1]);
 console.log('PASS: Trace v2 DEV2 open/save/page edits, DEV1 compatibility, real SQLite idempotence, admin filtering/auth, PII rejection, source wiring');
})().catch(e=>{console.error(e);process.exitCode=1});
