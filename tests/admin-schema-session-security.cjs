'use strict';
const assert=require('node:assert/strict');
(async()=>{
 const fixture=require('./helpers/d1-sqlite.cjs').createD1Fixture();
 const {sqlite,db}=fixture;
 const originalNow=Date.now;
 try{
  const worker=(await import('../src/worker.mjs')).default;
  const origin='https://fixture.example.test';
  const proof='a'.repeat(64),salt='b'.repeat(32),newProof='c'.repeat(64),newSalt='d'.repeat(32);
  const env={DB:db,ADMIN_BOOTSTRAP_TOKEN:'fixture-bootstrap-only-token-12345678901234567890',INQUIRY_HASH_SALT:'PRIVATE_FIXTURE_VERIFIER_SECRET',DEPLOYMENT_EVENT_SECRET:'fixture-deployment-secret-12345678901234567890',CF_VERSION_METADATA:{id:'11111111-1111-4111-8111-111111111111'},ASSETS:{fetch:async()=>new Response('fixture')}};
  const call=(route,{method='GET',body,cookie,actualOrigin=origin}={})=>worker.fetch(new Request(origin+route,{method,headers:{origin:actualOrigin,'content-type':'application/json',...(cookie?{cookie}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})}),env,{});
  assert.equal((await call('/api/admin/readiness')).status,401);
  let response=await call('/api/auth/setup',{method:'POST',body:{username:'admin',passwordProof:proof,passwordSalt:salt,bootstrapToken:env.ADMIN_BOOTSTRAP_TOKEN}});
  assert.equal(response.status,201);
  const login=async(passwordProof=proof)=>{
   const result=await call('/api/auth/login',{method:'POST',body:{username:'admin',passwordProof}});
   assert.equal(result.status,200);
   const header=result.headers.get('set-cookie');assert.match(header,/Secure; HttpOnly; SameSite=Strict/);
   return header.split(';')[0];
  };
  const first=await login(),second=await login();assert.notEqual(first,second);
  response=await call('/api/auth/sessions',{cookie:second});assert.equal(response.status,200);
  assert.equal((await response.json()).activeSessions,2);
  response=await call('/api/admin/readiness',{cookie:second});assert.equal(response.status,200);
  let readiness=await response.json();assert.equal(readiness.schema.ready,true);assert.deepEqual(readiness.schema.missingTables,[]);assert.deepEqual(readiness.schema.missingColumns,[]);
  assert.deepEqual(readiness.configuration,{adminVerifier:true,deploymentReporting:true,workerVersion:true});
  sqlite.exec('ALTER TABLE analytics_operations RENAME COLUMN worker_version TO fixture_previous_version');
  response=await call('/api/admin/readiness',{cookie:second});readiness=await response.json();
  assert.equal(readiness.schema.ready,false);assert(readiness.schema.missingColumns.includes('analytics_operations.worker_version'));
  sqlite.exec('ALTER TABLE analytics_operations RENAME COLUMN fixture_previous_version TO worker_version');
  response=await call('/api/auth/login',{method:'POST',body:{username:'admin',passwordProof:'e'.repeat(64)}});assert.equal(response.status,401);
  response=await call('/api/admin/security-events',{cookie:second});const history=await response.json();
  assert.equal(history.items.filter(x=>x.kind==='login_succeeded').length,2);assert.equal(history.items.filter(x=>x.kind==='login_failed').length,1);
  for(const item of history.items){assert.deepEqual(Object.keys(item).sort(),['happened_ms','kind']);assert(Number.isSafeInteger(item.happened_ms))}
  assert(!JSON.stringify(history).includes(proof));assert(!JSON.stringify(history).includes(env.INQUIRY_HASH_SALT));
  const hashes=sqlite.prepare('SELECT token_hash FROM admin_sessions ORDER BY created_ms,token_hash').all();assert.equal(hashes.length,2);
  // Expire exactly the first cookie's session, without waiting on real clocks.
  const raw=first.split('=')[1],crypto=require('node:crypto');
  const digest=crypto.createHash('sha256').update(raw).digest('hex');
  sqlite.prepare('UPDATE admin_sessions SET last_seen_ms=? WHERE token_hash=?').run(Date.now()-31*60000,digest);
  assert.equal((await call('/api/auth/me',{cookie:first})).status,401);
  response=await call('/api/auth/sessions',{cookie:second});assert.equal((await response.json()).activeSessions,1);
  assert.equal((await call('/api/auth/logout-all',{method:'POST',body:{},cookie:second,actualOrigin:'https://attacker.example.test'})).status,403);
  assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM admin_sessions').get().n,2);
  assert.equal((await call('/api/auth/logout-all',{method:'POST',body:{},cookie:second})).status,200);
  assert.equal((await call('/api/admin/readiness',{cookie:second})).status,401);
  assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM admin_security_events WHERE kind=?').get('sessions_revoked').n,1);
  const third=await login();
  response=await call('/api/auth/change-password',{method:'POST',cookie:third,body:{currentProof:proof,newProof,newSalt}});assert.equal(response.status,200);
  assert.equal((await call('/api/auth/me',{cookie:third})).status,401);
  assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM admin_sessions').get().n,0);
  assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM admin_security_events WHERE kind=?').get('password_changed').n,1);
  // Controlled reset to a prior limiter window verifies the rotated proof.
  sqlite.prepare('UPDATE admin_login_limits SET window_start_ms=?,blocked_until_ms=0').run(Date.now()-16*60000);
  // Session policy deliberately rejects created_ms <= the password-change cutoff.
  // In-memory SQLite and direct Worker calls can finish within one millisecond;
  // place this post-rotation login strictly after that boundary, without sleeps.
  const rotatedAt=Date.parse(sqlite.prepare('SELECT updated_at FROM admin_accounts WHERE id=1').get().updated_at);
  assert(Number.isFinite(rotatedAt));
  Date.now=()=>Math.max(originalNow(),rotatedAt+1);
  const fourth=await login(newProof);
  response=await call('/api/admin/retention',{cookie:fourth});assert.equal(response.status,200);assert.equal((await response.json()).execution,null);
  await worker.scheduled({},{DB:db});
  response=await call('/api/admin/retention',{cookie:fourth});const retention=await response.json();
  assert.equal(retention.execution.state,'succeeded');assert(retention.lastCleanup);assert.equal(retention.backup,'operator-managed');
  console.log('PASS: current schema readiness, missing columns, real session expiry/revocation, security history privacy, password rotation and tracked scheduled execution');
 }finally{Date.now=originalNow;fixture.close()}
})().catch(error=>{console.error(error);process.exitCode=1});
