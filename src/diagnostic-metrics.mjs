import rules from './assets/sunrise-diagnostics.js';
import {operationScope} from './operation-metrics.mjs';
import {toAdminCsv} from './admin-csv.mjs';
export async function diagnosticSummary(db,today,url){
 const scope=operationScope(url),feature=url.searchParams.get('feature')||'all';
 if(!['all','open','batch_split','batch_merge'].includes(feature))throw new RangeError('Invalid diagnostic feature');
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
