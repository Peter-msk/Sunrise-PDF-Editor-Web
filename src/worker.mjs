import {telemetry,adminApi} from './admin-api.mjs';
import {authRoutes,getAdminSession} from './admin-password-auth.mjs';
// Sunrise PDF Editor Web: public release feed + private Cloudflare D1 inquiry inbox.
// No PDF data is read, uploaded or retained by this Worker.
const JSON_HEADERS = {'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'};
function respond(data,status=200,extra={}) { return new Response(JSON.stringify(data),{status,headers:{...JSON_HEADERS,...extra}}); }
function tooLong(value,max) { return typeof value!=='string' || value.length>max; }
async function publicUpdates(db) {
  const [a,r]=await Promise.all([
    db.prepare("SELECT id,title,body,level,published_at FROM site_announcements WHERE is_active=1 AND date(first_published_at)>date('now','+9 hours','-7 days') AND date(first_published_at)<=date('now','+9 hours') ORDER BY sort_order DESC,id DESC LIMIT 8").all(),
    db.prepare("SELECT id,version,released_at,added,improved,removed FROM site_releases WHERE is_active=1 AND date(first_published_at)>date('now','+9 hours','-7 days') AND date(first_published_at)<=date('now','+9 hours') ORDER BY sort_order DESC,id DESC LIMIT 8").all()
  ]);
  return respond({announcements:a.results||[],releases:r.results||[]},200,{'cache-control':'public, max-age=60'});
}
async function submitInquiry(request,env,url) {
  const origin=request.headers.get('origin');
  if (origin!==url.origin) return respond({error:'같은 사이트에서만 접수할 수 있습니다.'},403);
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) return respond({error:'요청 형식이 올바르지 않습니다.'},415);
  const size=Number(request.headers.get('content-length')||0);
  if (size>8192) return respond({error:'입력 내용이 너무 깁니다.'},413);
  let raw;
  try { raw=await request.text(); if(raw.length>8192) return respond({error:'입력 내용이 너무 깁니다.'},413); }
  catch {return respond({error:'입력 내용을 읽을 수 없습니다.'},400);}
  let data;
  try { data=JSON.parse(raw); } catch {return respond({error:'입력 형식이 올바르지 않습니다.'},400);}
  if (!data || typeof data!=='object' || Array.isArray(data)) return respond({error:'입력 형식이 올바르지 않습니다.'},400);
  if (data.website) return respond({ok:true},200); // honeypot
  const category=String(data.category||'').trim();
  const email=String(data.email||'').trim().toLowerCase();
  const message=String(data.message||'').trim();
  if(!['기능 문의','오류 신고','개선 제안','기타'].includes(category)) return respond({error:'문의 유형을 선택해 주세요.'},400);
  if (tooLong(email,160) || email.length<5 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return respond({error:'회신받을 이메일을 확인해 주세요.'},400);
  if (tooLong(message,2000) || message.length<15) return respond({error:'문의 내용을 15~2000자로 작성해 주세요.'},400);
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(message)) return respond({error:'사용할 수 없는 제어 문자가 포함되었습니다.'},400);
  if (data.consent!==true) return respond({error:'문의 정보 저장 안내에 동의해 주세요.'},400);
  if (!env.DB || !env.INQUIRY_HASH_SALT) return respond({error:'문의 접수 서비스 설정을 확인 중입니다.'},503);
  const ip=request.headers.get('cf-connecting-ip')||'unknown';
  const now=Date.now(),day=new Date(now).toISOString().slice(0,10);
  const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(env.INQUIRY_HASH_SALT+':'+day+':'+ip));
  const key=Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('');
  try {
    const allowed=await env.DB.prepare("INSERT INTO inquiry_rate_limits (key,last_sent_ms,daily_count,day) VALUES (?, ?, 1, ?) ON CONFLICT(key) DO UPDATE SET last_sent_ms=excluded.last_sent_ms,daily_count=inquiry_rate_limits.daily_count+1 WHERE inquiry_rate_limits.last_sent_ms < ? AND inquiry_rate_limits.daily_count < 8 RETURNING key").bind(key,now,day,now-60000).first();
    if (!allowed) return respond({error:'문의가 너무 자주 접수되었습니다. 1분 후 다시 시도해 주세요.'},429);
    await env.DB.prepare('INSERT INTO inquiries (category,email,message) VALUES (?,?,?)').bind(category,email,message).run();
    return respond({ok:true,message:'문의가 접수되었습니다.'},201);
  } catch(error) {
    console.error('Inquiry D1 write failed',error?.name||'error');
    return respond({error:'접수 중 문제가 발생했습니다. 다시 시도해 주세요.'},503);
  }
}
export default {
  async fetch(request,env,ctx) {
    const url=new URL(request.url);
    if(url.pathname.startsWith('/api/auth/')){
      try{return await authRoutes(request,env,url)}
      catch(error){
        console.error('Authentication endpoint failed',error?.name||'unknown');
        return respond({error:'관리자 인증 서버 처리 중 오류가 발생했습니다. 다시 시도해 주세요.'},503);
      }
    }
    if(url.pathname==='/admin')return Response.redirect(url.origin+'/admin/',302);
    if(url.pathname==='/admin/login/' || url.pathname==='/admin/setup/'){
      if(request.method!=='GET'&&request.method!=='HEAD')return new Response('Method Not Allowed',{status:405});
      return env.ASSETS.fetch(request);
    }
    if(url.pathname.startsWith('/admin/') || url.pathname.startsWith('/api/admin/')){
      let username;
      try{username=await getAdminSession(request,env)}
      catch(error){console.error('Admin session check failed',error?.name||'unknown');return respond({error:'관리자 인증을 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.'},503);}
      if(!username){
        if(url.pathname.startsWith('/api/admin/'))return respond({error:'관리자 로그인이 필요합니다.'},401);
        return Response.redirect(url.origin+'/admin/login/',302);
      }
      if(url.pathname.startsWith('/api/admin/')){
        try{return await adminApi(request,env,url,username)}
        catch(error){console.error('Admin API failed',error?.name||'unknown');return respond({error:'관리자 데이터를 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.'},503);}
      }
      return env.ASSETS.fetch(request);
    }
    if(url.pathname==='/api/telemetry')return telemetry(request,env,url);
    if (url.pathname==='/api/site-updates') {
      if(request.method!=='GET') return respond({error:'허용되지 않은 요청입니다.'},405,{'allow':'GET'});
      try {return await publicUpdates(env.DB);}
      catch {return respond({error:'공지사항을 불러오지 못했습니다.'},503);}
    }
    if(url.pathname==='/api/inquiries') {
      if(request.method!=='POST') return respond({error:'허용되지 않은 요청입니다.'},405,{'allow':'POST'});
      return submitInquiry(request,env,url);
    }
    if(url.pathname.startsWith('/api/')) return respond({error:'해당 API가 없습니다.'},404);
    return env.ASSETS.fetch(request);
  },
  async scheduled(_event,env) {
    if(!env.DB) return;
    await env.DB.prepare("DELETE FROM inquiries WHERE created_at < strftime('%Y-%m-%dT%H:%M:%fZ','now','-90 days')").run();
    await env.DB.prepare("DELETE FROM inquiry_rate_limits WHERE day < strftime('%Y-%m-%d','now','-2 days')").run();
    await env.DB.prepare("DELETE FROM analytics_sessions WHERE day < date('now','+9 hours','-14 days')").run();
    await env.DB.prepare('DELETE FROM admin_sessions WHERE expires_ms<? OR last_seen_ms<?').bind(Date.now(),Date.now()-30*60*1000).run();
    await env.DB.prepare('DELETE FROM admin_login_limits WHERE window_start_ms<?').bind(Date.now()-24*60*60*1000).run();
  }
};
