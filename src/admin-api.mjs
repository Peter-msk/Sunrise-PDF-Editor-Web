// Server-side admin authorization + privacy-minimal aggregate telemetry.
// No PDF bytes, names, document text, email, IP or client error message enters analytics.
const APP_VERSION='1.0.0';
const FEATURES=['문서 열기','페이지','검색','북마크','압축','저장','주석','기타'];
export const PUBLICATION_WINDOW_SQL="date(first_published_at)>date('now','+9 hours','-7 days') AND date(first_published_at)<=date('now','+9 hours')";
const PUBLICATION_STATUS_SQL=`CASE WHEN is_active=0 AND first_published_at IS NULL THEN 'draft' WHEN is_active=0 THEN 'hidden' WHEN date(first_published_at) IS NULL THEN 'unknown' WHEN date(first_published_at)>date('now','+9 hours') THEN 'scheduled' WHEN ${PUBLICATION_WINDOW_SQL} THEN 'published' ELSE 'expired' END AS visibility`;
const response=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'}});
const day=()=>new Date(Date.now()+9*3600000).toISOString().slice(0,10);
const sameOrigin=(req,url)=>req.headers.get('origin')===url.origin;
const validSid=(id)=>typeof id==='string'&&/^[0-9a-f]{8}-[0-9a-f-]{27,40}$/i.test(id)&&id.length<=48;
async function readPayload(req,maxBytes=1024) {
  if(!req.headers.get('content-type')?.startsWith('application/json'))return null;
  const body=await req.text();
  if(body.length>maxBytes)return null;
  try{return JSON.parse(body)}catch{return null}
}
export async function telemetry(request,env,url){
  if(request.method!=='POST')return response({error:'Method not allowed'},405);
  if(!sameOrigin(request,url))return response({error:'Invalid origin'},403);
  const data=await readPayload(request);
  if(!data||!validSid(data.session)||!['visit','pulse','failure'].includes(data.type))return response({error:'Invalid event'},400);
  const now=Date.now(),today=day(),db=env.DB;
  try{
    if(data.type==='visit'){
      const result=await db.prepare('INSERT OR IGNORE INTO analytics_sessions(day,session_id,last_pulse_ms) VALUES (?,?,?)').bind(today,data.session,now).run();
      if(result.meta?.changes){
        await db.prepare('INSERT INTO analytics_daily(day,visits) VALUES (?,1) ON CONFLICT(day) DO UPDATE SET visits=visits+1').bind(today).run();
      }
    } else if(data.type==='pulse'){
      if(data.area!=='editor'||!Number.isInteger(data.seconds)||data.seconds<1||data.seconds>15)return response({error:'Invalid duration'},400);
      const accepted=await db.prepare('UPDATE analytics_sessions SET last_pulse_ms=? WHERE day=? AND session_id=? AND last_pulse_ms<=? RETURNING session_id').bind(now,today,data.session,now-8000).first();
      if(accepted)await db.prepare('INSERT INTO analytics_daily(day,editor_seconds) VALUES (?,?) ON CONFLICT(day) DO UPDATE SET editor_seconds=editor_seconds+excluded.editor_seconds').bind(today,data.seconds).run();
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
    const rawTag=env.RELEASE_VERSION;
    const releaseTag=typeof rawTag==='string'&&/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(rawTag)?rawTag:null;
    const healthy=database==='ready';
    return response({
      status:healthy?'ready':'degraded',
      services:{worker:'responsive',database},
      checkedAt:new Date().toISOString(),probeMs:Math.max(0,Date.now()-started),
      version:{application:APP_VERSION,releaseTag,deploymentId}
    },healthy?200:503);
  }
  if(path==='/api/admin/statistics.csv'&&request.method==='GET'){
    const result=await db.prepare("SELECT day,visits,editor_seconds FROM analytics_daily WHERE day BETWEEN date(?,'-29 days') AND ? ORDER BY day").bind(today,today).all();
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
    const [announcements,releases]=await Promise.all([
      db.prepare(`SELECT id,title,body,level,published_at,first_published_at,is_active,${PUBLICATION_STATUS_SQL} FROM site_announcements ORDER BY id DESC LIMIT 100`).all(),
      db.prepare(`SELECT id,version,released_at,first_published_at,added,improved,removed,is_active,${PUBLICATION_STATUS_SQL} FROM site_releases ORDER BY id DESC LIMIT 100`).all()
    ]);
    return response({today,announcements:announcements.results||[],releases:releases.results||[]});
  }
  const publicationMatch=path.match(/^\/api\/admin\/site-updates\/(announcement|release)(?:\/(\d+))?$/);
  if(publicationMatch&&['POST','PATCH'].includes(request.method)){
    if(!sameOrigin(request,url))return response({error:'Invalid origin'},403);
    const [,kind,idText]=publicationMatch;
    if((request.method==='POST'&&idText)||(request.method==='PATCH'&&!idText))return response({error:'Invalid request'},400);
    const id=idText?Number(idText):null;
    if(idText&&(!Number.isSafeInteger(id)||id<1))return response({error:'Invalid id'},400);
    const data=await readPayload(request,8192);
    if(!data||typeof data!=='object'||Array.isArray(data))return response({error:'입력 내용을 확인해 주세요.'},400);
    const text=(value,max,required=false)=>typeof value==='string'&&value.length<=max&&(!required||value.trim().length>0)&&!/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value);
    const active=data.is_active;
    if(typeof active!=='boolean')return response({error:'게시 상태를 확인해 주세요.'},400);
    if(kind==='announcement'){
      if(!text(data.title,160,true)||!text(data.body,3000,true)||!['info','warning'].includes(data.level))return response({error:'공지 제목과 내용을 확인해 주세요.'},400);
    } else if(!text(data.version,160,true)||!text(data.added,1000)||!text(data.improved,1000)||!text(data.removed,1000))return response({error:'업데이트 제목과 내용을 확인해 주세요.'},400);
    try{
      let result;
      if(kind==='announcement'&&request.method==='POST')result=await db.prepare('INSERT INTO site_announcements(title,body,level,published_at,is_active) VALUES (?,?,?,?,?)').bind(data.title.trim(),data.body.trim(),data.level,today,Number(active)).run();
      if(kind==='announcement'&&request.method==='PATCH')result=await db.prepare('UPDATE site_announcements SET title=?,body=?,level=?,is_active=? WHERE id=?').bind(data.title.trim(),data.body.trim(),data.level,Number(active),id).run();
      if(kind==='release'&&request.method==='POST')result=await db.prepare('INSERT INTO site_releases(version,released_at,added,improved,removed,is_active) VALUES (?,?,?,?,?,?)').bind(data.version.trim(),today,data.added.trim(),data.improved.trim(),data.removed.trim(),Number(active)).run();
      if(kind==='release'&&request.method==='PATCH')result=await db.prepare('UPDATE site_releases SET version=?,added=?,improved=?,removed=?,is_active=? WHERE id=?').bind(data.version.trim(),data.added.trim(),data.improved.trim(),data.removed.trim(),Number(active),id).run();
      if(request.method==='PATCH'&&result.meta?.changes===0)return response({error:'항목을 찾을 수 없습니다.'},404);
      return response({ok:true},request.method==='POST'?201:200);
    }catch(error){
      if(/unique constraint/i.test(String(error?.message||'')))return response({error:'같은 이름의 업데이트가 이미 있습니다.'},409);
      console.error('publication update failed',error?.name||'unknown');
      return response({error:'저장하지 못했습니다. 다시 시도해 주세요.'},503);
    }
  }
  if(path==='/api/admin/overview'&&request.method==='GET'){
    const monday=earliestWeek(today);
    const [all,week,tod,series,errors,inq]=await Promise.all([
      db.prepare('SELECT COALESCE(SUM(visits),0) visits,COALESCE(SUM(editor_seconds),0) seconds FROM analytics_daily').first(),
      db.prepare('SELECT COALESCE(SUM(visits),0) visits FROM analytics_daily WHERE day>=?').bind(monday).first(),
      db.prepare('SELECT COALESCE(visits,0) visits,COALESCE(editor_seconds,0) seconds FROM analytics_daily WHERE day=?').bind(today).first(),
      db.prepare("SELECT day,visits,editor_seconds seconds FROM analytics_daily WHERE day >= date(?,'-13 days') ORDER BY day").bind(today).all(),
      db.prepare("SELECT feature,SUM(count) count FROM analytics_errors WHERE day >= date(?,'-29 days') GROUP BY feature ORDER BY count DESC LIMIT 10").bind(today).all(),
      db.prepare("SELECT status,COUNT(*) count FROM inquiries GROUP BY status").all()
    ]);
    return response({since:today,visits:{today:tod?.visits||0,week:week?.visits||0,total:all?.visits||0},usage:{today:tod?.seconds||0,total:all?.seconds||0},trend:series.results||[],errors:errors.results||[],inquiries:inq.results||[],definitions:'방문=브라우저 탭 세션 기준, 사용시간=화면이 활성화된 편집기 시간; 수집 시작 이후 합계'});
  }
  if(path==='/api/admin/inquiries'&&request.method==='GET'){
    const statuses=['all','new','read','in_progress','answered'];
    const status=url.searchParams.get('status')||'all';
    if(!statuses.includes(status))return response({error:'Invalid status'},400);
    const q=(url.searchParams.get('q')||'').trim().slice(0,60);
    const where=(status==='all'?'':'status=? AND ')+(q?'(category LIKE ? ESCAPE char(92) OR message LIKE ? ESCAPE char(92) OR email LIKE ? ESCAPE char(92))':'1=1');
    const escaped=q.replaceAll('\\','\\\\').replaceAll('%','\\%').replaceAll('_','\\_');
    const args=[...(status==='all'?[]:[status]),...(q?[...Array(3).fill('%'+escaped+'%')]:[])];
    const r=await db.prepare('SELECT id,created_at,category,email,message,status,admin_note,updated_at FROM inquiries WHERE '+where+' ORDER BY created_at DESC LIMIT 100').bind(...args).all();
    return response({items:r.results||[]});
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
    const data=await readPayload(request),status=data?.status,note=data?.note;
    if(!['new','read','in_progress','answered'].includes(status)||typeof note!=='string'||note.length>1000)return response({error:'Invalid update'},400);
    const id=Number(match[1]);if(!Number.isSafeInteger(id)||id<1)return response({error:'Invalid id'},400);
    const old=await db.prepare('SELECT status FROM inquiries WHERE id=?').bind(id).first();
    if(!old)return response({error:'Not found'},404);
    await db.prepare("UPDATE inquiries SET status=?,admin_note=?,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?").bind(status,note.trim(),id).run();
    if(old.status!==status)await db.prepare('INSERT INTO inquiry_audit(inquiry_id,actor,old_status,new_status) VALUES (?,?,?,?)').bind(id,identity,old.status,status).run();
    return response({ok:true});
  }
  return response({error:'Not found'},404);
}
