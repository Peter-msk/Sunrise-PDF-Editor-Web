const features=['open','merge','split','extract_text','search','bookmark_edit','bookmark_auto','page_duplicate','page_delete','page_rotate','form_create','form_fill','highlight','batch_compress','batch_mark','batch_split','batch_merge','page_insert','page_extract','page_reorder','page_clipboard','bookmark_add','overlay_insert','overlay_edit','overlay_duplicate','overlay_delete'];
const validVersion=value=>typeof value==='string'&&(value==='unknown'||/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value));
export function workerVersion(env){
 const value=env?.CF_VERSION_METADATA?.id;
 return validVersion(value)?value.toLowerCase():'unknown';
}
export function operationScope(url){
 const days=Number(url.searchParams.get('days')||14),version=url.searchParams.get('version')||null;
 if(![7,14].includes(days)||(version!==null&&!validVersion(version)))throw new RangeError('Invalid operation scope');
 return {days,version:version?.toLowerCase()||null};
}
function range(today,scope={}){
 const days=scope.days??14,version=scope.version??null;
 if(![7,14].includes(days)||(version!==null&&!validVersion(version)))throw new RangeError('Invalid operation scope');
 return {days,version,sql:"day BETWEEN date(?,?) AND ?"+(version===null?'':' AND worker_version=?'),args:[today,'-'+(days-1)+' days',today,...(version===null?[]:[version])]};
}
export async function recordOperation(db,data,today,version='unknown'){
 if(typeof data.operationId!=='string'||!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(data.operationId)||!features.includes(data.feature)||!['started','succeeded','failed','cancelled'].includes(data.stage))return false;
 if(data.stage==='started'){
  await db.prepare("INSERT OR IGNORE INTO analytics_operations(day,session_id,operation_id,feature,state,worker_version) SELECT ?,?,?,?,?,? WHERE EXISTS (SELECT 1 FROM analytics_sessions WHERE day=? AND session_id=?) AND (SELECT COUNT(*) FROM analytics_operations WHERE day=? AND session_id=?)<100")
   .bind(today,data.session,data.operationId,data.feature,'started',version,today,data.session,today,data.session).run();
 }else{
  await db.prepare("UPDATE analytics_operations SET state=? WHERE session_id=? AND operation_id=? AND feature=? AND state='started' AND day BETWEEN date(?,'-1 day') AND ?")
   .bind(data.stage,data.session,data.operationId,data.feature,today,today).run();
 }
 return true;
}
export async function operationSummary(db,today,scope={}){
 const selected=range(today,scope);
 const result=await db.prepare("SELECT feature,COUNT(*) attempts,SUM(CASE WHEN state='succeeded' THEN 1 ELSE 0 END) succeeded,SUM(CASE WHEN state='failed' THEN 1 ELSE 0 END) failed,SUM(CASE WHEN state='cancelled' THEN 1 ELSE 0 END) cancelled,SUM(CASE WHEN state='started' THEN 1 ELSE 0 END) pending FROM analytics_operations WHERE "+selected.sql+" GROUP BY feature").bind(...selected.args).all();
 const rows=features.map(feature=>{
  const raw=(result.results||[]).find(row=>row.feature===feature)||{};
  const row={feature};for(const key of ['attempts','succeeded','failed','cancelled','pending']){const n=Number(raw[key]||0);if(!Number.isSafeInteger(n)||n<0)throw Error('Invalid aggregate');row[key]=n}
  if(row.succeeded+row.failed+row.cancelled+row.pending!==row.attempts)throw Error('Inconsistent aggregate');
  return row;
 });
 const versions=await db.prepare("SELECT worker_version FROM (SELECT day,worker_version FROM analytics_operations UNION ALL SELECT day,worker_version FROM analytics_save_operations) WHERE day BETWEEN date(?,?) AND ? GROUP BY worker_version ORDER BY MAX(day) DESC,worker_version LIMIT 201").bind(today,'-'+(selected.days-1)+' days',today).all();
 if((versions.results||[]).some(row=>!validVersion(row.worker_version)))throw Error('Invalid version');
 return {windowDays:selected.days,version:selected.version,versionDefinition:'receiving-worker-at-start',versions:(versions.results||[]).slice(0,200).map(row=>row.worker_version),versionsTruncated:(versions.results||[]).length>200,items:rows};
}

export async function saveSummary(db,today,scope={}){
 const selected=range(today,scope);
 const counts=await db.prepare("SELECT COUNT(*) attempts,SUM(CASE WHEN state='ready' THEN 1 ELSE 0 END) ready,SUM(CASE WHEN state='failed' THEN 1 ELSE 0 END) failed,SUM(CASE WHEN state='cancelled' THEN 1 ELSE 0 END) cancelled,SUM(CASE WHEN state='started' THEN 1 ELSE 0 END) pending,SUM(CASE WHEN retry_of IS NOT NULL THEN 1 ELSE 0 END) retries,SUM(CASE WHEN retry_of IS NOT NULL AND state='ready' THEN 1 ELSE 0 END) recovered FROM analytics_save_operations WHERE "+selected.sql).bind(...selected.args).first();
 const count=value=>{const n=Number(value??0);if(!Number.isSafeInteger(n)||n<0)throw Error('Invalid aggregate');return n};
 const result=Object.fromEntries(['attempts','ready','failed','cancelled','pending','retries','recovered'].map(key=>[key,count(counts?.[key])]));
 if(result.ready+result.failed+result.cancelled+result.pending!==result.attempts||result.retries>result.attempts||result.recovered>result.retries||result.recovered>result.ready)throw Error('Inconsistent count');
 return {windowDays:selected.days,version:selected.version,...result};
}
