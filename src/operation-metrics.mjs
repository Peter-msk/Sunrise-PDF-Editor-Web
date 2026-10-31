const features=['open','merge','split','extract_text'];
export async function recordOperation(db,data,today){
 if(typeof data.operationId!=='string'||!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(data.operationId)||!features.includes(data.feature)||!['started','succeeded','failed','cancelled'].includes(data.stage))return false;
 if(data.stage==='started'){
  await db.prepare("INSERT OR IGNORE INTO analytics_operations(day,session_id,operation_id,feature,state) SELECT ?,?,?,?,? WHERE EXISTS (SELECT 1 FROM analytics_sessions WHERE day=? AND session_id=?) AND (SELECT COUNT(*) FROM analytics_operations WHERE day=? AND session_id=?)<100")
   .bind(today,data.session,data.operationId,data.feature,'started',today,data.session,today,data.session).run();
 }else{
  await db.prepare("UPDATE analytics_operations SET state=? WHERE session_id=? AND operation_id=? AND feature=? AND state='started' AND day BETWEEN date(?,'-1 day') AND ?")
   .bind(data.stage,data.session,data.operationId,data.feature,today,today).run();
 }
 return true;
}
export async function operationSummary(db,today){
 const result=await db.prepare("SELECT feature,COUNT(*) attempts,SUM(CASE WHEN state='succeeded' THEN 1 ELSE 0 END) succeeded,SUM(CASE WHEN state='failed' THEN 1 ELSE 0 END) failed,SUM(CASE WHEN state='cancelled' THEN 1 ELSE 0 END) cancelled,SUM(CASE WHEN state='started' THEN 1 ELSE 0 END) pending FROM analytics_operations WHERE day BETWEEN date(?,'-13 days') AND ? GROUP BY feature").bind(today,today).all();
 const rows=features.map(feature=>{
  const raw=(result.results||[]).find(row=>row.feature===feature)||{};
  const row={feature};for(const key of ['attempts','succeeded','failed','cancelled','pending']){const n=Number(raw[key]||0);if(!Number.isSafeInteger(n)||n<0)throw Error('Invalid aggregate');row[key]=n}
  if(row.succeeded+row.failed+row.cancelled+row.pending!==row.attempts)throw Error('Inconsistent aggregate');
  return row;
 });
 return {windowDays:14,items:rows};
}
