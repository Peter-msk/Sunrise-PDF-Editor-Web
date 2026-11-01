'use strict';
// Deferred source-phase regression: execute during administrator validation.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {DatabaseSync}=require('node:sqlite');
(async()=>{
 const metrics=await import('../src/operation-metrics.mjs');
 const {runTrackedAdminRetention,readRetentionExecution}=await import('../src/admin-retention.mjs');
 const {adminApi,telemetry}=await import('../src/admin-api.mjs');
 const sqlite=new DatabaseSync(':memory:');
 try{
  for(const file of fs.readdirSync('migrations').sort()){
   if(file.endsWith('.sql')&&!file.startsWith('0004_'))sqlite.exec(fs.readFileSync(path.join('migrations',file),'utf8'));
  }
  const db={prepare(sql){const stmt=sqlite.prepare(sql);const bound=args=>({
   async run(){const result=stmt.run(...args);return {meta:{changes:Number(result.changes)}}},
   async first(){return stmt.get(...args)||null},
   async all(){return {results:stmt.all(...args)}}
  });return {...bound([]),bind(...args){return bound(args)}}}};
  const versionA='11111111-1111-4111-8111-111111111111',versionB='22222222-2222-4222-8222-222222222222';
  const session='33333333-3333-4333-8333-333333333333';
  const fixed=Date.UTC(2026,9,30,12),day=new Date(fixed+9*3600000).toISOString().slice(0,10);
  sqlite.prepare('INSERT INTO analytics_sessions(day,session_id,last_pulse_ms) VALUES(?,?,?)').run(day,session,fixed);
  const op={session,feature:'merge',operationId:'44444444-4444-4444-8444-444444444444',stage:'started'};
  await metrics.recordOperation(db,op,day,versionA);
  await metrics.recordOperation(db,{...op,stage:'failed'},day,versionB);
  await metrics.recordOperation(db,{...op,stage:'succeeded'},day,versionB);
  assert.equal(sqlite.prepare('SELECT worker_version FROM analytics_operations').get().worker_version,versionA);
  assert.equal((await metrics.operationSummary(db,day,{days:7,version:versionA})).items.find(x=>x.feature==='merge').failed,1);
  assert.equal((await metrics.operationSummary(db,day,{days:7,version:versionB})).items.find(x=>x.feature==='merge').attempts,0);
  assert.throws(()=>metrics.operationScope(new URL('https://test.local/?days=30')),RangeError);
  assert.throws(()=>metrics.operationScope(new URL('https://test.local/?version=invalid')),RangeError);
  assert.equal(metrics.workerVersion({CF_VERSION_METADATA:{id:versionB}}),versionB);
  assert.equal(metrics.workerVersion({CF_VERSION_METADATA:{id:'bad'}}),'unknown');
  sqlite.prepare("INSERT INTO analytics_save_operations(day,session_id,operation_id,state,worker_version) VALUES(?,?,?,'ready',?)").run(day,session,'55555555-5555-4555-8555-555555555555',versionB);
  assert.equal((await metrics.saveSummary(db,day,{version:versionA})).attempts,0);
  assert.equal((await metrics.saveSummary(db,day,{version:versionB})).ready,1);
  const csvUrl=new URL('https://test.local/api/admin/operations.csv?days=7&version='+versionA);
  const csv=await adminApi(new Request(csvUrl),{DB:db},csvUrl,'admin');
  assert.equal(csv.status,200);assert.match(csv.headers.get('content-type'),/text\/csv/);
  assert.match(await csv.text(),/save_preparation/);
  const badUrl=new URL('https://test.local/api/admin/operations.csv?days=30');
  assert.equal((await adminApi(new Request(badUrl),{DB:db},badUrl,'admin')).status,400);
  const today=new Date(Date.now()+9*3600000).toISOString().slice(0,10);
  sqlite.prepare('INSERT OR IGNORE INTO analytics_sessions(day,session_id,last_pulse_ms) VALUES(?,?,?)').run(today,session,Date.now());
  const eventUrl=new URL('https://test.local/api/telemetry'),eventId='66666666-6666-4666-8666-666666666666';
  const event=new Request(eventUrl,{method:'POST',headers:{origin:eventUrl.origin,'content-type':'application/json'},body:JSON.stringify({type:'save_operation',session,operationId:eventId,stage:'started',worker_version:versionA})});
  assert.equal((await telemetry(event,{DB:db,CF_VERSION_METADATA:{id:versionB}},eventUrl)).status,200);
  assert.equal(sqlite.prepare('SELECT worker_version FROM analytics_save_operations WHERE operation_id=?').get(eventId).worker_version,versionB,'client may not choose receiving version');
  const now=Date.now();
  await runTrackedAdminRetention(db,now);
  const success=await readRetentionExecution(db,now);
  assert.equal(success.state,'succeeded');assert(success.lastSuccessAt);
  const failing={prepare(sql){if(sql.startsWith('DELETE FROM operation_deployments'))throw Error('injected failure');return db.prepare(sql)}};
  await assert.rejects(runTrackedAdminRetention(failing,now+1000),/injected failure/);
  const failed=await readRetentionExecution(db,now+1000);
  assert.equal(failed.state,'failed');assert.equal(failed.failedStep,'deployment_reports');
  assert.equal(failed.lastSuccessAt,success.lastSuccessAt,'failure must preserve last success');
  sqlite.prepare("UPDATE admin_maintenance_status SET state='running',started_ms=?,finished_ms=NULL,failed_step=NULL").run(now);
  assert.equal((await runTrackedAdminRetention(db,now+2000)).skipped,true);
  assert.equal((await readRetentionExecution(db,now+3600001)).state,'unconfirmed');
  console.log('PASS: receiving Worker attribution, outcome immutability, period/version filters, CSV, telemetry trust, retention success/failure/lease');
 }finally{sqlite.close()}
})().catch(error=>{console.error(error);process.exitCode=1});
