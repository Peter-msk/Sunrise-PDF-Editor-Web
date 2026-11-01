// Private data retention. Keep purge statements in one place so cron and
// offline SQLite rehearsal use the same rules. No production data exports here.
export async function runAdminRetention(db,now=Date.now()){
 if(!db||!Number.isSafeInteger(now)||now<=0)throw Error('Invalid retention configuration');
 const date=new Date(now);
 if(!Number.isFinite(date.getTime())||now<90*86400000)throw Error('Invalid retention configuration');
 const execute=async(sql,...params)=>db.prepare(sql).bind(...params).run();
 const inquiryCutoff=new Date(now-90*86400000).toISOString();
 const rateCutoff=new Date(now-2*86400000).toISOString().slice(0,10);
 const sessionCutoff=new Date(now+9*3600000-14*86400000).toISOString().slice(0,10);
 // Inquiries and their change history must share the 90-day retention boundary.
 // Clean history first so no orphan is left when parent rows are removed.
 await execute('DELETE FROM inquiry_audit WHERE inquiry_id IN (SELECT id FROM inquiries WHERE created_at < ?) OR inquiry_id NOT IN (SELECT id FROM inquiries)',inquiryCutoff);
 await execute('DELETE FROM inquiries WHERE created_at < ?',inquiryCutoff);
 await execute('DELETE FROM inquiry_rate_limits WHERE day < ?',rateCutoff);
 await execute('DELETE FROM analytics_sessions WHERE day < ?',sessionCutoff);
 await execute('DELETE FROM admin_sessions WHERE expires_ms<? OR last_seen_ms<?',now,now-30*60*1000);
 await execute('DELETE FROM admin_login_limits WHERE window_start_ms<?',now-24*60*60*1000);
 return {ok:true,policy:{inquiriesDays:90,sessionDays:14,rateLimitDays:2,idleMinutes:30}};
}

// A one-hour lease prevents overlapping scheduled attempts from replacing the
// current status. A failed attempt can have completed earlier cleanup steps.
export async function runTrackedAdminRetention(db,now=Date.now()){
 if(!db||!Number.isSafeInteger(now)||now<90*86400000)throw Error('Invalid retention configuration');
 const runId=crypto.randomUUID();
 const lease=await db.prepare("INSERT INTO admin_maintenance_status(id,run_id,state,started_ms) VALUES (1,?,'running',?) ON CONFLICT(id) DO UPDATE SET run_id=excluded.run_id,state='running',started_ms=excluded.started_ms,finished_ms=NULL,failed_step=NULL WHERE state<>'running' OR started_ms<? RETURNING run_id")
  .bind(runId,now,now-3600000).first();
 if(!lease||lease.run_id!==runId)return {ok:false,skipped:true};
 let step='private_data';
 try{
  const result=await runAdminRetention(db,now);
  step='deployment_reports';
  await db.prepare('DELETE FROM operation_deployments WHERE reported_ms<?').bind(now-90*86400000).run();
  step='security_events';
  await db.prepare('DELETE FROM admin_security_events WHERE happened_ms<?').bind(now-30*86400000).run();
  step='status_record';
  const finished=Math.max(now,Date.now());
  const updated=await db.prepare("UPDATE admin_maintenance_status SET state='succeeded',finished_ms=?,last_success_ms=?,failed_step=NULL WHERE id=1 AND run_id=?").bind(finished,finished,runId).run();
  if(updated.meta?.changes!==1)throw Error('Retention status lease was replaced');
  return result;
 }catch(error){
  try{await db.prepare("UPDATE admin_maintenance_status SET state='failed',finished_ms=?,failed_step=? WHERE id=1 AND run_id=?").bind(Math.max(now,Date.now()),step,runId).run()}
  catch{console.error('Retention failure status unavailable')}
  throw error;
 }
}
export async function readRetentionExecution(db,now=Date.now()){
 const row=await db.prepare('SELECT state,started_ms,finished_ms,last_success_ms,failed_step FROM admin_maintenance_status WHERE id=1').first();
 if(!row)return null;
 if(!['running','succeeded','failed'].includes(row.state))throw Error('Invalid retention state');
 for(const key of ['started_ms','finished_ms','last_success_ms'])if(row[key]!==null&&(!Number.isSafeInteger(row[key])||row[key]<=0))throw Error('Invalid retention timestamp');
 if(row.failed_step!==null&&!['private_data','deployment_reports','security_events','status_record'].includes(row.failed_step))throw Error('Invalid retention step');
 if(row.state==='running'&&row.finished_ms!==null||row.state!=='running'&&row.finished_ms===null||row.state==='succeeded'&&row.last_success_ms===null)throw Error('Invalid retention result');
 if(row.finished_ms!==null&&row.finished_ms<row.started_ms)throw Error('Invalid retention interval');
 const stale=row.state==='running'&&row.started_ms<now-3600000;
 return {state:stale?'unconfirmed':row.state,startedAt:new Date(row.started_ms).toISOString(),finishedAt:row.finished_ms===null?null:new Date(row.finished_ms).toISOString(),lastSuccessAt:row.last_success_ms===null?null:new Date(row.last_success_ms).toISOString(),failedStep:row.failed_step};
}
