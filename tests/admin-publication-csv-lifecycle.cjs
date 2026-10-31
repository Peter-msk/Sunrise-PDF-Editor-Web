'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs');
const {DatabaseSync}=require('node:sqlite');
(async()=>{
 const sqlite=new DatabaseSync(':memory:');
 sqlite.exec(fs.readFileSync('migrations/0001_inquiries_and_site_updates.sql','utf8'));
 // Backfill legacy publications with historical dates before lifetime triggers.
 sqlite.exec("UPDATE site_announcements SET published_at=date('now','+9 hours','-8 days') WHERE id=1");
 sqlite.exec("UPDATE site_announcements SET published_at=date('now','+9 hours','-6 days') WHERE id=2");
 sqlite.exec("UPDATE site_releases SET released_at=date('now','+9 hours','-8 days') WHERE id=1");
 sqlite.exec("UPDATE site_releases SET released_at=date('now','+9 hours','-6 days') WHERE id=2");
 sqlite.exec(fs.readFileSync('migrations/0002_admin_analytics.sql','utf8'));
 sqlite.exec(fs.readFileSync('migrations/0004_publication_lifetime.sql','utf8'));
 const db={prepare(sql){
  const stmt=sqlite.prepare(sql);return {args:[],bind(...v){this.args=v;return this},
   async first(){return stmt.get(...this.args)},
   async all(){return {results:stmt.all(...this.args)}},
   async run(){const r=stmt.run(...this.args);return {meta:{changes:r.changes}}}};
 }};
 const origin='https://unit.test';
 const {adminApi}=await import('../src/admin-api.mjs');
 const {default:worker}=await import('../src/worker.mjs');
 const getPublic=async()=>{const res=await worker.fetch(new Request(origin+'/api/site-updates'),{DB:db,ASSETS:{fetch:async()=>new Response('')}});assert.equal(res.status,200);return res.json()};
 const admin=(pathname,method='GET',data)=>{
  const url=new URL(origin+pathname);
  return adminApi(new Request(url,{method,headers:{origin,'content-type':'application/json'},
   ...(data?{body:JSON.stringify(data)}:{})}),{DB:db},url,'administrator');
 };
 let publicFeed=await getPublic();
 assert(publicFeed.announcements.some(x=>x.id===2),'six-day notice should be public');
 assert(!publicFeed.announcements.some(x=>x.id===1),'eight-day notice must be absent');
 assert(publicFeed.releases.some(x=>x.id===2),'six-day release should be public');
 assert(!publicFeed.releases.some(x=>x.id===1),'eight-day release must be absent');

 const initial=sqlite.prepare('SELECT first_published_at FROM site_announcements WHERE id=1').get().first_published_at;
 const updated={title:'수정된 만료 안내',body:'내용 수정 후 재게시',level:'warning',is_active:false};
 assert.equal((await admin('/api/admin/site-updates/announcement/1','PATCH',updated)).status,200);
 assert.equal((await admin('/api/admin/site-updates/announcement/1','PATCH',{...updated,is_active:true})).status,200);
 assert.equal(sqlite.prepare('SELECT first_published_at FROM site_announcements WHERE id=1').get().first_published_at,initial);
 publicFeed=await getPublic();
 assert(!publicFeed.announcements.some(x=>x.id===1),'re-publishing must not extend expired publication');
 const adminFeed=await (await admin('/api/admin/site-updates')).json();
 assert(adminFeed.announcements.some(x=>x.id===1&&x.visibility==='expired'),'expired item must remain visible in admin');

 const firstRelease=sqlite.prepare('SELECT first_published_at FROM site_releases WHERE id=1').get().first_published_at;
 assert.equal((await admin('/api/admin/site-updates/release/1','PATCH',{version:'기존 릴리스 수정',added:'수정',improved:'',removed:'',is_active:false})).status,200);
 assert.equal((await admin('/api/admin/site-updates/release/1','PATCH',{version:'기존 릴리스 수정',added:'수정',improved:'',removed:'',is_active:true})).status,200);
 assert.equal(sqlite.prepare('SELECT first_published_at FROM site_releases WHERE id=1').get().first_published_at,firstRelease);
 publicFeed=await getPublic();assert(!publicFeed.releases.some(x=>x.id===1));

 const today=new Date(Date.now()+9*3600000).toISOString().slice(0,10);
 sqlite.prepare('INSERT INTO analytics_daily(day,visits,editor_seconds) VALUES (?,?,?)').run(today,12,180);
 const old=new Date(Date.parse(today+'T00:00:00Z')-31*86400000).toISOString().slice(0,10);
 sqlite.prepare('INSERT INTO analytics_daily(day,visits,editor_seconds) VALUES (?,?,?)').run(old,999,99999);
 const csv=await admin('/api/admin/statistics.csv');
 assert.equal(csv.status,200);
 assert.match(csv.headers.get('content-disposition'),/sunrise-statistics-/);
 const csvData=await csv.text();
 assert(csvData.startsWith('\ufeff'));
 assert(csvData.includes('"12"')&&csvData.includes('"180"'));
 assert(!csvData.includes('"999"'),'old statistical data must not be included');
 assert(!csvData.includes('@'),'statistical CSV must contain no email addresses');
 const raw=await worker.fetch(new Request(origin+'/api/admin/statistics.csv'),{DB:db});
 assert.equal(raw.status,401,'unauthed CSV must remain private');
 sqlite.close();
 console.log('PASS: real SQLite public 7-day lifetime, immutable first dates after updates/reposting, retained admin entries, private 30-day CSV');
})().catch(error=>{console.error(error);process.exitCode=1});
