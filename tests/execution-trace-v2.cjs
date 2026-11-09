'use strict';
// Trace v2 end-to-end: PDF browser breadcrumbs -> strict telemetry -> D1 -> authenticated admin detail.
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');
const rules=require('../src/assets/sunrise-diagnostics.js');
const batch=require('../src/assets/sunrise-batch-pages.js');
const lib=require('../dist/assets/pdf-lib/pdf-lib.min.js');
const uuid=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
const origin='https://trace.example.test';
const makeFile=(bytes,name='PRIVATE_고객문서_비밀번호123.pdf')=>({name,size:bytes.length,bytes});
(async()=>{
 assert.equal(rules.TRACE_SCHEMA,2);
 const failureRecorder=rules.createTrace('batch_split');
 assert(failureRecorder&&failureRecorder.mark('read_start'));
 assert(failureRecorder.mark('read_ok'));
 assert(!failureRecorder.mark('내부-사용자_파일명'));
 assert.equal(failureRecorder.structure({filename:'private.pdf'}),false);
 assert(failureRecorder.structure({has_mark_info:true,marked_true:false,has_annots:false}));
 for(let i=0;i<19;i++)failureRecorder.mark(i%2?'copy_start':'copy_ok');
 const trace=failureRecorder.failure('batch_copy_failed');
 assert(trace&&trace.steps.length===12,'bounded ring buffer');
 assert.equal(trace.module,'batch_pages');assert.equal(trace.callsite,'copy_pages');
 assert.equal(trace.structure.has_mark_info,true);assert.equal(trace.structure.is_encrypted,null);
 assert.equal(failureRecorder.failure('batch_copy_failed'),null,'never send same trace twice');
 const detail={...rules.capture(null,{code:'batch_copy_failed',origin:'file',bytes:123456,pages:3,ua:'Edg/120'}),trace};
 assert.deepEqual(rules.normalize(detail),detail);
 const poison='CUSTOMER_EMAIL@PRIVATE.invalid /Users/private/MyDoc.pdf secret-password stack';
 for(const extra of [
  {...detail,filename:poison},
  {...detail,trace:{...trace,filename:poison}},
  {...detail,trace:{...trace,structure:{...trace.structure,document_title:poison}}},
  {...detail,trace:{...trace,steps:[...trace.steps,{step:'copy_ok',duration:'0to99',message:poison}]}},
  {...detail,trace:{...trace,steps:Array(13).fill(trace.steps[0])}},
  {...detail,trace:{...trace,client_release:poison}},
  {...detail,trace:{...trace,fingerprint:'00000000'}},
  {...detail,trace:{...trace,code:'batch_save_failed'}},
  {...detail,trace:{...trace,id:'../path/'}}
 ])assert.equal(rules.normalize(extra),null,'reject tainted/forged trace rather than silently dropping fields');
 assert(!JSON.stringify(detail).includes(poison));
 assert(!JSON.stringify(detail).includes('PRIVATE_'));
 const document=await lib.PDFDocument.create();document.addPage([612,792]).drawText('Confidential example content',{x:40,y:620});
 document.catalog.set(lib.PDFName.of('MarkInfo'),document.context.obj({Marked:false}));
 const bytes=Uint8Array.from(await document.save());
 const file=makeFile(bytes);
 const observed=[];const errors=[];const results=[];
 await batch.process([file],{mode:'split',pagesPerFile:1},{cancelled:()=>false,trace:(step,flags)=>observed.push({step,flags}),error:e=>errors.push(e),result:e=>results.push(e)},{PDFLib:lib,readFile:async f=>f.bytes});
 assert.equal(errors.length,0);assert.equal(results.length,1);
 assert(observed.some(e=>e.step==='read_ok'));
 assert(observed.some(e=>e.step==='parse_ok'&&e.flags?.has_mark_info===true&&e.flags?.marked_true===false));
 for(const step of ['structure_ok','copy_start','copy_ok','save_start','save_ok','verify_start','verify_ok'])assert(observed.some(e=>e.step===step),step);
 const override={...lib,PDFDocument:{...lib.PDFDocument,create:async()=>{const pdf=await lib.PDFDocument.create();pdf.copyPages=async()=>{throw Error(poison)};return pdf},load:(...args)=>lib.PDFDocument.load(...args)}};
 const failTrace=rules.createTrace('batch_split');
 let generated=null;
 await batch.process([file],{mode:'split',pagesPerFile:1},{cancelled:()=>false,trace:(step,flags)=>{failTrace.mark(step);if(flags)failTrace.structure(flags)},error:e=>generated=e},{PDFLib:override,readFile:async f=>f.bytes});
 assert.equal(generated.code,'batch_copy_failed');
 failTrace.mark('copy_failed');const local=failTrace.failure(generated.code);
 assert(local.steps.some(s=>s.step==='copy_start'));
 assert.equal(local.structure.has_mark_info,true);
 assert.equal(local.structure.marked_true,false);
 assert(!JSON.stringify(local).includes(poison));
 assert(!JSON.stringify(local).includes(file.name));
 const {sqlite,db,close}=require('./helpers/d1-sqlite.cjs').createD1Fixture();
 try{
  const {telemetry,adminApi}=await import('../src/admin-api.mjs');
  const env={DB:db,CF_VERSION_METADATA:{id:'11111111-1111-4111-8111-111111111111'}};
  const day=new Date(Date.now()+9*3600000).toISOString().slice(0,10);
  const session=uuid(1),operationId=uuid(2);
  const send=(obj,headers={})=>telemetry(new Request(origin+'/api/telemetry',{method:'POST',headers:{origin,'content-type':'application/json',...headers},body:JSON.stringify({session,...obj})}),env,new URL(origin+'/api/telemetry'));
  assert.equal((await send({type:'visit'})).status,200);
  assert.equal((await send({type:'operation',operationId,feature:'batch_split',stage:'started'})).status,200);
  const safe={...rules.capture(null,{code:generated.code,bytes:file.size,ua:'Edg/120'}),trace:local};
  assert.equal((await send({type:'operation',operationId,feature:'batch_split',stage:'failed',diagnostic:safe})).status,200);
  assert.equal((await send({type:'operation',operationId,feature:'batch_split',stage:'failed',diagnostic:safe})).status,200);
  assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM analytics_diagnostics WHERE trace_schema_version=2").get().n,1);
  const record=sqlite.prepare("SELECT trace_id,trace_schema_version,trace_json,worker_version FROM analytics_diagnostics").get();
  assert.equal(record.trace_id,local.id);
  assert.equal(record.trace_schema_version,2);
  assert.equal(record.worker_version,env.CF_VERSION_METADATA.id);
  assert.equal(JSON.parse(record.trace_json).callsite,'copy_pages');
  assert(!record.trace_json.includes(poison));assert(!record.trace_json.includes(file.name));
  assert.equal(sqlite.prepare("SELECT count FROM analytics_errors WHERE day=? AND feature='페이지'").get(day).count,1);
  const read=async path=>{const url=new URL(origin+path);return adminApi(new Request(url),env,url,'admin')};
  let res=await read('/api/admin/diagnostic-traces?days=14&feature=batch_split');assert.equal(res.status,200);
  let data=await res.json();assert.equal(data.items.length,1);assert.equal(data.items[0].id,local.id);
  assert(!JSON.stringify(data).includes(session));
  res=await read('/api/admin/diagnostic-trace?trace_id='+local.id);assert.equal(res.status,200);
  data=await res.json();assert.equal(data.trace.callsite,'copy_pages');assert.equal(data.trace.steps.length,local.steps.length);
  assert.equal((await read('/api/admin/diagnostic-trace?trace_id=../../oops')).status,400);
  assert.equal((await read('/api/admin/diagnostic-traces?feature=private.pdf')).status,400);
  assert.equal((await read('/api/admin/diagnostic-traces?days=30')).status,400);
  assert.equal((await read('/api/admin/diagnostic-trace?trace_id='+uuid(999))).status,404);
  const worker=(await import('../src/worker.mjs')).default;
  assert.equal((await worker.fetch(new Request(origin+'/api/admin/diagnostic-traces'),env,{})).status,401);
  assert.equal((await worker.fetch(new Request(origin+'/api/admin/diagnostic-trace?trace_id='+local.id),env,{})).status,401);
  const next=uuid(3);await send({type:'operation',operationId:next,feature:'batch_merge',stage:'started'});
  assert.equal((await send({type:'operation',operationId:next,feature:'batch_merge',stage:'failed',diagnostic:safe})).status,400,'trace and operation must agree');
  assert.equal(sqlite.prepare('SELECT state FROM analytics_operations WHERE operation_id=?').get(next).state,'started');
  const dirty=uuid(4);await send({type:'operation',operationId:dirty,feature:'batch_split',stage:'started'});
  assert.equal((await send({type:'operation',operationId:dirty,feature:'batch_split',stage:'failed',diagnostic:{...safe,trace:{...local,filename:poison}}})).status,400);
  assert.equal(sqlite.prepare('SELECT state FROM analytics_operations WHERE operation_id=?').get(dirty).state,'started');
  const stale=uuid(5);await send({type:'operation',operationId:stale,feature:'batch_split',stage:'started'});
  sqlite.exec("CREATE TRIGGER trace_synthetic_failure BEFORE INSERT ON analytics_diagnostics BEGIN SELECT RAISE(ABORT,'trace synthetic database failure'); END");
  assert.equal((await send({type:'operation',operationId:stale,feature:'batch_split',stage:'failed',diagnostic:{...safe,trace:{...local,id:uuid(888)}}})).status,503);
  assert.equal(sqlite.prepare('SELECT state FROM analytics_operations WHERE operation_id=?').get(stale).state,'started','failed trace insert must rollback state');
  sqlite.exec('DROP TRIGGER trace_synthetic_failure');
  sqlite.prepare('DELETE FROM analytics_sessions WHERE session_id=?').run(session);
  assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM analytics_diagnostics').get().n,0,'14-day lifecycle cascades with parent');
 }finally{close()}
 // The real telemetry client must preserve the safe trace on the failed operation event.
 const emitted=[],listeners={};let n=400;
 const browser={window:{SunriseDiagnostics:rules,navigator:{userAgent:'Edg/120'},addEventListener:(name,fn)=>listeners[name]=fn},
  location:{pathname:'/editor/'},sessionStorage:{getItem:()=>null,setItem(){}},crypto:{randomUUID:()=>uuid(n++)},
  document:{visibilityState:'visible',hasFocus:()=>true,addEventListener(){},getElementById:()=>({})},
  performance:{now:()=>0},Date,AbortController,Promise,setInterval(){},setTimeout(){return 1},clearTimeout(){},
  fetch:async(url,options)=>{emitted.push(JSON.parse(options.body));return {ok:true}}};
 vm.runInNewContext(fs.readFileSync('dist/assets/sunrise-telemetry.js','utf8'),browser);
 const finish=browser.window.sunriseTelemetryOperationStart('batch_split');
 finish('failed',safeTrace(detail));finish('failed',safeTrace(detail));
 for(let i=0;i<8;i++)await new Promise(setImmediate);
 const events=emitted.filter(x=>x.type==='operation'&&x.stage==='failed');
 assert.equal(events.length,1);
 assert.equal(events[0].diagnostic.trace.id,trace.id);
 assert(JSON.stringify(events[0]).length<3500);
 assert(!JSON.stringify(events[0]).includes(poison));
 function safeTrace(raw){return rules.normalize(raw)}
 const html=fs.readFileSync('dist/admin/index.html','utf8');
 assert(html.includes('traceTitle')&&html.includes('traceTimeline')&&html.includes('traceDetails'));
 for(const m of html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g))if(m[1].trim())new vm.Script(m[1]);
 const editor=fs.readFileSync('src/editor/index.html','utf8');
 assert(editor.includes('createTrace(feature)')&&editor.includes('trace:traceStep'));
 for(const m of editor.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g))if(m[1].trim())new vm.Script(m[1]);
 console.log('PASS: Trace v2 ring buffer, client safe structure, stage attribution, D1 exactly-once, admin authentication, anti-PII, rollback and UI scripts');
})().catch(e=>{console.error(e);process.exitCode=1});
