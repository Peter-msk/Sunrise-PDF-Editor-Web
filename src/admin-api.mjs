// Server-side admin authorization + privacy-minimal aggregate telemetry.
// No PDF bytes, names, document text, email, IP or client error message enters analytics.
import {readJsonObject} from './bounded-json.mjs';
import {readDeploymentReports} from './admin-deployments.mjs';
import {recordOperation,operationSummary,saveSummary,operationScope,workerVersion} from './operation-metrics.mjs';
import {readRetentionExecution} from './admin-retention.mjs';
import {adminReadiness} from './admin-readiness.mjs';
const APP_VERSION='1.0.0';
const FEATURES=['문서 열기','페이지','검색','북마크','압축','저장','주석','기타'];
export const PUBLICATION_WINDOW_SQL="date(first_published_at)>date('now','+9 hours','-7 days') AND date(first_published_at)<=date('now','+9 hours')";
const PUBLICATION_STATUS_SQL=`CASE WHEN is_active=0 AND first_published_at IS NULL THEN 'draft' WHEN is_active=0 THEN 'hidden' WHEN date(first_published_at) IS NULL THEN 'unknown' WHEN date(first_published_at)>date('now','+9 hours') THEN 'scheduled' WHEN ${PUBLICATION_WINDOW_SQL} THEN 'published' ELSE 'expired' END AS visibility`;
const response=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'}});
const day=()=>new Date(Date.now()+9*3600000).toISOString().slice(0,10);
const sameOrigin=(req,url)=>req.headers.get('origin')===url.origin;
const validSid=(id)=>typeof id==='string'&&/^[0-9a-f]{8}-[0-9a-f-]{27,40}$/i.test(id)&&id.length<=48;
export async function telemetry(request,env,url){
  if(request.method!=='POST')return response({error:'Method not allowed'},405);
  if(!sameOrigin(request,url))return response({error:'Invalid origin'},403);
  const data=await readJsonObject(request,1024);
  if(!data||!validSid(data.session)||!['visit','pulse','failure','save_operation','operation'].includes(data.type))return response({error:'Invalid event'},400);
  const now=Date.now(),today=day(),db=env.DB;
  try{
    if(data.type==='operation'){
      if(!await recordOperation(db,data,today,workerVersion(env)))return response({error:'Invalid operation'},400);
    }else if(data.type==='visit'){
      const previous=await db.prepare("SELECT 1 found FROM analytics_sessions WHERE session_id=? AND day BETWEEN date(?,'-13 days') AND date(?,'-1 day') LIMIT 1").bind(data.session,today,today).first();
      await db.batch([
        db.prepare('INSERT OR IGNORE INTO analytics_sessions(day,session_id,last_pulse_ms) VALUES (?,?,?)').bind(today,data.session,now),
        db.prepare('INSERT INTO analytics_daily(day,visits,returning_visits) SELECT ?,1,? WHERE changes()>0 ON CONFLICT(day) DO UPDATE SET visits=visits+1,returning_visits=returning_visits+excluded.returning_visits').bind(today,previous?1:0)
      ]);
    } else if(data.type==='pulse'){
      if(data.area!=='editor'||!Number.isInteger(data.seconds)||data.seconds<1||data.seconds>15)return response({error:'Invalid duration'},400);
      await db.batch([
        db.prepare('UPDATE analytics_sessions SET last_pulse_ms=?,active_seconds=active_seconds+? WHERE day=? AND session_id=? AND last_pulse_ms<=?').bind(now,data.seconds,today,data.session,now-8000),
        db.prepare('INSERT INTO analytics_daily(day,editor_seconds) SELECT ?,? WHERE changes()>0 ON CONFLICT(day) DO UPDATE SET editor_seconds=editor_seconds+excluded.editor_seconds').bind(today,data.seconds)
      ]);
    } else if(data.type==='save_operation'){
      const uuid=value=>typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
      if(!uuid(data.operationId)||!['started','ready','failed','cancelled'].includes(data.stage)||(data.retryOf!=null&&(!uuid(data.retryOf)||data.retryOf===data.operationId||data.stage!=='started')))return response({error:'Invalid operation'},400);
      if(data.stage==='started'){
        await db.prepare("INSERT OR IGNORE INTO analytics_save_operations(day,session_id,operation_id,state,worker_version,retry_of) SELECT ?,?,?,?,?,CASE WHEN EXISTS (SELECT 1 FROM analytics_save_operations WHERE session_id=? AND operation_id=? AND state='failed' AND day BETWEEN date(?,'-1 day') AND ?) AND NOT EXISTS (SELECT 1 FROM analytics_save_operations WHERE session_id=? AND retry_of=?) THEN ? ELSE NULL END WHERE EXISTS (SELECT 1 FROM analytics_sessions WHERE day=? AND session_id=?) AND (SELECT COUNT(*) FROM analytics_save_operations WHERE day=? AND session_id=?)<40")
          .bind(today,data.session,data.operationId,'started',workerVersion(env),data.session,data.retryOf||null,today,today,data.session,data.retryOf||null,data.retryOf||null,today,data.session,today,data.session).run();
      }else{
        await db.prepare("UPDATE analytics_save_operations SET state=? WHERE session_id=? AND operation_id=? AND state='started' AND day>=date(?,'-1 day') AND day<=?").bind(data.stage,data.session,data.operationId,today,today).run();
      }
    } else {
      if(!FEATURES.includes(data.feature))return response({error:'Invalid feature'},400);
      const accepted=await db.prepare('UPDATE analytics_sessions SET last_error_ms=?,error_events=error_events+1 WHERE day=? AND session_id=? AND last_error_ms<=? AND error_events<40 RETURNING session_id').bind(now,today,data.session,now-3000).first();
      if(accepted)await db.prepare('INSERT INTO analytics_errors(day,feature,count) VALUES (?,?,1) ON CONFLICT(day,feature) DO UPDATE SET count=count+1').bind(today,data.feature).run();
    }
    return response({ok:true});
  }catch(e){console.error('aggregate metrics error',e?.name);return response({error:'metrics unavailable'},503)}
}
export async function adminIdentity(ctx,env){
  if(!ctx?.access||!env.ADMIN_EMAIL)return null;
  try{
    const identity=await ctx.access.getIdentity();
    const email=identity?.email?.trim().toLowerCase();
    return email&&email===env.ADMIN_EMAIL.trim().toLowerCase()?email:null;
  }catch{return null}
}
const earliestWeek=(date)=>{
  const d=new Date(date+'T00:00:00Z'),weekday=d.getUTCDay();
  d.setUTCDate(d.getUTCDate()-(weekday+6)%7);return d.toISOString().slice(0,10);
};
export async function adminApi(request,env,url,identity){
  const path=url.pathname,db=env.DB,today=day();
  if(path==='/api/admin/security-events'){
    if(request.method!=='GET')return response({error:'Method not allowed'},405);
    try{const result=await db.prepare('SELECT kind,happened_ms FROM admin_security_events ORDER BY happened_ms DESC,id DESC LIMIT 30').all();return response({items:result.results||[],retentionDays:30})}catch{return response({error:'Security history unavailable'},503)}
  }
  if(path==='/api/admin/readiness'){
    if(request.method!=='GET')return response({error:'Method not allowed'},405);
    try{return response(await adminReadiness(env))}catch{return response({error:'Readiness unavailable'},503)}
  }
  if(path==='/api/admin/retention'){
    if(request.method!=='GET')return response({error:'Method not allowed'},405);
    const now=Date.now(),cutoff=new Date(now-90*86400000).toISOString();
    const [inquiries,sessions,execution]=await Promise.all([
      db.prepare('SELECT COUNT(*) count FROM inquiries WHERE created_at<?').bind(cutoff).first(),
      db.prepare("SELECT COUNT(*) count FROM analytics_sessions WHERE day<date(?,'-14 days')").bind(today).first(),
      readRetentionExecution(db,now)
    ]);
    return response({checkedAt:new Date(now).toISOString(),policy:{inquiriesDays:90,sessionDays:14,deploymentReportDays:90,securityEventDays:30},pending:{inquiries:Number(inquiries?.count||0),sessions:Number(sessions?.count||0)},backup:'operator-managed',execution,lastCleanup:execution?.lastSuccessAt||null});
  }
  if(path==='/api/admin/deployments')return readDeploymentReports(request,env);
  if(path==='/api/admin/session-usage'){
    if(request.method!=='GET')return response({error:'Method not allowed'},405);
    try{
      const [usage,visits]=await Promise.all([
        db.prepare("SELECT COUNT(*) sessions,COALESCE(SUM(active_seconds),0) seconds FROM analytics_sessions WHERE active_seconds>0 AND day BETWEEN date(?,'-13 days') AND ?").bind(today,today).first(),
        db.prepare("SELECT COALESCE(SUM(visits),0) visits,COALESCE(SUM(returning_visits),0) returning FROM analytics_daily WHERE day BETWEEN date(?,'-13 days') AND ?").bind(today,today).first()
      ]);
      const count=value=>{const n=Number(value||0);if(!Number.isSafeInteger(n)||n<0)throw Error('Invalid count');return n};
      const sessions=count(usage?.sessions),seconds=count(usage?.seconds),total=count(visits?.visits),returning=count(visits?.returning);
      if(returning>total)throw Error('Inconsistent count');
      return response({windowDays:14,editorSessions:sessions,seconds,averageSeconds:sessions?Math.round(seconds/sessions):null,visits:total,returningTabDays:returning,idleSeconds:120});
    }catch{return response({error:'Session usage unavailable'},503)}
  }
  if(['/api/admin/operations','/api/admin/save-quality','/api/admin/operations.csv'].includes(path)){
    if(request.method!=='GET')return response({error:'Method not allowed'},405);
    let scope;try{scope=operationScope(url)}catch{return response({error:'기간은 7·14일, 버전은 목록에서 선택해 주세요.'},400)}
    try{
      if(path==='/api/admin/operations')return response(await operationSummary(db,today,scope));
      if(path==='/api/admin/save-quality')return response(await saveSummary(db,today,scope));
      const [operations,save]=await Promise.all([operationSummary(db,today,scope),saveSummary(db,today,scope)]);
      const rows=[['기간(일)','수집 Worker 버전','기능 코드','시도','완료','실패','취소','미확인','완료·실패 중 실패(%)']];
      for(const item of [...operations.items,{feature:'save_preparation',...save,succeeded:save.ready}]){
        const settled=item.succeeded+item.failed;
        rows.push([scope.days,scope.version||'all',item.feature,item.attempts,item.succeeded,item.failed,item.cancelled,item.pending,settled?(item.failed/settled*100).toFixed(1):'']);
      }
      const csv='\ufeff'+rows.map(row=>row.map(value=>'"'+String(value).replaceAll('"','""')+'"').join(',')).join('\r\n')+'\r\n';
      return new Response(csv,{headers:{'content-type':'text/csv; charset=utf-8','content-disposition':`attachment; filename="sunrise-operations-${today}.csv"`,'cache-control':'no-store','x-content-type-options':'nosniff'}});
    }catch{return response({error:'Operation statistics unavailable'},503)}
  }
  // Private, read-only point-in-time check; not an uptime claim.
  if(path==='/api/admin/health'){
    if(request.method!=='GET')return response({error:'Method not allowed'},405);
    const started=Date.now();let database='unavailable';
    try{
      const probe=await db.prepare('SELECT 1 AS ok').first();
      if(Number(probe?.ok)===1)database='ready';
    }catch{/* Do not expose raw D1 error messages. */}
    const rawId=env.CF_VERSION_METADATA?.id;
    const deploymentId=typeof rawId==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(rawId)?rawId:null;
    // Cloudflare version metadata is bound at deploy time. A dashboard release
    // label is a fallback, not a substitute for the actual Worker version ID.
    const rawTag=env.CF_VERSION_METADATA?.tag;
    const explicitTag=env.RELEASE_VERSION;
    const validTag=value=>typeof value==='string'&&/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(value);
    const releaseTag=validTag(rawTag)?rawTag:validTag(explicitTag)?explicitTag:null;
    const source=validTag(rawTag)?'cloudflare':validTag(explicitTag)?'configured':null;
    const rawCreated=env.CF_VERSION_METADATA?.timestamp;
    const parsedCreated=typeof rawCreated==='string'&&rawCreated.length<=50?Date.parse(rawCreated):NaN;
    const versionCreatedAt=Number.isFinite(parsedCreated)?new Date(parsedCreated).toISOString():null;
    const healthy=database==='ready';
    return response({
      status:healthy?'ready':'degraded',
      services:{worker:'responsive',database},
      checkedAt:new Date().toISOString(),probeMs:Math.max(0,Date.now()-started),
      version:{application:APP_VERSION,releaseTag,deploymentId,source,versionCreatedAt}
    },healthy?200:503);
  }
  // Session quality is measured over 14 KST calendar days because the
  // scheduled retention policy removes older analytics_sessions rows.
  // This is NOT a per-feature operation failure rate.
  if(path==='/api/admin/quality'){
    if(request.method!=='GET')return response({error:'Method not allowed'},405);
    const [totals,byDay,agedInquiries]=await Promise.all([
      db.prepare("SELECT COUNT(*) sessions,COALESCE(SUM(CASE WHEN error_events>0 THEN 1 ELSE 0 END),0) affected FROM analytics_sessions WHERE day BETWEEN date(?,'-13 days') AND ?").bind(today,today).first(),
      db.prepare("SELECT day,COUNT(*) sessions,COALESCE(SUM(CASE WHEN error_events>0 THEN 1 ELSE 0 END),0) affected FROM analytics_sessions WHERE day BETWEEN date(?,'-13 days') AND ? GROUP BY day ORDER BY day").bind(today,today).all(),
      db.prepare("SELECT COUNT(*) count FROM inquiries WHERE status='new' AND created_at < strftime('%Y-%m-%dT%H:%M:%fZ','now','-48 hours')").first()
    ]);
    const safe=value=>{const n=Number(value??0);if(!Number.isSafeInteger(n)||n<0)throw Error('Invalid aggregate');return n};
    const total=safe(totals?.sessions),affected=safe(totals?.affected),overdue=safe(agedInquiries?.count);
    if(affected>total)throw Error('Inconsistent aggregate');
    const percentage=(n,d)=>d?Math.round(n/d*1000)/10:null;
    const trend=(byDay.results||[]).map(row=>{
      const sessions=safe(row.sessions),errors=safe(row.affected);
      if(!/^\d{4}-\d{2}-\d{2}$/.test(row.day)||errors>sessions)throw Error('Invalid daily quality data');
      return {day:row.day,sessions,affected:errors,percent:percentage(errors,sessions)};
    });
    const warning=total>=10&&affected>=3&&affected/total>=.15;
    return response({
      windowDays:14,since:today,
      sessions:{total,withErrors:affected,percent:percentage(affected,total)},
      trend,overdueInquiries:overdue,
      alerts:[
        ...(warning?[{code:'error-sessions',severity:'review',message:'최근 14일 오류 발생 세션 비율이 15% 이상입니다. 오류 발생 원인을 확인해 주세요.'}]:[]),
        ...(overdue?[{code:'old-inquiries',severity:'review',message:'48시간 이상 미확인 문의 '+overdue+'건이 있습니다.'}]:[])
      ],
      definition:'익명 탭 세션 중 최소 한 번의 오류가 기록된 세션 비율. 기능별 클릭/작업 성공률이 아니며, 최대 14일 보존되는 통계에 한정합니다.'
    });
  }
  if(path==='/api/admin/statistics.csv'&&request.method==='GET'){
    const days=Number(url.searchParams.get('days')||30);
    if(![7,14,30].includes(days))return response({error:'조회 기간은 7·14·30일만 지원합니다.'},400);
    const result=await db.prepare("SELECT day,visits,editor_seconds FROM analytics_daily WHERE day BETWEEN date(?,?) AND ? ORDER BY day").bind(today,'-'+(days-1)+' days',today).all();
    const number=value=>{const n=Number(value);if(!Number.isSafeInteger(n)||n<0)throw new Error('Invalid aggregate');return String(n)};
    const rows=[['날짜(KST)','방문 세션','활성 편집 시간(초)']];
    for(const row of result.results||[]){
      if(!/^\d{4}-\d{2}-\d{2}$/.test(row.day))throw new Error('Invalid aggregate date');
      rows.push([row.day,number(row.visits),number(row.editor_seconds)]);
    }
    const csv='\ufeff'+rows.map(row=>row.map(value=>'"'+value.replaceAll('"','""')+'"').join(',')).join('\r\n')+'\r\n';
    return new Response(csv,{headers:{'content-type':'text/csv; charset=utf-8','content-disposition':`attachment; filename="sunrise-statistics-${today}.csv"`,'cache-control':'no-store','x-content-type-options':'nosniff'}});
  }
  if(path==='/api/admin/site-updates'&&request.method==='GET'){
    const kind=url.searchParams.get('kind')||'all',status=url.searchParams.get('status')||'all',q=(url.searchParams.get('q')||'').trim();
    if(!['all','announcement','release'].includes(kind)||!['all','draft','hidden','unknown','scheduled','published','expired'].includes(status)||q.length>160)return response({error:'조회 조건을 확인해 주세요.'},400);
    const cursors={};
    for(const name of ['announcement','release']){
      const value=url.searchParams.get('before_'+name);
      if(value!==null&&(!/^\d+$/.test(value)||!Number.isSafeInteger(Number(value))))return response({error:'조회 위치를 확인해 주세요.'},400);
      cursors[name]=value===null?null:Number(value);
    }
    const escaped=q.replaceAll('\\','\\\\').replaceAll('%','\\%').replaceAll('_','\\_');
    const load=async(name)=>{
      if(kind!=='all'&&kind!==name||cursors[name]===0)return {items:[],next:null};
      const table=name==='announcement'?'site_announcements':'site_releases';
      const fields=name==='announcement'?'id,title,body,level,published_at,first_published_at,is_active,revision':'id,version,released_at,first_published_at,added,improved,removed,is_active,revision';
      const title=name==='announcement'?'title':'version';
      const where=[...(status==='all'?[]:['visibility=?']),...(q?[title+' LIKE ? ESCAPE char(92)']:[]),...(cursors[name]===null?[]:['id<?'])];
      const args=[...(status==='all'?[]:[status]),...(q?['%'+escaped+'%']:[]),...(cursors[name]===null?[]:[cursors[name]])];
      const result=await db.prepare('SELECT * FROM (SELECT '+fields+','+PUBLICATION_STATUS_SQL+' FROM '+table+')'+(where.length?' WHERE '+where.join(' AND '):'')+' ORDER BY id DESC LIMIT 51').bind(...args).all();
      const rows=result.results||[],items=rows.slice(0,50);
      return {items,next:rows.length>50?items.at(-1).id:null};
    };
    const [announcements,releases]=await Promise.all([load('announcement'),load('release')]);
    return response({today,announcements:announcements.items,releases:releases.items,next:{announcement:announcements.next,release:releases.next}});
  }
  const publicationMatch=path.match(/^\/api\/admin\/site-updates\/(announcement|release)(?:\/(\d+))?$/);
  if(publicationMatch&&['POST','PATCH'].includes(request.method)){
    if(!sameOrigin(request,url))return response({error:'Invalid origin'},403);
    const [,kind,idText]=publicationMatch;
    if((request.method==='POST'&&idText)||(request.method==='PATCH'&&!idText))return response({error:'Invalid request'},400);
    const id=idText?Number(idText):null;
    if(idText&&(!Number.isSafeInteger(id)||id<1))return response({error:'Invalid id'},400);
    const data=await readJsonObject(request,16384);
    if(!data||typeof data!=='object'||Array.isArray(data))return response({error:'입력 내용을 확인해 주세요.'},400);
    const text=(value,max,required=false)=>typeof value==='string'&&value.length<=max&&(!required||value.trim().length>0)&&!/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value);
    const active=data.is_active;
    if(request.method==='PATCH'&&(!Number.isSafeInteger(data.revision)||data.revision<0))return response({error:'최신 목록을 조회한 뒤 다시 저장해 주세요.'},400);
    if(typeof active!=='boolean')return response({error:'게시 상태를 확인해 주세요.'},400);
    if(kind==='announcement'){
      if(!text(data.title,160,true)||!text(data.body,3000,true)||!['info','warning'].includes(data.level))return response({error:'공지 제목과 내용을 확인해 주세요.'},400);
    } else if(!text(data.version,160,true)||!text(data.added,1000)||!text(data.improved,1000)||!text(data.removed,1000))return response({error:'업데이트 제목과 내용을 확인해 주세요.'},400);
    try{
      let result;
      if(kind==='announcement'&&request.method==='POST')result=await db.prepare('INSERT INTO site_announcements(title,body,level,published_at,is_active) VALUES (?,?,?,?,?)').bind(data.title.trim(),data.body.trim(),data.level,today,Number(active)).run();
      if(kind==='announcement'&&request.method==='PATCH')result=await db.prepare('UPDATE site_announcements SET title=?,body=?,level=?,is_active=?,revision=revision+1 WHERE id=? AND revision=?').bind(data.title.trim(),data.body.trim(),data.level,Number(active),id,data.revision).run();
      if(kind==='release'&&request.method==='POST')result=await db.prepare('INSERT INTO site_releases(version,released_at,added,improved,removed,is_active) VALUES (?,?,?,?,?,?)').bind(data.version.trim(),today,data.added.trim(),data.improved.trim(),data.removed.trim(),Number(active)).run();
      if(kind==='release'&&request.method==='PATCH')result=await db.prepare('UPDATE site_releases SET version=?,added=?,improved=?,removed=?,is_active=?,revision=revision+1 WHERE id=? AND revision=?').bind(data.version.trim(),data.added.trim(),data.improved.trim(),data.removed.trim(),Number(active),id,data.revision).run();
      if(request.method==='PATCH'&&result.meta?.changes===0){
        const table=kind==='announcement'?'site_announcements':'site_releases';
        const exists=await db.prepare('SELECT id FROM '+table+' WHERE id=?').bind(id).first();
        return exists?response({error:'다른 창에서 변경된 항목입니다. 목록을 새로 조회해 변경 내용을 비교한 뒤 저장해 주세요.'},409):response({error:'항목을 찾을 수 없습니다.'},404);
      }
      return response({ok:true},request.method==='POST'?201:200);
    }catch(error){
      if(/unique constraint/i.test(String(error?.message||'')))return response({error:'같은 이름의 업데이트가 이미 있습니다.'},409);
      console.error('publication update failed',error?.name||'unknown');
      return response({error:'저장하지 못했습니다. 다시 시도해 주세요.'},503);
    }
  }
  if(path==='/api/admin/overview'&&request.method==='GET'){
    const value=url.searchParams.get('days');
    const days=value===null?14:Number(value);
    if(![7,14,30].includes(days))return response({error:'조회 기간은 7·14·30일만 지원합니다.'},400);
    const range='-'+(days-1)+' days',monday=earliestWeek(today);
    const [all,week,tod,series,errors,inq,month,previous]=await Promise.all([
      db.prepare('SELECT COALESCE(SUM(visits),0) visits,COALESCE(SUM(editor_seconds),0) seconds FROM analytics_daily').first(),
      db.prepare('SELECT COALESCE(SUM(visits),0) visits FROM analytics_daily WHERE day>=?').bind(monday).first(),
      db.prepare('SELECT COALESCE(visits,0) visits,COALESCE(editor_seconds,0) seconds FROM analytics_daily WHERE day=?').bind(today).first(),
      db.prepare("SELECT day,visits,editor_seconds seconds FROM analytics_daily WHERE day BETWEEN date(?,?) AND ? ORDER BY day").bind(today,range,today).all(),
      db.prepare("SELECT feature,SUM(count) count FROM analytics_errors WHERE day BETWEEN date(?,?) AND ? GROUP BY feature ORDER BY count DESC LIMIT 10").bind(today,range,today).all(),
      db.prepare("SELECT status,COUNT(*) count FROM inquiries GROUP BY status").all(),
      db.prepare("SELECT COALESCE(SUM(visits),0) visits,COALESCE(SUM(editor_seconds),0) seconds FROM analytics_daily WHERE day BETWEEN date(?,'start of month') AND ?").bind(today,today).first(),
      db.prepare("SELECT COALESCE(SUM(visits),0) visits,COALESCE(SUM(editor_seconds),0) seconds FROM analytics_daily WHERE day BETWEEN date(?,?) AND date(?,?)").bind(today,'-'+(days*2-1)+' days',today,'-'+days+' days').first()
    ]);
    return response({since:today,days,visits:{today:tod?.visits||0,week:week?.visits||0,month:month?.visits||0,total:all?.visits||0},usage:{today:tod?.seconds||0,month:month?.seconds||0,total:all?.seconds||0},previous:{visits:previous?.visits||0,seconds:previous?.seconds||0},trend:series.results||[],errors:errors.results||[],inquiries:inq.results||[],definitions:'방문=브라우저 탭 세션 기준, 사용시간=화면이 활성화된 편집기 시간; 수집 시작 이후 합계'});
  }
  if(path==='/api/admin/inquiries'&&request.method==='GET'){
    const statuses=['all','new','read','in_progress','answered'];
    const status=url.searchParams.get('status')||'all';
    if(!statuses.includes(status))return response({error:'Invalid status'},400);
    const q=(url.searchParams.get('q')||'').trim().slice(0,60);
    const before=url.searchParams.get('before'),beforeId=url.searchParams.get('before_id');
    if((before===null)!==(beforeId===null))return response({error:'Invalid cursor'},400);
    const cursorId=beforeId===null?null:Number(beforeId);
    if(before!==null&&(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(before)||!Number.isFinite(Date.parse(before))||!/^\d+$/.test(beforeId)||!Number.isSafeInteger(cursorId)||cursorId<1))return response({error:'Invalid cursor'},400);
    const where=(status==='all'?'':'status=? AND ')+(q?'(category LIKE ? ESCAPE char(92) OR message LIKE ? ESCAPE char(92) OR email LIKE ? ESCAPE char(92))':'1=1')+(before!==null?' AND (created_at<? OR (created_at=? AND id<?))':'');
    const escaped=q.replaceAll('\\','\\\\').replaceAll('%','\\%').replaceAll('_','\\_');
    const args=[...(status==='all'?[]:[status]),...(q?[...Array(3).fill('%'+escaped+'%')]:[]),...(before!==null?[before,before,cursorId]:[])];
    const r=await db.prepare('SELECT id,created_at,category,email,message,status,admin_note,updated_at,revision FROM inquiries WHERE '+where+' ORDER BY created_at DESC,id DESC LIMIT 51').bind(...args).all();
    const rows=r.results||[],items=rows.slice(0,50),last=items.at(-1);
    return response({items,next:rows.length>50&&last?{before:last.created_at,before_id:last.id}:null,checkedAt:new Date().toISOString()});
  }
  const historyMatch=path.match(/^\/api\/admin\/inquiries\/(\d+)\/history$/);
  if(historyMatch&&request.method==='GET'){
    const id=Number(historyMatch[1]);
    if(!Number.isSafeInteger(id)||id<1)return response({error:'Invalid id'},400);
    const inquiry=await db.prepare('SELECT id FROM inquiries WHERE id=?').bind(id).first();
    if(!inquiry)return response({error:'Not found'},404);
    const history=await db.prepare('SELECT changed_at,old_status,new_status FROM inquiry_audit WHERE inquiry_id=? ORDER BY id DESC LIMIT 50').bind(id).all();
    return response({items:history.results||[]});
  }
  const match=path.match(/^\/api\/admin\/inquiries\/(\d+)$/);
  if(match&&request.method==='PATCH'){
    if(!sameOrigin(request,url))return response({error:'Invalid origin'},403);
    const data=await readJsonObject(request,8192),status=data?.status,note=data?.note;
    if(!['new','read','in_progress','answered'].includes(status)||typeof note!=='string'||note.length>1000||!Number.isSafeInteger(data.revision)||data.revision<0)return response({error:'Invalid update'},400);
    const id=Number(match[1]);if(!Number.isSafeInteger(id)||id<1)return response({error:'Invalid id'},400);
    // Both statements run in one D1 transaction. Read the prior status inside
    // that transaction so concurrent updates cannot create a false history.
    const results=await db.batch([
      db.prepare('INSERT INTO inquiry_audit(inquiry_id,actor,old_status,new_status) SELECT id,?,status,? FROM inquiries WHERE id=? AND status<>? AND revision=?').bind(identity,status,id,status,data.revision),
      db.prepare("UPDATE inquiries SET status=?,admin_note=?,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'),revision=revision+1 WHERE id=? AND revision=?").bind(status,note.trim(),id,data.revision)
    ]);
    if(results[1]?.meta?.changes!==1){
      const exists=await db.prepare('SELECT id FROM inquiries WHERE id=?').bind(id).first();
      return exists?response({error:'다른 창에서 변경된 문의입니다. 최신 내용을 조회한 뒤 메모를 비교해 저장해 주세요.'},409):response({error:'Not found'},404);
    }
    return response({ok:true});
  }
  return response({error:'Not found'},404);
}
