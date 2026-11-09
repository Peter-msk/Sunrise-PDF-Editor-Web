'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {DatabaseSync}=require('node:sqlite');
(async()=>{
 const {runAdminRetention}=await import('../src/admin-retention.mjs');
 const sqlite=new DatabaseSync(':memory:');
 for(const name of ['0001_inquiries_and_site_updates.sql','0002_admin_analytics.sql','0003_password_admin.sql'])
  sqlite.exec(fs.readFileSync(path.join('migrations',name),'utf8'));
 sqlite.exec('CREATE TABLE admin_trace_incidents(fingerprint TEXT PRIMARY KEY,updated_ms INTEGER NOT NULL)');
 sqlite.exec("INSERT INTO admin_accounts(id,username,password_salt,password_hash,iterations) VALUES(1,'admin','test','test',600000)");
 const kst=days=>new Date(Date.now()-days*86400000).toISOString().slice(0,10);
 const stamp=days=>new Date(Date.now()-days*86400000).toISOString().replace('Z','Z');
 const insert=sqlite.prepare('INSERT INTO inquiries(category,email,message,created_at) VALUES (?,?,?,?)');
 const old=insert.run('기타','expired@local.test','old enquiry',stamp(91)).lastInsertRowid;
 const fresh=insert.run('기타','fresh@local.test','keep enquiry',stamp(89)).lastInsertRowid;
 const audit=sqlite.prepare('INSERT INTO inquiry_audit(inquiry_id,actor,old_status,new_status) VALUES (?,?,?,?)');
 audit.run(old,'admin','new','read');audit.run(fresh,'admin','new','read');
 audit.run(99999,'admin','new','read'); // orphan left by a prior failed cleanup
 sqlite.prepare('INSERT INTO inquiry_rate_limits(key,last_sent_ms,daily_count,day) VALUES (?,?,1,?)').run('old',1,kst(4));
 sqlite.prepare('INSERT INTO inquiry_rate_limits(key,last_sent_ms,daily_count,day) VALUES (?,?,1,?)').run('new',Date.now(),kst(0));
 sqlite.prepare('INSERT INTO analytics_sessions(day,session_id,last_pulse_ms) VALUES (?,?,0)').run(kst(16),'old-session');
 sqlite.prepare('INSERT INTO analytics_sessions(day,session_id,last_pulse_ms) VALUES (?,?,0)').run(kst(3),'new-session');
 const now=Date.now();
 sqlite.prepare('INSERT INTO admin_sessions(token_hash,admin_id,created_ms,last_seen_ms,expires_ms) VALUES (?,?,?,?,?)')
  .run('expired',1,now-12000000,now-12000000,now-1);
 sqlite.prepare('INSERT INTO admin_sessions(token_hash,admin_id,created_ms,last_seen_ms,expires_ms) VALUES (?,?,?,?,?)')
  .run('active',1,now-1000,now-1000,now+3600000);
 sqlite.prepare('INSERT INTO admin_login_limits(key,window_start_ms,attempts,blocked_until_ms) VALUES(?,?,1,0)').run('old',now-26*3600000);
 sqlite.prepare('INSERT INTO admin_login_limits(key,window_start_ms,attempts,blocked_until_ms) VALUES(?,?,1,0)').run('new',now);
 const db={prepare(sql){const stmt=sqlite.prepare(sql);return {bind(...a){return {run:async()=>{const result=stmt.run(...a);return {meta:{changes:result.changes}}}}}}}};
 const result=await runAdminRetention(db,now);
 assert.equal(result.policy.inquiriesDays,90);
 assert.equal(sqlite.prepare('SELECT count(*) n FROM inquiries').get().n,1);
 assert.equal(sqlite.prepare('SELECT email FROM inquiries').get().email,'fresh@local.test');
 assert.equal(sqlite.prepare('SELECT count(*) n FROM inquiry_audit').get().n,1,'no expired or orphan history');
 assert.equal(sqlite.prepare('SELECT inquiry_id FROM inquiry_audit').get().inquiry_id,fresh);
 assert.equal(sqlite.prepare('SELECT count(*) n FROM inquiry_rate_limits').get().n,1);
 assert.equal(sqlite.prepare('SELECT session_id FROM analytics_sessions').get().session_id,'new-session');
 assert.equal(sqlite.prepare('SELECT token_hash FROM admin_sessions').get().token_hash,'active');
 assert.equal(sqlite.prepare('SELECT key FROM admin_login_limits').get().key,'new');
 await runAdminRetention(db,now);
 assert.equal(sqlite.prepare('SELECT count(*) n FROM inquiry_audit').get().n,1,'cleanup must be idempotent');
 // Local restoration rehearsal: create a consistent SQLite snapshot of the
 // surviving records, re-open it, and verify core private/admin tables.
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'sunrise-admin-backup-'));
 try{
  const file=path.join(temp,'rehearsal.sqlite');
  sqlite.exec("VACUUM INTO '"+file.replaceAll("'","''")+"'");
  assert(fs.statSync(file).size>0);
  const reopened=new DatabaseSync(file);
  for(const name of ['inquiries','inquiry_audit','analytics_daily','analytics_sessions','admin_accounts','admin_sessions','site_announcements','site_releases']){
   const before=sqlite.prepare('SELECT COUNT(*) count FROM '+name).get().count;
   const after=reopened.prepare('SELECT COUNT(*) count FROM '+name).get().count;
   assert.equal(after,before,'restore mismatch: '+name);
  }
  assert.equal(reopened.prepare('PRAGMA integrity_check').get().integrity_check,'ok');
  reopened.close();
 }finally{sqlite.close();fs.rmSync(temp,{recursive:true,force:true})}
 console.log('PASS: scheduled 90-day inquiry/audit co-retention, 14-day sessions, limits cleanup, idempotence and consistent offline SQLite restore');
})().catch(error=>{console.error(error);process.exitCode=1});
