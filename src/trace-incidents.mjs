// Trace v2 DEV3 — private administrator incident workflow.
// Never stores PDFs, document names, sessions, raw exception text or stack traces.
const FINGERPRINT=/^[0-9a-f]{8}$/;
const COMMIT=/^[0-9a-f]{40}$/;
const STATES=Object.freeze(['new','investigating','fix_candidate','verifying','resolved','reopened']);
const fail=(message,status=400)=>({error:message,status});
const redactRisk=/@|(?:[a-z]:[\\/])|https?:\/\/|\b\S+\.pdf\b|[\x00-\x1f\x7f]/i;
export async function incidentList(db,today){
 const result=await db.prepare("SELECT json_extract(trace_json,'$.fingerprint') fingerprint, feature, code, phase, COUNT(*) occurrences,MIN(received_ms) first_ms,MAX(received_ms) last_ms,COUNT(DISTINCT worker_version) version_count FROM analytics_diagnostics WHERE trace_schema_version=2 AND json_valid(trace_json)=1 AND day BETWEEN date(?,'-13 days') AND ? GROUP BY fingerprint,feature,code,phase ORDER BY last_ms DESC LIMIT 101")
  .bind(today,today).all();
 const states=await db.prepare('SELECT fingerprint,status,note,fix_commit,revision,created_ms,updated_ms,resolved_ms FROM admin_trace_incidents ORDER BY updated_ms DESC LIMIT 101').all();
 const stateMap=new Map((states.results||[]).map(row=>[row.fingerprint,row]));
 const rows=(result.results||[]).slice(0,100).map(row=>{
  const saved=stateMap.get(row.fingerprint);
  const status=saved?.status||'new',resolvedAt=saved?.resolved_ms??null;
  return {...row,status,note:saved?.note||'',fix_commit:saved?.fix_commit||null,revision:saved?.revision||0,
   resolved_ms:resolvedAt,recurred:status==='resolved'&&resolvedAt!==null&&row.last_ms>resolvedAt};
 });
 return {windowDays:14,retentionDays:90,items:rows,truncated:(result.results||[]).length>100};
}
export async function incidentHistory(db,fingerprint){
 if(!FINGERPRINT.test(fingerprint||''))throw new RangeError('Invalid fingerprint');
 const rows=await db.prepare('SELECT status,note,fix_commit,happened_ms,revision FROM admin_trace_incident_audit WHERE fingerprint=? ORDER BY id DESC LIMIT 30').bind(fingerprint).all();
 return {fingerprint,items:rows.results||[]};
}
export async function updateIncident(db,today,fingerprint,body,now=Date.now()){
 if(!FINGERPRINT.test(fingerprint||'')||!body||typeof body!=='object'||Array.isArray(body)||
  Object.keys(body).sort().join(',')!=='fix_commit,note,revision,status'||
  !STATES.includes(body.status)||typeof body.note!=='string'||body.note.length>400||redactRisk.test(body.note)||
  !Number.isSafeInteger(body.revision)||body.revision<0||body.revision>1000000||
  !(body.fix_commit===null||(typeof body.fix_commit==='string'&&COMMIT.test(body.fix_commit)))||
  !Number.isSafeInteger(now)||now<=0)return fail('상태·메모·수정 커밋·수정 버전을 확인하세요.');
 const list=await db.prepare("SELECT 1 yes FROM analytics_diagnostics WHERE trace_schema_version=2 AND json_valid(trace_json)=1 AND json_extract(trace_json,'$.fingerprint')=? AND day BETWEEN date(?,'-13 days') AND ? LIMIT 1").bind(fingerprint,today,today).first();
 const exists=await db.prepare('SELECT revision FROM admin_trace_incidents WHERE fingerprint=?').bind(fingerprint).first();
 if(!list&&!exists)return fail('해당 오류 사건을 찾지 못했습니다.',404);
 // CAS + history in a single D1 transaction. An older browser cannot overwrite
 // a newer decision, and a failed write cannot create an orphan audit entry.
 const results=await db.batch([
  db.prepare("INSERT OR IGNORE INTO admin_trace_incidents(fingerprint,status,note,fix_commit,revision,created_ms,updated_ms) SELECT ?,'new','',NULL,0,?,? WHERE EXISTS (SELECT 1 FROM analytics_diagnostics WHERE trace_schema_version=2 AND json_valid(trace_json)=1 AND json_extract(trace_json,'$.fingerprint')=? AND day BETWEEN date(?,'-13 days') AND ?)").bind(fingerprint,now,now,fingerprint,today,today),
  db.prepare('UPDATE admin_trace_incidents SET status=?,note=?,fix_commit=?,revision=revision+1,updated_ms=?,resolved_ms=CASE WHEN ?=\'resolved\' THEN ? WHEN ?=\'reopened\' THEN NULL ELSE resolved_ms END WHERE fingerprint=? AND revision=?')
   .bind(body.status,body.note.trim(),body.fix_commit,now,body.status,now,body.status,fingerprint,body.revision),
  db.prepare('INSERT INTO admin_trace_incident_audit(fingerprint,status,note,fix_commit,happened_ms,revision) SELECT fingerprint,status,note,fix_commit,?,revision FROM admin_trace_incidents WHERE fingerprint=? AND changes()>0').bind(now,fingerprint)
 ]);
 if(results[1]?.meta?.changes!==1)return fail('다른 관리자 화면에서 먼저 수정했습니다. 새로고침 후 다시 시도하세요.',409);
 return {ok:true,revision:body.revision+1};
}
