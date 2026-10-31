const assert=require('node:assert/strict'),fs=require('node:fs');
const {DatabaseSync}=require('node:sqlite');
(async()=>{
 const db=new DatabaseSync(':memory:');
 db.exec(fs.readFileSync('migrations/0001_inquiries_and_site_updates.sql','utf8'));
 db.exec(fs.readFileSync('migrations/0002_admin_analytics.sql','utf8'));
 const adapter={prepare(sql){const s=db.prepare(sql);return {args:[],bind(...a){this.args=a;return this},
  async first(){return s.get(...this.args)},async all(){return {results:s.all(...this.args)}}}}};
 const {adminApi}=await import('../src/admin-api.mjs');
 const today=new Date(Date.now()+9*3600000).toISOString().slice(0,10);
 const dayAgo=n=>new Date(Date.parse(today+'T00:00:00Z')-n*86400000).toISOString().slice(0,10);
 for(const [n,visits] of [[0,10],[6,20],[13,30],[29,40]]){
  db.prepare('INSERT INTO analytics_daily(day,visits,editor_seconds) VALUES (?,?,?)').run(dayAgo(n),visits,visits*60);
  db.prepare('INSERT INTO analytics_errors(day,feature,count) VALUES (?,?,?)').run(dayAgo(n),'저장',visits/10);
 }
 const call=days=>{const url=new URL('https://example.test/api/admin/overview'+(days===undefined?'':'?days='+days));
  return adminApi(new Request(url),{DB:adapter},url,'admin')};
 for(const [period,expected] of [[7,2],[14,3],[30,4]]){
  const response=await call(period),data=await response.json();
  assert.equal(response.status,200);assert.equal(data.days,period);assert.equal(data.trend.length,expected);
  assert.equal(data.errors[0].count,expected*(expected+1)/2);
 }
 assert.equal((await call()).status,200);
 assert.equal((await call('999')).status,400);
 assert.equal((await call('7;DROP TABLE')).status,400);
 const html=fs.readFileSync('dist/admin/index.html','utf8');
 assert(html.includes('id="dashboardDays"'));assert(html.includes("read('/api/admin/overview?days='+days)"));
 console.log('PASS: admin 7/14/30-day visit and error trends, strict whitelist');
 db.close();
})().catch(e=>{console.error(e);process.exitCode=1});
