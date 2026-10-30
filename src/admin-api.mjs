// Server-side admin authorization + privacy-minimal aggregate telemetry.
// No PDF bytes, names, document text, email, IP or client error message enters analytics.
const FEATURES=['문서 열기','페이지','검색','북마크','압축','저장','주석','기타'];
const response=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'}});
const day=()=>new Date(Date.now()+9*3600000).toISOString().slice(0,10);
const sameOrigin=(req,url)=>req.headers.get('origin')===url.origin;
const validSid=(id)=>typeof id==='string'&&/^[0-9a-f]{8}-[0-9a-f-]{27,40}$/i.test(id)&&id.length<=48;
async function readPayload(req) {
  if(!req.headers.get('content-type')?.startsWith('application/json'))return null;
  const body=await req.text();
  if(body.length>1024)return null;
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
    const where=(status==='all'?'':'status=? AND ')+(q?'(category LIKE ? OR message LIKE ? OR email LIKE ?)':'1=1');
    const args=[...(status==='all'?[]:[status]),...(q?[...Array(3).fill('%'+q.replaceAll('%','\\%').replaceAll('_','\\_')+'%')]:[])];
    const r=await db.prepare('SELECT id,created_at,category,email,message,status,admin_note,updated_at FROM inquiries WHERE '+where+' ORDER BY created_at DESC LIMIT 100').bind(...args).all();
    return response({items:r.results||[]});
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
