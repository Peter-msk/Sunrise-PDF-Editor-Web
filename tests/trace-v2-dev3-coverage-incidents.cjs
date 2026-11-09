'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),crypto=require('node:crypto');
const rules=require('../src/assets/sunrise-diagnostics.js');
const {createD1Fixture}=require('./helpers/d1-sqlite.cjs');
const origin='https://sunrise.example';
const uuid=()=>crypto.randomUUID();
(async()=>{
 const {sqlite,db,close}=createD1Fixture();
 const {telemetry,adminApi}=await import('../src/admin-api.mjs');
 const worker=(await import('../src/worker.mjs')).default;
 const today=new Date(Date.now()+9*3600000).toISOString().slice(0,10);
 const env={DB:db,CF_VERSION_METADATA:{id:'11111111-1111-4111-8111-111111111111'}};
 const testTraces=[];
 const send=async(session,data)=>telemetry(new Request(origin+'/api/telemetry',{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify({session,...data})}),env,new URL(origin+'/api/telemetry'));
 const admin=async(path,method='GET',body=null,from=origin)=>{
  const url=new URL(origin+path);
  return adminApi(new Request(url,{method,headers:{...(body?{'content-type':'application/json'}:{}),...(method==='PATCH'?{origin:from}:{})},...(body?{body:JSON.stringify(body)}:{})}),env,url,'admin');
 };
 assert.equal(rules.OPERATION_FEATURES.length,51);
 assert.equal(new Set(rules.OPERATION_FEATURES).size,51);
 try{
  for(let i=0;i<51;i++){
   const feature=rules.OPERATION_FEATURES[i],session=`00000000-0000-4000-8000-${String(Math.floor(i/28)+1).padStart(12,'0')}`;
   if(i%28===0)assert.equal((await send(session,{type:'visit'})).status,200);
   const op=uuid(),track=rules.createTrace(feature);assert(track,feature);
   track.mark('operation_start');track.mark('operation_failed');
   const detail=track.failure('operation_failed');assert(detail,feature);
   assert(rules.normalizeTrace(detail));assert.equal(detail.feature,feature);
   assert.equal(detail.code,'operation_failed');assert.equal(detail.client_release,rules.TRACE_BUILD);
   const safe=rules.capture({message:'secret-name.pdf PRIVATE@EXAMPLE.COM /private/foo'}, {ua:'Edg/130'});
   safe.code='operation_failed';safe.phase='operation';safe.trace=detail;
   assert.equal((await send(session,{type:'operation',feature,operationId:op,stage:'started'})).status,200);
   assert.equal((await send(session,{type:'operation',feature,operationId:op,stage:'failed',diagnostic:safe})).status,200);
   assert.equal((await send(session,{type:'operation',feature,operationId:op,stage:'failed',diagnostic:safe})).status,200,'no double count');
   testTraces.push(detail);
   assert(!JSON.stringify(detail).includes('PRIVATE'));
   assert.equal((await admin('/api/admin/diagnostic-traces?days=14&feature='+feature)).status,200);
  }
  assert.equal(sqlite.prepare('SELECT count(*) n FROM analytics_diagnostics').get().n,51);
  assert.equal(sqlite.prepare('SELECT count(*) n FROM analytics_operations WHERE state=\'failed\'').get().n,51);
  assert.equal(sqlite.prepare('SELECT COALESCE(sum(count),0) n FROM analytics_errors').get().n,51);
  assert.equal((await admin('/api/admin/diagnostics?feature=local_pdf_to_images')).status,200);
  assert.equal((await admin('/api/admin/diagnostics?feature=file.pdf')).status,400);
  const old=rules.createTrace('page_rotate').failure('operation_failed');assert.equal(rules.normalizeTrace({...old,client_release:'trace2-dev2-20261109'}),null,'DEV2 cannot forge new coverage');
  const oldDev2=rules.createTrace('open').failure('read_failed');assert(rules.normalizeTrace({...oldDev2,client_release:'trace2-dev2-20261109'}),'DEV2 historical read');
  assert.equal((await worker.fetch(new Request(origin+'/api/admin/trace-incidents'),env,{})).status,401);
  const groups=await admin('/api/admin/trace-incidents');assert.equal(groups.status,200);
  const data=await groups.json();assert.equal(data.items.length,51);assert(data.items.every(x=>x.occurrences===1));
  const group=data.items.find(x=>x.feature==='page_rotate');assert(group);
  const fp=group.fingerprint;
  assert.equal((await admin('/api/admin/trace-incidents/'+fp,'PATCH',{status:'investigating',note:'검증 재현 중',fix_commit:null,revision:0},'https://evil.example')).status,403);
  assert.equal((await admin('/api/admin/trace-incidents/'+fp,'PATCH',{status:'investigating',note:'secrets.pdf',fix_commit:null,revision:0})).status,400);
  assert.equal((await admin('/api/admin/trace-incidents/'+fp,'PATCH',{status:'investigating',note:'test@example.com',fix_commit:null,revision:0})).status,400);
  assert.equal((await admin('/api/admin/trace-incidents/ffffffff','PATCH',{status:'investigating',note:'ok',fix_commit:null,revision:0})).status,404);
  let result=await admin('/api/admin/trace-incidents/'+fp,'PATCH',{status:'investigating',note:'회전 오류 재현 확인',fix_commit:null,revision:0});assert.equal(result.status,200);
  assert.deepEqual(await result.json(),{ok:true,revision:1});
  assert.equal((await admin('/api/admin/trace-incidents/'+fp,'PATCH',{status:'verifying',note:'검증',fix_commit:null,revision:0})).status,409,'CAS protects newer work');
  const gitSha='a'.repeat(40);
  result=await admin('/api/admin/trace-incidents/'+fp,'PATCH',{status:'resolved',note:'다시 검사 후 정상',fix_commit:gitSha,revision:1});assert.equal(result.status,200);
  const history=await admin('/api/admin/trace-incidents/'+fp+'/history');assert.equal(history.status,200);
  const h=(await history.json()).items;assert.equal(h.length,2);assert.equal(h[0].status,'resolved');assert.equal(h[0].fix_commit,gitSha);
  assert.equal(sqlite.prepare('SELECT count(*) n FROM admin_trace_incident_audit').get().n,2);
  const list=await admin('/api/admin/trace-incidents');const current=(await list.json()).items.find(x=>x.fingerprint===fp);
  assert.equal(current.status,'resolved');assert.equal(current.revision,2);
  const oldNotes='CANARY_PDF_RAW_FILE_TITLE.pdf';
  assert(!JSON.stringify(current).includes(oldNotes));
  // Inject a later occurrence with an already validated public fingerprint. It
  // remains counted once per operation and reads as recurrence without GET writes.
  const u=uuid(),sess='00000000-0000-4000-8000-000000000002';
  const r=rules.createTrace('page_rotate');r.mark('operation_failed');
  assert.equal((await send(sess,{type:'operation',feature:'page_rotate',operationId:u,stage:'started'})).status,200);
  assert.equal((await send(sess,{type:'operation',feature:'page_rotate',operationId:u,stage:'failed',diagnostic:{...rules.capture({sunriseDiagnosticCode:'operation_failed'},{ua:'Edg/132'}),trace:r.failure('operation_failed')}})).status,200);
  // Controlled timestamp adjustment to model a future error without a clock delay.
  sqlite.prepare('UPDATE analytics_diagnostics SET received_ms=? WHERE operation_id=?').run(Date.now()+120000,u);
  const later=(await (await admin('/api/admin/trace-incidents')).json()).items.find(x=>x.fingerprint===fp);
  assert.equal(later.occurrences,2);assert.equal(later.recurred,true);
  const auditBody={status:'reopened',note:'회전 오류 재발 확인',fix_commit:gitSha,revision:2};
  assert.equal((await admin('/api/admin/trace-incidents/'+fp,'PATCH',auditBody)).status,200);
  assert.equal(sqlite.prepare('SELECT count(*) n FROM admin_trace_incident_audit').get().n,3);
  // 90-day retention for admin workflow; old traces remain independently 14 days.
  const {runAdminRetention}=await import('../src/admin-retention.mjs');
  sqlite.prepare('UPDATE admin_trace_incidents SET updated_ms=? WHERE fingerprint=?').run(Date.now()-91*86400000,fp);
  await runAdminRetention(db,Date.now());
  assert.equal(sqlite.prepare('SELECT count(*) n FROM admin_trace_incidents WHERE fingerprint=?').get(fp).n,0);
  assert.equal(sqlite.prepare('SELECT count(*) n FROM admin_trace_incident_audit WHERE fingerprint=?').get(fp).n,0);
 } finally{close()}
 // Check actual browser operation sender, not just trace schema. Each terminal
 // failure emits a scrubbed trace while successful/cancelled operations do not.
 const events=[],context={};
 const sid='00000000-0000-4000-8000-000000000003';
 Object.assign(context,{AbortController,crypto:crypto.webcrypto,performance:{now:()=>100},setTimeout,clearTimeout,setInterval:()=>0,location:{pathname:'/editor/'},sessionStorage:{getItem:()=>sid,setItem:()=>{}},
  navigator:{userAgent:'Edg/130'},document:{visibilityState:'visible',hasFocus:()=>true,addEventListener:()=>{}},
  addEventListener:()=>{},fetch:async(url,options)=>{events.push(JSON.parse(options.body));return {ok:true}},SunriseDiagnostics:rules,window:null});
 context.window=context;
 const t=fs.readFileSync('dist/assets/sunrise-telemetry.js','utf8');vm.runInNewContext(t,context);
 for(const feature of ['local_page_crop','overlay_edit','page_rotate','form_fill_bulk']){
  const finish=context.sunriseTelemetryOperationStart(feature);finish('failed');
 }
 for(const feature of ['local_nup','bookmark_add'])context.sunriseTelemetryOperationStart(feature)('succeeded');
 await new Promise(resolve=>setTimeout(resolve,100));
 const failures=events.filter(x=>x.type==='operation'&&x.stage==='failed');
 assert.equal(failures.length,4,JSON.stringify(events));
 assert(failures.every(x=>x.diagnostic?.trace?.schema===2));
 assert(events.filter(x=>x.type==='operation'&&x.stage==='succeeded').every(x=>!x.diagnostic));
 assert(!JSON.stringify(events).includes('CANARY_PDF_RAW_FILE_TITLE.pdf'));
 console.log('PASS: 51/51 operation types traceable; 51 D1 exact-once events; admin issue state, revision conflicts, history, 90d cascade, recurrence, security and browser telemetry');
})().catch(e=>{console.error(e);process.exitCode=1});
