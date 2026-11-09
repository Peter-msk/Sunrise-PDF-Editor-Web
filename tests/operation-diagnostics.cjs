'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const rules=require('../src/assets/sunrise-diagnostics.js');
const uuid=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
(async()=>{
 const {sqlite,db,close}=require('./helpers/d1-sqlite.cjs').createD1Fixture();
 try{
  const {telemetry,adminApi}=await import('../src/admin-api.mjs');
  const {runAdminRetention}=await import('../src/admin-retention.mjs');
  const today=new Date(Date.now()+9*3600000).toISOString().slice(0,10),session=uuid(1),origin='https://fixture.example.test';
  const env={DB:db,CF_VERSION_METADATA:{id:'11111111-1111-4111-8111-111111111111'}};
  const send=async data=>telemetry(new Request(origin+'/api/telemetry',{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify({session,...data})}),env,new URL(origin+'/api/telemetry'));
  assert.equal((await send({type:'visit'})).status,200);
  const secret='SECRET filename customer.pdf / contents / stack';
  const e=rules.tagged('read_failed',new Error(secret));
  const detail=rules.capture(e,{origin:'file',bytes:5000,pages:3,ua:'Mozilla Chrome/123'});
  assert(!JSON.stringify(detail).includes(secret));assert.equal(detail.size,'lt1m');
  assert.equal(rules.normalize({...detail,message:secret}),null);
  assert.equal(rules.normalize({...detail,phase:'render'}),null);
  for(let i=2;i<=3;i++){
   assert.equal((await send({type:'operation',operationId:uuid(i),feature:'open',stage:'started'})).status,200);
   assert.equal((await send({type:'operation',operationId:uuid(i),feature:'open',stage:'failed',diagnostic:detail})).status,200);
   await send({type:'operation',operationId:uuid(i),feature:'open',stage:'failed',diagnostic:detail});
  }
  assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM analytics_diagnostics').get().n,2);
  assert.equal(sqlite.prepare("SELECT count FROM analytics_errors WHERE day=? AND feature='문서 열기'").get(today).count,2,'one count per distinct failed operation, no 3-second loss');
  await send({type:'operation',operationId:uuid(4),feature:'open',stage:'started'});
  assert.equal((await send({type:'operation',operationId:uuid(4),feature:'open',stage:'failed',diagnostic:{...detail,filename:secret}})).status,400);
  assert.equal(sqlite.prepare('SELECT state FROM analytics_operations WHERE operation_id=?').get(uuid(4)).state,'started','reject before state mutation');
  await send({type:'operation',operationId:uuid(4),feature:'open',stage:'cancelled'});
  await send({type:'operation',operationId:uuid(5),feature:'merge',stage:'started'});
  await send({type:'operation',operationId:uuid(5),feature:'merge',stage:'failed',diagnostic:rules.capture(null,{code:'operation_failed'})});
  assert.equal(sqlite.prepare("SELECT count FROM analytics_errors WHERE day=? AND feature='문서 열기'").get(today).count,2,'merge is not attributed to open');
  const read=async path=>{const url=new URL(origin+path);return adminApi(new Request(url),env,url,'admin')};
  let response=await read('/api/admin/diagnostics?days=14&feature=open');assert.equal(response.status,200);
  const data=await response.json();assert.equal(data.items.length,1);assert.equal(data.items[0].count,2);assert.equal(data.items[0].code,'read_failed');
  assert.equal(data.items[0].last_ms%60000,0);assert(!JSON.stringify(data).includes(session));assert(!JSON.stringify(data).includes(secret));
  response=await read('/api/admin/diagnostics.csv?days=14');assert.equal(response.status,200);assert((await response.text()).includes('read_failed'));
  assert.equal((await read('/api/admin/diagnostics?days=30')).status,400);
  assert.equal((await read('/api/admin/diagnostics?feature=SECRET')).status,400);
  const worker=(await import('../src/worker.mjs')).default;
  assert.equal((await worker.fetch(new Request(origin+'/api/admin/diagnostics'),env,{})).status,401);
  const forged=await telemetry(new Request(origin+'/api/telemetry',{method:'POST',headers:{origin:'https://attacker.invalid','content-type':'application/json'},body:JSON.stringify({type:'operation',session})}),env,new URL(origin+'/api/telemetry'));assert.equal(forged.status,403);
  // Foreign-key cascade follows operation cleanup without retaining identifiers.
  const row=sqlite.prepare('SELECT day,session_id FROM analytics_sessions').get();
  sqlite.prepare('DELETE FROM analytics_sessions WHERE day=? AND session_id=?').run(row.day,row.session_id);
  assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM analytics_diagnostics').get().n,0);
  // An insertion failure rolls back the failed outcome and all error counters.
  await send({type:'visit'});await send({type:'operation',operationId:uuid(6),feature:'open',stage:'started'});
  sqlite.exec("CREATE TRIGGER fail_diagnostic BEFORE INSERT ON analytics_diagnostics BEGIN SELECT RAISE(ABORT,'synthetic');END");
  assert.equal((await send({type:'operation',operationId:uuid(6),feature:'open',stage:'failed',diagnostic:detail})).status,503);
  assert.equal(sqlite.prepare('SELECT state FROM analytics_operations WHERE operation_id=?').get(uuid(6)).state,'started');
 }finally{close()}
 const emitted=[],listeners={};let seq=100;
 const browser={window:{SunriseDiagnostics:rules,navigator:{userAgent:'Chrome/123'},addEventListener:(name,fn)=>listeners[name]=fn},location:{pathname:'/editor/'},sessionStorage:{getItem:()=>null,setItem(){}},crypto:{randomUUID:()=>uuid(seq++)},document:{visibilityState:'visible',hasFocus:()=>true,addEventListener(){},getElementById:()=>({})},performance:{now:()=>0},Date,AbortController,Promise,setInterval(){},setTimeout(){return 1},clearTimeout(){},MutationObserver:class{constructor(){throw Error('warning toast must not be observed as a failure')}},fetch:async(url,opts)=>{emitted.push(JSON.parse(opts.body));return {ok:true}}};
 vm.runInNewContext(fs.readFileSync('dist/assets/sunrise-telemetry.js','utf8'),browser);
 const finish=browser.window.sunriseTelemetryOperationStart('open');
 const detail=rules.capture(rules.tagged('empty_file'),{origin:'file',bytes:0});
 finish('failed',detail);finish('failed',detail);
 for(let i=0;i<8;i++)await new Promise(setImmediate);
 const failures=emitted.filter(x=>x.type==='operation'&&x.stage==='failed');
 assert.equal(failures.length,1);assert.equal(failures[0].diagnostic.code,'empty_file');
 listeners.error();for(let i=0;i<4;i++)await new Promise(setImmediate);
 assert.equal(emitted.find(x=>x.type==='failure').feature,'기타','unhandled runtime error is not attributed to the last open button');
 const html=fs.readFileSync('dist/admin/index.html','utf8');
 const metric=fs.readFileSync('src/operation-metrics.mjs','utf8');
 assert(metric.includes('const features=diagnostics.OPERATION_FEATURES;'));
 const features=rules.OPERATION_FEATURES;
 const names=vm.runInNewContext('('+html.match(/const names=(\{open:[^;]+\});/)[1]+')');
 for(const feature of features)assert(names[feature],'admin feature label: '+feature);
 assert(html.includes('diagnosticRows')&&html.includes('소급 복원할 수 없습니다'));
 for(const m of html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g))if(m[1].trim())new vm.Script(m[1]);
 console.log('PASS: structured diagnostics, exact-once failure counts, privacy allowlist, authenticated read/CSV, cancellation, rollback, cleanup and complete admin feature labels');
})().catch(e=>{console.error(e);process.exitCode=1});
