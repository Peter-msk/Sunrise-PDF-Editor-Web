const assert=require('node:assert/strict');
const fs=require('node:fs');
const {DatabaseSync}=require('node:sqlite');

(async()=>{
  const sqlite=new DatabaseSync(':memory:');
  sqlite.exec(fs.readFileSync('migrations/0001_inquiries_and_site_updates.sql','utf8'));
  sqlite.exec(fs.readFileSync('migrations/0004_publication_lifetime.sql','utf8'));
  const db={prepare(sql){const statement=sqlite.prepare(sql);return {
    args:[],bind(...args){this.args=args;return this},
    async all(){return {results:statement.all(...this.args)}},
    async run(){const out=statement.run(...this.args);return {meta:{changes:out.changes}}}
  }}};
  const {adminApi}=await import('../src/admin-api.mjs');
  const origin='https://example.test';
  const call=(path,method='GET',body,requestOrigin=origin)=>{
    const url=new URL(origin+path);
    return adminApi(new Request(url,{method,headers:{origin:requestOrigin,'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{})}),{DB:db},url,'admin');
  };
  const notice={title:'안내 <img src=x>',body:'새로운 공지 내용',level:'info',is_active:false};
  let res=await call('/api/admin/site-updates/announcement','POST',notice);
  assert.equal(res.status,201);
  const row=sqlite.prepare('SELECT * FROM site_announcements WHERE title=?').get(notice.title);
  assert.equal(row.first_published_at,null);
  res=await call('/api/admin/site-updates/announcement/'+row.id,'PATCH',{...notice,is_active:true});assert.equal(res.status,200);
  const first=sqlite.prepare('SELECT first_published_at FROM site_announcements WHERE id=?').get(row.id).first_published_at;
  assert.equal(first,sqlite.prepare("SELECT date('now','+9 hours') d").get().d);
  await call('/api/admin/site-updates/announcement/'+row.id,'PATCH',{...notice,title:'수정됨',is_active:false});
  await call('/api/admin/site-updates/announcement/'+row.id,'PATCH',{...notice,title:'수정됨',is_active:true});
  assert.equal(sqlite.prepare('SELECT first_published_at FROM site_announcements WHERE id=?').get(row.id).first_published_at,first);
  res=await call('/api/admin/site-updates/announcement/'+row.id,'PATCH',{...notice,is_active:true},'https://attacker.test');assert.equal(res.status,403);
  res=await call('/api/admin/site-updates/announcement','POST',{...notice,body:''});assert.equal(res.status,400);
  res=await call('/api/admin/site-updates/announcement/999999','PATCH',{...notice,is_active:true});assert.equal(res.status,404);
  const release={version:'웹 업데이트 테스트',added:'신규',improved:'보완',removed:'없음',is_active:true};
  res=await call('/api/admin/site-updates/release','POST',release);assert.equal(res.status,201);
  res=await call('/api/admin/site-updates/release','POST',release);assert.equal(res.status,409);
  res=await call('/api/admin/site-updates');const data=await res.json();
  assert(data.announcements.some(x=>x.id===row.id&&x.title==='수정됨'));
  assert(data.releases.some(x=>x.version===release.version));
  const worker=(await import('../src/worker.mjs')).default;
  res=await worker.fetch(new Request(origin+'/api/admin/site-updates'),{DB:db});assert.equal(res.status,401);
  console.log('PASS: authenticated publication management, draft activation, immutable first date, validation, CSRF and duplicate protection');
})().catch(e=>{console.error(e);process.exitCode=1});
