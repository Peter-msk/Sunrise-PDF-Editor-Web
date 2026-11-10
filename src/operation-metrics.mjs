import diagnostics from './assets/sunrise-diagnostics.js';
const features=diagnostics.OPERATION_FEATURES;
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
export async function recordOperation(db,data,today,version='unknown',now=Date.now()){
 if(typeof data.operationId!=='string'||!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(data.operationId)||!features.includes(data.feature)||!['started','succeeded','failed','cancelled'].includes(data.stage))return false;
 if(data.diagnostic!==undefined&&data.stage!=='failed')return false;
 if(data.stage==='started'){
  const inserted=await db.prepare("INSERT OR IGNORE INTO analytics_operations(day,session_id,operation_id,feature,state,worker_version) SELECT ?,?,?,?,?,? WHERE EXISTS (SELECT 1 FROM analytics_sessions WHERE day=? AND session_id=?) AND (SELECT COUNT(*) FROM analytics_operations WHERE day=? AND session_id=?)<100")
   .bind(today,data.session,data.operationId,data.feature,'started',version,today,data.session,today,data.session).run();
  // A start is accepted only if an operation row actually exists. A duplicate
  // delivery of the same event is idempotently successful, but missing visit
  // or an exhausted daily quota must not be reported as recorded.
  if(inserted?.meta?.changes===1)return true;
  const existing=await db.prepare("SELECT 1 accepted FROM analytics_operations WHERE session_id=? AND operation_id=? AND feature=? AND day BETWEEN date(?,'-1 day') AND ? LIMIT 1")
   .bind(data.session,data.operationId,data.feature,today,today).first();
  return !!existing;
 }else{
  const change=db.prepare("UPDATE analytics_operations SET state=? WHERE session_id=? AND operation_id=? AND feature=? AND state='started' AND day BETWEEN date(?,'-1 day') AND ?")
   .bind(data.stage,data.session,data.operationId,data.feature,today,today);
  if(data.diagnostic!==undefined){
   const detail=diagnostics.normalize(data.diagnostic);
   if(data.stage!=='failed'||!detail||(detail.trace&&detail.trace.feature!==data.feature))return false;
   const feature=data.feature;
   const category=feature==='open'?'문서 열기':feature==='save_prepare'?'저장':feature.startsWith('pdf_')?'PDF 보안':feature.startsWith('signature_')?'전자서명':feature.startsWith('office_')?'Office 변환':/bookmark/.test(feature)?'북마크':/compress/.test(feature)?'압축':feature==='search'?'검색':/page|split/.test(feature)?'페이지':/overlay|highlight/.test(feature)?'주석':'기타';
   await db.batch([
    change,
    db.prepare("INSERT INTO analytics_diagnostics(day,session_id,operation_id,feature,code,phase,origin,size_bucket,page_bucket,browser,client_build,worker_version,received_ms,trace_schema_version,trace_id,trace_json) SELECT day,session_id,operation_id,feature,?,?,?,?,?,?,?,worker_version,?,?,?,? FROM analytics_operations WHERE session_id=? AND operation_id=? AND state='failed' AND changes()>0 AND (SELECT COUNT(*) FROM analytics_diagnostics WHERE day=analytics_operations.day AND session_id=analytics_operations.session_id)<40")
     .bind(detail.code,detail.phase,detail.origin,detail.size,detail.pages,detail.browser,detail.build,Math.floor(now/60000)*60000,detail.trace?.schema??null,detail.trace?.id??null,detail.trace?JSON.stringify(detail.trace):null,data.session,data.operationId),
    db.prepare("UPDATE analytics_sessions SET error_events=error_events+1,last_error_ms=? WHERE session_id=? AND day=(SELECT day FROM analytics_diagnostics WHERE session_id=? AND operation_id=?) AND changes()>0 AND error_events<40")
     .bind(now,data.session,data.session,data.operationId),
    db.prepare("INSERT INTO analytics_errors(day,feature,count) SELECT day,?,1 FROM analytics_diagnostics WHERE session_id=? AND operation_id=? AND changes()>0 ON CONFLICT(day,feature) DO UPDATE SET count=count+1")
     .bind(category,data.session,data.operationId)
   ]);
  }else await change.run();
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
