const assert=require('node:assert/strict');
const fs=require('node:fs');
const {DatabaseSync}=require('node:sqlite');
(async()=>{
 const sqlite=new DatabaseSync(':memory:');
 sqlite.exec(fs.readFileSync('migrations/0001_inquiries_and_site_updates.sql','utf8'));
 sqlite.exec(fs.readFileSync('migrations/0002_admin_analytics.sql','utf8'));
 const d1={prepare(sql){
  const stmt=sqlite.prepare(sql);return {
   args:[],bind(...values){this.args=values;return this},
   async first(){return stmt.get(...this.args)},async all(){return {results:stmt.all(...this.args)}}
  };
 }};
 const {adminApi}=await import('../src/admin-api.mjs');
 const origin='https://example.test',url=new URL(origin+'/api/admin/quality');
 const read=(method='GET')=>adminApi(new Request(url,{method}),{DB:d1},url,'admin');
 const today=new Date(Date.now()+9*3600000).toISOString().slice(0,10);
 const dateAgo=(n)=>new Date(Date.parse(today+'T00:00:00Z')-n*86400000).toISOString().slice(0,10);
 for(let i=0;i<10;i++){
  sqlite.prepare('INSERT INTO analytics_sessions(day,session_id,last_pulse_ms,error_events) VALUES (?,?,0,?)')
    .run(i===9?dateAgo(13):today,'session-'+i,i<4?1:0);
 }
 // More than 14 days old MUST NOT inflate quality denominator.
 sqlite.prepare('INSERT INTO analytics_sessions(day,session_id,last_pulse_ms,error_events) VALUES (?,?,0,1)').run(dateAgo(14),'historical');
 sqlite.prepare("INSERT INTO inquiries(category,email,message,status,created_at) VALUES ('기능 문의','sample@example.test','Test','new',strftime('%Y-%m-%dT%H:%M:%fZ','now','-50 hours'))").run();
 let res=await read();assert.equal(res.status,200);
 const payload=await res.json();
 assert.equal(payload.windowDays,14);
 assert.equal(payload.sessions.total,10);
 assert.equal(payload.sessions.withErrors,4);
 assert.equal(payload.sessions.percent,40);
 assert.equal(payload.trend.length,2);
 assert.equal(payload.overdueInquiries,1);
 assert.deepEqual(payload.alerts.map(x=>x.code),['error-sessions','old-inquiries']);
 assert(!JSON.stringify(payload).includes('sample@example.test'));
 assert.equal(res.headers.get('cache-control'),'no-store');
 res=await read('POST');assert.equal(res.status,405);
 sqlite.exec('DELETE FROM analytics_sessions;DELETE FROM inquiries;');
 res=await read();const empty=await res.json();
 assert.equal(empty.sessions.total,0);assert.equal(empty.sessions.percent,null);
 assert.equal(empty.alerts.length,0);
 const html=fs.readFileSync('dist/admin/index.html','utf8');
 for(const name of ['qualityReload','qualitySessions','qualityAffected','qualityPercent','qualityOverdue','qualityTrend'])
  assert(html.includes('id="'+name+'"'));
 assert(html.includes("...new Set([...healthAlerts,...qualityAlerts,...operationAlerts])"),'duplicate alerts must be deduplicated');
 assert(html.includes('windowDays!==14'));
 assert(!html.includes('featureFailureRate'),'per-feature error rate without attempt denominator is forbidden');
 console.log('PASS: 14-day retained session quality, error warning, 48h inquiry alert, honest 0-session display and UI');
 sqlite.close();
})().catch(error=>{console.error(error);process.exitCode=1});
