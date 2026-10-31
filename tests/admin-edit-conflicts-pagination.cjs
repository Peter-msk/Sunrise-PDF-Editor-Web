'use strict';
// Source-complete candidate: execute in the administrator functional phase.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {DatabaseSync}=require('node:sqlite');
(async()=>{
 const {adminApi}=await import('../src/admin-api.mjs');
 const {readJsonObject}=await import('../src/bounded-json.mjs');
 const sqlite=new DatabaseSync(':memory:');
 try{
  for(const file of fs.readdirSync('migrations').sort())if(file.endsWith('.sql'))sqlite.exec(fs.readFileSync(path.join('migrations',file),'utf8'));
  sqlite.exec("DELETE FROM site_announcements;DELETE FROM site_releases;DELETE FROM sqlite_sequence WHERE name IN ('site_announcements','site_releases')");
  const db={prepare(sql){const stmt=sqlite.prepare(sql);const bind=args=>({
   async run(){return {meta:{changes:Number(stmt.run(...args).changes)}}},
   async all(){return {results:stmt.all(...args)}},async first(){return stmt.get(...args)||null}
  });return {...bind([]),bind(...args){return bind(args)}}},async batch(statements){
   sqlite.exec('BEGIN');try{const results=[];for(const statement of statements)results.push(await statement.run());sqlite.exec('COMMIT');return results}catch(error){sqlite.exec('ROLLBACK');throw error}
  }};
  const origin='https://admin.example.test';
  const call=async(route,method='GET',body)=>{const url=new URL(origin+route);return adminApi(new Request(url,{method,headers:{origin,'content-type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})}),{DB:db},url,'admin')};
  const announcement=sqlite.prepare('INSERT INTO site_announcements(title,body,is_active) VALUES(?,?,0)');
  for(let i=1;i<=125;i++)announcement.run(i===1?'오래된 대상 공지':'공지 '+i,'본문 '+i);
  const release=sqlite.prepare("INSERT INTO site_releases(version,added,released_at,is_active) VALUES(?,?,'2026-10-31',0)");
  for(let i=1;i<=73;i++)release.run(i===1?'오래된 대상 업데이트':'업데이트 '+i,'추가 '+i);
  const a=[],r=[];let cursor=null;
  do{
   const query=new URLSearchParams({kind:'all',status:'draft'});
   if(cursor)for(const kind of ['announcement','release'])query.set('before_'+kind,String(cursor[kind]??0));
   const response=await call('/api/admin/site-updates?'+query);assert.equal(response.status,200);
   const data=await response.json();assert(data.announcements.length<=50&&data.releases.length<=50);
   a.push(...data.announcements.map(x=>x.id));r.push(...data.releases.map(x=>x.id));cursor=data.next;
  }while(cursor.announcement||cursor.release);
  assert.equal(a.length,125);assert.equal(new Set(a).size,125);assert.equal(r.length,73);assert.equal(new Set(r).size,73);
  const query=new URLSearchParams({kind:'all',q:'오래된 대상'});
  const old=await (await call('/api/admin/site-updates?'+query)).json();
  assert.deepEqual(old.announcements.map(x=>x.id),[1]);assert.deepEqual(old.releases.map(x=>x.id),[1]);
  announcement.run('100% 정확한 공지','특수문자');
  const literal=await (await call('/api/admin/site-updates?kind=announcement&q=%25')).json();
  assert.equal(literal.announcements.length,1,'LIKE wildcard must be treated literally');
  assert.equal((await call('/api/admin/site-updates?before_announcement=-1')).status,400);
  assert.equal((await call('/api/admin/site-updates?status=invalid')).status,400);
  const editA={title:'수정된 공지',body:'보존할 내용',level:'info',is_active:true,revision:0};
  assert.equal((await call('/api/admin/site-updates/announcement/1','PATCH',editA)).status,200);
  const first=sqlite.prepare('SELECT first_published_at FROM site_announcements WHERE id=1').get().first_published_at;
  assert(first);
  assert.equal((await call('/api/admin/site-updates/announcement/1','PATCH',{...editA,body:'덮어쓰기'})).status,409);
  assert.equal(sqlite.prepare('SELECT body FROM site_announcements WHERE id=1').get().body,'보존할 내용');
  assert.equal((await call('/api/admin/site-updates/announcement/1','PATCH',{...editA,revision:1,is_active:false})).status,200);
  assert.equal(sqlite.prepare('SELECT first_published_at FROM site_announcements WHERE id=1').get().first_published_at,first);
  const editR={version:'수정된 업데이트',added:'신규 내용',improved:'보완',removed:'',is_active:false,revision:0};
  assert.equal((await call('/api/admin/site-updates/release/1','PATCH',editR)).status,200);
  assert.equal((await call('/api/admin/site-updates/release/1','PATCH',{...editR,added:'덮어쓰기'})).status,409);
  sqlite.exec("INSERT INTO inquiries(category,email,message) VALUES('기타','admin@example.test','충분히 긴 문의 내용입니다.')");
  const note={status:'read',note:'첫 번째 창 메모',revision:0};
  assert.equal((await call('/api/admin/inquiries/1','PATCH',note)).status,200);
  assert.equal((await call('/api/admin/inquiries/1','PATCH',{...note,status:'answered',note:'두 번째 창 메모'})).status,409);
  assert.equal(sqlite.prepare('SELECT admin_note FROM inquiries WHERE id=1').get().admin_note,note.note);
  assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM inquiry_audit').get().n,1,'rejected edit must not leave history');
  assert.equal((await call('/api/admin/inquiries/1','PATCH',{status:'read',note:'버전 누락'})).status,400);
  const row=(await (await call('/api/admin/inquiries')).json()).items[0];assert.equal(row.revision,1);
  assert.equal((await call('/api/admin/inquiries/1','PATCH',{status:'answered',note:'최신 창 저장',revision:1})).status,200);
  assert.equal((await call('/api/admin/inquiries/999','PATCH',note)).status,404);
  const longNote='한'.repeat(1000);
  assert.equal((await call('/api/admin/inquiries/1','PATCH',{status:'answered',note:longNote,revision:2})).status,200);
  assert.equal(sqlite.prepare('SELECT admin_note FROM inquiries WHERE id=1').get().admin_note,longNote);
  assert.equal((await call('/api/admin/site-updates/announcement/1','PATCH',{...editA,body:'한'.repeat(3000),revision:2,is_active:false})).status,200);
  let cancelled=false;
  const huge=new ReadableStream({start(controller){controller.enqueue(new Uint8Array(1025))},cancel(){cancelled=true}});
  const request=new Request(origin,{method:'POST',headers:{'content-type':'application/json'},body:huge,duplex:'half'});
  assert.equal(await readJsonObject(request,1024),null);assert(cancelled,'oversized body without Content-Length must be cancelled');
  assert.equal(await readJsonObject(new Request(origin,{method:'POST',headers:{'content-type':'application/json'},body:'[]'}),1024),null);
  assert.equal(await readJsonObject(new Request(origin,{method:'POST',headers:{'content-type':'application/json'},body:new Uint8Array([0xc3,0x28])}),1024),null);
  console.log('PASS: historical publication search, pagination, literal filters, stale edit rejection, inquiry/audit consistency and publication lifetime');
 }finally{sqlite.close()}
})().catch(error=>{console.error(error);process.exitCode=1});
