'use strict';
// Development-side real execution paths and strict non-PII metadata contracts.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const crypto=require('node:crypto');
const rules=require('../src/assets/sunrise-diagnostics.js');
const {createD1Fixture}=require('./helpers/d1-sqlite.cjs');
const origin='https://sunrise.example';
(async()=>{
 const latest=['pdf_lock','pdf_unlock','pdf_crypto_compress','signature_sign','signature_verify','office_export_text','office_export_advanced'];
 assert.equal(rules.OPERATION_FEATURES.length,51);
 assert(latest.every(x=>rules.OPERATION_FEATURES.includes(x)));
 assert.equal(rules.TRACE_BUILD,'trace2-dev4-20261109');
 const terminal=[];
 for(const feature of latest){
   const t=rules.createTrace(feature);assert(t,feature);
   t.mark('input_start');t.mark('engine_start');t.mark('engine_failed');
   const d=t.failure('operation_failed');assert(d,feature);
   assert.equal(rules.normalizeTrace(d)?.feature,feature);
   assert.equal(rules.normalizeTrace({...d,client_release:'trace2-dev3-20261109'}),null,'old release cannot claim new feature');
   assert.equal(rules.normalizeTrace({...d,steps:[...d.steps,{step:'private_key','duration':'0to99'}]}),null);
   terminal.push(d);
 }
 // A real local processing job emits the engine boundary and leaves original errors untouched.
 const marks=[];const fake={sunriseTelemetryOperationStart:()=>{
    const done=stage=>marks.push(stage);done.mark=step=>marks.push(step);return done;
 }};
 vm.runInNewContext(fs.readFileSync('src/assets/sunrise-local-metrics.js','utf8'),fake);
 await assert.rejects(()=>fake.SunriseLocalMetrics.track('local_page_crop',async()=>{throw Error('sensitive.pdf secret');}),/sensitive.pdf secret/);
 assert(marks.includes('engine_start'));assert(marks.includes('engine_failed'));assert(marks.includes('failed'));
 const marker=marks.slice();marks.length=0;
 assert.equal(await fake.SunriseLocalMetrics.track('local_nup',async()=>42),42);
 assert(marks.includes('engine_ok')&&marks.includes('succeeded'));
 assert(!JSON.stringify(marker).includes('sensitive.pdf'),'no errors sent as diagnostics');
 const editor=fs.readFileSync('src/editor/index.html','utf8');
 const ownerTokens=['beginOperationMetric(\'pdf_lock\')','beginOperationMetric(\'pdf_unlock\')',
  'beginOperationMetric(\'pdf_crypto_compress\')','beginOperationMetric(\'signature_sign\')',
  'beginOperationMetric(\'signature_verify\')','beginOperationMetric(\'office_export_text\')',
  'beginOperationMetric(\'office_export_advanced\')'];
 for(const owner of ownerTokens)assert(editor.includes(owner),'owner uninstrumented: '+owner);
 for(const step of ['crypto_start','crypto_ok','signature_start','signature_ok','office_start','office_ok','verify_start','verify_ok'])
  assert(editor.includes(`.mark?.('${step}')`) || editor.includes(`.mark('${step}')`),step);
 const admin=fs.readFileSync('dist/admin/index.html','utf8');
 assert(latest.every(x=>admin.includes(`value="${x}"`)), 'admin filters');
 assert(!editor.includes('report.mark(password)')&&!editor.includes('report.mark(privateKeyPem)'));
 const fixture=createD1Fixture();
 const {telemetry}=await import('../src/admin-api.mjs');
 const env={DB:fixture.db,CF_VERSION_METADATA:{id:'11111111-1111-4111-8111-111111111111'}};
 const sid='00000000-0000-4000-8000-000000000088';
 const send=async data=>telemetry(new Request(origin+'/api/telemetry',{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify({session:sid,...data})}),env,new URL(origin+'/api/telemetry'));
 try{
  assert.equal((await send({type:'visit'})).status,200);
  for(let i=0;i<latest.length;i++){
   const id=crypto.randomUUID(),feature=latest[i],trace=terminal[i];
   const detail={...rules.capture(null,{code:'operation_failed',ua:'Edg/135'}),trace};
   assert.equal((await send({type:'operation',feature,operationId:id,stage:'started'})).status,200);
   assert.equal((await send({type:'operation',feature,operationId:id,stage:'failed',diagnostic:detail})).status,200);
   assert.equal((await send({type:'operation',feature,operationId:id,stage:'failed',diagnostic:detail})).status,200);
  }
  assert.equal(fixture.sqlite.prepare("SELECT COUNT(*) n FROM analytics_diagnostics WHERE feature IN ('pdf_lock','pdf_unlock','pdf_crypto_compress','signature_sign','signature_verify','office_export_text','office_export_advanced')").get().n,7);
  assert.equal(fixture.sqlite.prepare('SELECT COALESCE(sum(count),0) n FROM analytics_errors').get().n,7);
  const rows=fixture.sqlite.prepare('SELECT trace_json FROM analytics_diagnostics').all();
  assert(rows.every(x=>x.trace_json&&rules.normalizeTrace(JSON.parse(x.trace_json))));
  assert(rows.every(x=>!x.trace_json.includes('password')&&!x.trace_json.includes('privateKeyPem')&&!x.trace_json.includes('sensitive.pdf')));
 }finally{fixture.close()}
 console.log('PASS DEV4: 7 sensitive owner workflows, 51 feature registry, staged local engine, admin filters, immutable privacy allowlist and seven SQLite exact-once failures');
})().catch(e=>{console.error(e);process.exitCode=1});
