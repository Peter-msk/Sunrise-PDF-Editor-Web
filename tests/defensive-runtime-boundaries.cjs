'use strict';
const assert=require('node:assert/strict');
const {webcrypto,randomUUID}=require('node:crypto');
globalThis.crypto ||= webcrypto;
const {createD1Fixture}=require('./helpers/d1-sqlite.cjs');
const sid='00000000-0000-4000-8000-000000000001';
const origin='https://local.sunrise.invalid';
const kstDay=()=>new Date(Date.now()+9*3600000).toISOString().slice(0,10);

(async()=>{
 // Incident state must belong to the *visible* recent error, even if there
 // are more than 101 other historical incident-state records.
 {
  const {sqlite,db,close}=createD1Fixture();
  try{
   const {incidentList}=await import('../src/trace-incidents.mjs');
   const today=kstDay(),now=Date.now();
   const insert=sqlite.prepare('INSERT INTO admin_trace_incidents(fingerprint,status,note,fix_commit,revision,created_ms,updated_ms,resolved_ms) VALUES(?,?,?,?,?,?,?,?)');
   for(let i=1;i<=111;i++)insert.run(i.toString(16).padStart(8,'0'),i===1?'resolved':'investigating',i===1?'처리 완료':'조사 중',null,i===1?2:1,1000,1000+i,i===1?now+10000:null);
   const op=randomUUID(),fp='00000001';
   sqlite.prepare('INSERT INTO analytics_sessions(day,session_id,last_pulse_ms) VALUES (?,?,?)').run(today,sid,now);
   sqlite.prepare('INSERT INTO analytics_operations(day,session_id,operation_id,feature,state,worker_version) VALUES (?,?,?,?,?,?)').run(today,sid,op,'open','failed','unknown');
   sqlite.prepare('INSERT INTO analytics_diagnostics(day,session_id,operation_id,feature,code,phase,origin,size_bucket,page_bucket,browser,client_build,worker_version,received_ms,trace_schema_version,trace_id,trace_json) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(today,sid,op,'open','read_failed','read','unknown','unknown','unknown','edge','diag-v1-20261107','unknown',now,2,randomUUID(),JSON.stringify({fingerprint:fp}));
   const incident=await incidentList(db,today);
   assert.equal(incident.items.length,1);
   assert.equal(incident.items[0].status,'resolved','a visible incident must not revert to new when history exceeds 101');
   assert.equal(incident.items[0].revision,2);
   assert.equal(incident.items[0].note,'처리 완료');
   assert.equal(incident.items[0].recurred,false);
  }finally{close()}
 }
 // D1 inquiry insertion failure must not consume the rate-limit allowance.
 // A rejected retry must not create an inquiry either.
 {
  const {sqlite,db,close}=createD1Fixture();
  try{
   const worker=(await import('../src/worker.mjs')).default;
   const env={DB:db,INQUIRY_HASH_SALT:'test-only-key',ASSETS:{fetch:async()=>new Response('static')}};
   const data={category:'오류 신고',email:'example@local.invalid',message:'문의 저장 실패 후 재시도 제한이 없어야 합니다.',consent:true};
   const send=()=>worker.fetch(new Request(origin+'/api/inquiries',{method:'POST',headers:{origin,'content-type':'application/json','cf-connecting-ip':'203.0.113.13'},body:JSON.stringify(data)}),env,{});
   sqlite.exec("CREATE TRIGGER abort_inquiry BEFORE INSERT ON inquiries BEGIN SELECT RAISE(ABORT,'simulated storage error');END");
   assert.equal((await send()).status,503);
   assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM inquiry_rate_limits').get().n,0,'failed inquiry must roll back rate limit');
   assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM inquiries').get().n,0);
   sqlite.exec('DROP TRIGGER abort_inquiry');
   assert.equal((await send()).status,201);
   assert.equal((await send()).status,429);
   assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM inquiries').get().n,1);
   assert.equal(sqlite.prepare('SELECT SUM(daily_count) n FROM inquiry_rate_limits').get().n,1);
  }finally{close()}
 }
 // A telemetry start that is ignored (no visit, duplicate id or daily limit)
 // must not return a success acknowledgment.
 {
  const {sqlite,db,close}=createD1Fixture();
  try{
   const {recordOperation}=await import('../src/operation-metrics.mjs');
   const today=kstDay(),now=Date.now();
   const item=(id)=>({session:sid,feature:'open',operationId:id,stage:'started'});
   const op=randomUUID();
   assert.equal(await recordOperation(db,item(op),today,'unknown',now),false,'no visit, no record');
   sqlite.prepare('INSERT INTO analytics_sessions(day,session_id,last_pulse_ms) VALUES (?,?,?)').run(today,sid,now);
   assert.equal(await recordOperation(db,item(op),today,'unknown',now),true);
   assert.equal(await recordOperation(db,item(op),today,'unknown',now),true,'duplicate start remains idempotent and acknowledged');
   const ins=sqlite.prepare('INSERT INTO analytics_operations(day,session_id,operation_id,feature,state,worker_version) VALUES (?,?,?,?,?,?)');
   for(let i=0;i<99;i++)ins.run(today,sid,randomUUID(),'open','started','unknown');
   assert.equal(await recordOperation(db,item(randomUUID()),today,'unknown',now),false,'100/day quota rejects start');
   assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM analytics_operations').get().n,100);
  }finally{close()}
 }
 console.log('PASS: incident state consistency above 101, atomic inquiry rate accounting and honest telemetry start acceptance');
})().catch(error=>{console.error(error);process.exitCode=1});
