// Sunrise R05 — authenticated two-phase, conflict-blocked publication restore.
// Standalone integration module: MUST be mounted only under protected /api/admin/ routes.
// No deletion, no overwrite of first publication date, no inquiry/user/analytics writes.
import {getAdminSession} from './admin-password-auth.mjs';
import {readPublicationTablesV2,inspectPublicationBackupV2,createPublicationBackupV2,
 planPublicationRestoreV2,sha256Hex} from './admin-publication-backup-v2.mjs';
const MAX_POST=6*1024*1024+8192, MAX_WRITES=40, APPROVAL_MS=5*60*1000;
const text=new TextEncoder();
const json=(obj,status=200)=>new Response(JSON.stringify(obj),{status,headers:{
 'content-type':'application/json; charset=utf-8','cache-control':'no-store',
 'x-content-type-options':'nosniff','referrer-policy':'no-referrer'}});
const fail=(status,error)=>json({error},status);
async function receive(request){
 if(!request.headers.get('content-type')?.toLowerCase().startsWith('application/json'))return null;
 const len=Number(request.headers.get('content-length')||0);
 if(!Number.isFinite(len)||len>MAX_POST)return null;
 const reader=request.body?.getReader();if(!reader)return null;
 let size=0;const chunks=[];
 try{
  while(true){const {value,done}=await reader.read();if(done)break;
   size+=value.byteLength;if(size>MAX_POST){await reader.cancel();return null}chunks.push(value)
  }
  const bytes=new Uint8Array(size);let pos=0;for(const chunk of chunks){bytes.set(chunk,pos);pos+=chunk.length}
  const result=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
  return result&&typeof result==='object'&&!Array.isArray(result)?result:null;
 }catch{return null}finally{reader.releaseLock()}
}
function b64(bytes){let s='';for(const v of bytes)s+=String.fromCharCode(v);
 return btoa(s).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'')}
function unb64(s){if(typeof s!=='string'||s.length>4096||!/^[A-Za-z0-9_-]+$/.test(s))throw Error('invalid token');
 const raw=atob(s.replace(/-/g,'+').replace(/_/g,'/').padEnd(Math.ceil(s.length/4)*4,'='));
 return Uint8Array.from(raw,ch=>ch.charCodeAt(0));
}
async function signingKey(env){const raw=env.PUBLICATION_RESTORE_SIGNING_KEY;
 if(typeof raw!=='string'||raw.length<32)throw Error('Restore signing key missing');
 return crypto.subtle.importKey('raw',text.encode(raw),{name:'HMAC',hash:'SHA-256'},false,['sign','verify']);
}
async function sign(payload,key){const raw=text.encode(JSON.stringify(payload));
 const mac=new Uint8Array(await crypto.subtle.sign('HMAC',key,raw));return b64(raw)+'.'+b64(mac);
}
async function verify(token,key){if(typeof token!=='string'||token.length>6000)throw Error('invalid token');
 const parts=token.split('.');if(parts.length!==2)throw Error('invalid token');
 const bytes=unb64(parts[0]),mac=unb64(parts[1]);
 if(mac.length!==32||!await crypto.subtle.verify('HMAC',key,mac,bytes))throw Error('invalid signature');
 const payload=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
 if(!payload||typeof payload!=='object'||Array.isArray(payload)||
  !Number.isSafeInteger(payload.expiresAt)||Date.now()>payload.expiresAt||
  !/^[0-9a-f-]{36}$/.test(payload.operationId))throw Error('invalid approval');
 return payload;
}
function safeVersion(value){return typeof value==='string'&&/^[a-f0-9]{64}$/.test(value)}
async function sessionBinding(request){const cookie=request.headers.get('cookie')||'';
 const match=cookie.match(/(?:^|;\s*)__Host-sunrise_pdf_admin=([^;]+)/);
 if(!match||match[1].length>200)throw Error('admin cookie missing');
 return sha256Hex(text.encode(match[1]));
}
function prepareWrites(db,operationId,identity,checksum,steps){
 if(!steps.length||steps.length>MAX_WRITES)throw Error('Invalid change count');
 // One D1 db.batch = one SQLite transaction. Every attempted write must affect
 // exactly one row; an audit CHECK(changed=1) deliberately aborts the batch on
 // stale revision or lost INSERT. A duplicate operationId aborts replay.
 const sql=[db.prepare('INSERT INTO admin_publication_restore_runs (operation_id,actor,backup_sha256,started_ms,insert_count,update_count) VALUES (?,?,?,?,?,?)')
   .bind(operationId,identity,checksum,Date.now(),steps.filter(s=>s.kind==='insert').length,steps.filter(s=>s.kind==='update').length)];
 for(const step of steps){const {table,kind,next,prior}=step;
  const isA=table==='announcements';const name=isA?'site_announcements':'site_releases';
  if(kind==='insert'){
   if(isA)sql.push(db.prepare('INSERT INTO site_announcements (id,title,body,level,published_at,first_published_at,is_active,revision,sort_order) SELECT ?,?,?,?,?,?,?,?,? WHERE NOT EXISTS (SELECT 1 FROM site_announcements WHERE id=?)')
    .bind(next.id,next.title,next.body,next.level,next.published_at,next.first_published_at,next.is_active,next.revision,next.sort_order,next.id));
   else sql.push(db.prepare('INSERT INTO site_releases (id,version,released_at,first_published_at,added,improved,removed,is_active,revision,sort_order) SELECT ?,?,?,?,?,?,?,?,?,? WHERE NOT EXISTS (SELECT 1 FROM site_releases WHERE id=?)')
    .bind(next.id,next.version,next.released_at,next.first_published_at,next.added,next.improved,next.removed,next.is_active,next.revision,next.sort_order,next.id));
  }else{
   if(isA)sql.push(db.prepare('UPDATE site_announcements SET title=?,body=?,level=?,is_active=?,sort_order=?,revision=revision+1 WHERE id=? AND revision=? AND published_at=? AND first_published_at IS ?')
    .bind(next.title,next.body,next.level,next.is_active,next.sort_order,next.id,prior.revision,prior.published_at,prior.first_published_at));
   else sql.push(db.prepare('UPDATE site_releases SET added=?,improved=?,removed=?,is_active=?,sort_order=?,revision=revision+1 WHERE id=? AND revision=? AND version=? AND released_at=? AND first_published_at IS ?')
    .bind(next.added,next.improved,next.removed,next.is_active,next.sort_order,next.id,prior.revision,prior.version,prior.released_at,prior.first_published_at));
  }
  // SQLite changes() on the immediately preceding statement; CHECK fails and
  // rolls back ALL writes if it is not exactly 1. No source content in audit.
  sql.push(db.prepare('INSERT INTO admin_publication_restore_steps (operation_id,table_name,row_id,action,changed) VALUES (?,?,?,?,changes())')
   .bind(operationId,table,next.id,kind));
 }
 return sql;
}
export async function handlePublicationRestore(request,env,url){
 const path=url.pathname,method=request.method;
 const routes={'/api/admin/publication-restore/export':'GET',
 '/api/admin/publication-restore/preview':'POST','/api/admin/publication-restore/apply':'POST'};
 if(!(path in routes))return fail(404,'알 수 없는 복원 경로입니다.');
 if(method!==routes[path])return fail(405,'지원하지 않는 요청 방식입니다.');
 // Double-check authorization, even when the Worker already guarded /api/admin.
 let actor;try{actor=await getAdminSession(request,env)}catch{return fail(503,'관리자 인증을 확인하지 못했습니다.')}
 if(!actor||typeof actor!=='string'||actor.length>100)return fail(401,'관리자 인증이 필요합니다.');
 if(!env.DB?.batch||!env.DB?.prepare)return fail(503,'관리자 데이터베이스를 사용할 수 없습니다.');
 if(method==='POST'&&(request.headers.get('origin')!==url.origin))return fail(403,'같은 사이트 요청만 허용합니다.');
 try{
  if(method==='GET'){
   const tables=await readPublicationTablesV2(env.DB);
   const {envelope}=await createPublicationBackupV2(tables);
   return new Response(JSON.stringify(envelope,null,2),{headers:{'content-type':'application/json; charset=utf-8',
    'content-disposition':'attachment; filename="sunrise-publications-v2.json"','cache-control':'no-store',
    'x-content-type-options':'nosniff'}});
  }
  const data=await receive(request);if(!data||!data.backup)return fail(400,'백업 파일을 확인해 주세요.');
  const source=await inspectPublicationBackupV2(data.backup);
  const current=await readPublicationTablesV2(env.DB);
  const plan=planPublicationRestoreV2(source.payload.tables,current);
  const fingerprint=await sha256Hex(current);
  const summary={...plan.counts,conflicts:plan.conflicts.slice(0,20),totalConflicts:plan.conflicts.length,
   changeCount:plan.steps.length,isRestoreExecuted:false};
  if(path.endsWith('/preview')){
   if(plan.conflicts.length||!plan.steps.length)return json({approved:false,...summary,
    reason:plan.conflicts.length?'conflict':'no-changes'});
   const key=await signingKey(env),binding=await sessionBinding(request);
   const token=await sign({v:1,operationId:crypto.randomUUID(),backup:source.checksum,
    snapshot:fingerprint,actor,binding,expiresAt:Date.now()+APPROVAL_MS},key);
   return json({approved:false,requiresConfirmation:true,approvalExpiresSeconds:APPROVAL_MS/1000,
    token,...summary});
  }
  if(data.confirm!=='공지·업데이트 복원 실행')return fail(400,'명시적 복원 확인 문구가 필요합니다.');
  const key=await signingKey(env),approval=await verify(data.token,key);
  if(approval.v!==1||approval.actor!==actor||approval.binding!==await sessionBinding(request)||
     !safeVersion(approval.backup)||approval.backup!==source.checksum||
     approval.snapshot!==fingerprint||plan.conflicts.length||!plan.steps.length)
   return fail(409,'복원 승인 또는 현재 데이터가 변경되었습니다. 새로 미리보기 해 주세요.');
  const entries=prepareWrites(env.DB,approval.operationId,actor,source.checksum,plan.steps);
  await env.DB.batch(entries); // Must be an all-or-nothing D1 transaction.
  return json({ok:true,isRestoreExecuted:true,operationId:approval.operationId,
    inserted:plan.counts.insert,updated:plan.counts.update});
 }catch(err){
  // Never expose DB errors, backup values, bearer tokens, email, or sensitive content.
  console.error('publication restore unavailable',err?.name||'unknown');
  return fail(409,'요청을 완료하지 못했습니다. 자료·스키마·충돌 상태를 확인하고 다시 미리보기 해 주세요.');
 }
}
