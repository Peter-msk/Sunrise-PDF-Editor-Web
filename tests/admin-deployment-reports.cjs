'use strict';
const assert=require('node:assert/strict'),{createHmac}=require('node:crypto');
(async()=>{
 const fixture=require('./helpers/d1-sqlite.cjs').createD1Fixture();
 try{
  const worker=(await import('../src/worker.mjs')).default;
  const secret='synthetic-deployment-secret-12345678901234567890',origin='https://fixture.example.test';
  const env={DB:fixture.db,DEPLOYMENT_EVENT_SECRET:secret};
  const data={runId:'123456789',runAttempt:1,environment:'production',status:'succeeded',commitSha:'a'.repeat(40),workerVersion:'11111111-1111-4111-8111-111111111111'};
  const now=Date.now();
  const send=async(body=data,{stamp=now-1000,key=secret,raw,signature,contentType='application/json',environment=env}={})=>{
   raw??=JSON.stringify(body);
   const signed=signature||createHmac('sha256',key).update(String(stamp)+'.'+raw).digest('hex');
   return worker.fetch(new Request(origin+'/api/operations/deployments',{method:'POST',headers:{'content-type':contentType,'x-event-timestamp':String(stamp),'x-event-signature':signed},body:raw}),environment,{});
  };
  assert.equal((await send()).status,200);
  assert.equal((await send({...data,status:'failed'},{stamp:now-2000})).status,200);
  let stored=fixture.sqlite.prepare('SELECT * FROM operation_deployments').get();assert.equal(stored.status,'succeeded','older replay cannot replace a newer report');
  assert.equal((await send({...data,status:'failed'},{stamp:now})).status,200);
  assert.equal(fixture.sqlite.prepare('SELECT COUNT(*) n FROM operation_deployments').get().n,1);
  assert.equal(fixture.sqlite.prepare('SELECT status FROM operation_deployments').get().status,'failed');
  assert.equal((await send({...data,runId:'987654321',status:'rolled_back'},{stamp:now})).status,200);
  assert.equal((await send(data,{key:'wrong-secret'})).status,401);
  assert.equal((await send(data,{stamp:now-6*60000})).status,401);
  assert.equal((await send(data,{stamp:now+6*60000})).status,401);
  assert.equal((await send({...data,runAttempt:0})).status,400);
  assert.equal((await send(data,{raw:'{}',signature:createHmac('sha256',secret).update(String(now-1000)+'.'+JSON.stringify(data)).digest('hex')})).status,401);
  assert.equal((await send(data,{contentType:'text/plain'})).status,415);
  assert.equal((await send(data,{raw:'x'.repeat(4097)})).status,413);
  assert.equal((await send(data,{environment:{DB:fixture.db}})).status,503);
  assert.equal((await worker.fetch(new Request(origin+'/api/operations/deployments'),env,{})).status,405);
  assert.equal((await worker.fetch(new Request(origin+'/api/admin/deployments'),env,{})).status,401);
  assert.equal(fixture.sqlite.prepare('SELECT COUNT(*) n FROM operation_deployments').get().n,2,'all rejected reports must leave existing rows intact');
  const broken={DEPLOYMENT_EVENT_SECRET:secret,DB:{prepare(){throw Error('PRIVATE_DEPLOYMENT_DATABASE_FAILURE')}}};
  const failure=await send(data,{environment:broken});assert.equal(failure.status,503);assert(!(await failure.text()).includes('PRIVATE_DEPLOYMENT_DATABASE_FAILURE'));
  console.log('PASS: signed deployment reports, replay ordering, idempotence, tampering/clock/schema/size rejection and private failure output');
 }finally{fixture.close()}
})().catch(error=>{console.error(error);process.exitCode=1});
