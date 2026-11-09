import rules from './assets/sunrise-diagnostics.js';
import {operationScope} from './operation-metrics.mjs';
import {toAdminCsv} from './admin-csv.mjs';
export async function diagnosticSummary(db,today,url){
 const scope=operationScope(url),feature=url.searchParams.get('feature')||'all';
 if(!(feature==='all'||rules.OPERATION_FEATURES.includes(feature)))throw new RangeError('Invalid diagnostic feature');
 const args=[today,'-'+(scope.days-1)+' days',today,...(scope.version?[scope.version]:[]),...(feature==='all'?[]:[feature])];
 const where="day BETWEEN date(?,?) AND ?"+(scope.version?' AND worker_version=?':'')+(feature==='all'?'':' AND feature=?');
 const rows=await db.prepare('SELECT feature,code,phase,origin,size_bucket,page_bucket,browser,client_build,worker_version,COUNT(*) count,MIN(received_ms) first_ms,MAX(received_ms) last_ms FROM analytics_diagnostics WHERE '+where+' GROUP BY feature,code,phase,origin,size_bucket,page_bucket,browser,client_build,worker_version ORDER BY last_ms DESC,feature,code LIMIT 201').bind(...args).all();
 const items=(rows.results||[]).slice(0,200).map(row=>({...row,...rules.describe(row.code)}));
 const coarse=(feature==='all'||feature==='open')
  ?await db.prepare("SELECT day,feature,count FROM analytics_errors WHERE day BETWEEN date(?,?) AND ? AND feature='문서 열기' ORDER BY day DESC").bind(today,'-'+(scope.days-1)+' days',today).all()
  :{results:[]};
 return {windowDays:scope.days,version:scope.version,feature,retentionDays:14,timeResolution:'minute',items,truncated:(rows.results||[]).length>200,legacyOpen:coarse.results||[],legacyDefinition:'unlinked-unversioned-signals-not-confirmed-open-failures'};
}
export function diagnosticCsv(data){
 return toAdminCsv([['기능','원인 코드','단계','원인','조사 안내','횟수','최초 시각(ms)','최근 시각(ms)','입력 경로','크기 구간','페이지 구간','브라우저','화면 진단 빌드','수집 Worker 버전'],...data.items.map(x=>[x.feature,x.code,x.phase,x.label,x.action,x.count,x.first_ms,x.last_ms,x.origin,x.size_bucket,x.page_bucket,x.browser,x.client_build,x.worker_version])]);
}

// Admin-only read interface. Never select session IDs, operation IDs or document data.
const TRACE_ID=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
function safeTrace(row){
 const trace=rules.normalizeTrace(JSON.parse(row.trace_json));
 if(!trace||trace.id!==row.trace_id||trace.code!==row.code||trace.phase!==row.phase||trace.feature!==row.feature||row.trace_schema_version!==2)
  throw Error('Invalid persisted trace');
 return trace;
}
export async function traceList(db,today,url){
 const scope=operationScope(url),feature=url.searchParams.get('feature')||'all';
 if(!(feature==='all'||rules.OPERATION_FEATURES.includes(feature)))throw new RangeError('Invalid trace feature');
 const sql="SELECT trace_id,trace_schema_version,trace_json,received_ms,feature,code,phase,worker_version FROM analytics_diagnostics WHERE trace_schema_version=2 AND day BETWEEN date(?,?) AND ?"+
   (scope.version?' AND worker_version=?':'')+(feature==='all'?'':' AND feature=?')+' ORDER BY received_ms DESC,id DESC LIMIT 51';
 const result=await db.prepare(sql).bind(today,'-'+(scope.days-1)+' days',today,...(scope.version?[scope.version]:[]),...(feature==='all'?[]:[feature])).all();
 const rows=result.results||[];
 return {schema:2,windowDays:scope.days,version:scope.version,retentionDays:14,truncated:rows.length>50,
   items:rows.slice(0,50).map(row=>{const trace=safeTrace(row);return {id:trace.id,feature:row.feature,code:row.code,phase:row.phase,
      callsite:trace.module+'.'+trace.callsite,fingerprint:trace.fingerprint,received_ms:row.received_ms,worker_version:row.worker_version}})};
}
export async function traceDetail(db,today,url){
 const id=url.searchParams.get('trace_id');
 if(typeof id!=='string'||!TRACE_ID.test(id))throw new RangeError('Invalid trace identifier');
 const row=await db.prepare("SELECT trace_id,trace_schema_version,trace_json,received_ms,feature,code,phase,worker_version FROM analytics_diagnostics WHERE trace_id=? AND day BETWEEN date(?,'-13 days') AND ? LIMIT 1").bind(id,today,today).first();
 if(!row)return null;
 const trace=safeTrace(row);
 return {schema:2,trace,received_ms:row.received_ms,worker_version:row.worker_version,retentionDays:14};
}
