'use strict';
/**
 * Dry-run only: synthetic migration rehearsal and offline backup/restore.
 * Never opens production D1, never copies private customer/admin data, never
 * invokes remote Wrangler or writes outside a temporary OS directory.
 */
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const crypto=require('node:crypto');
const {DatabaseSync}=require('node:sqlite');
const {REQUIRED,verifySchema}=require('./d1-schema-preflight.cjs');
const root=path.resolve(__dirname,'..'),migrations=path.join(root,'migrations');
const files=fs.readdirSync(migrations).filter(x=>/^\d{4}_.+\.sql$/.test(x)).sort();
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'sunrise-trace2-drill-'));
const dbPath=path.join(tmp,'synthetic-before.sqlite');
const backupPath=path.join(tmp,'synthetic-backup.sqlite');
const upgradedPath=path.join(tmp,'synthetic-upgraded.sqlite');
const rollbackPath=path.join(tmp,'synthetic-rollback.sqlite');
const sha=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const rows=db=>db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' AND name<>'d1_migrations'").all().map(x=>x.name);
const columns=(db,tables)=>Object.fromEntries(tables.map(t=>[t,db.prepare('PRAGMA table_info('+t+')').all().map(x=>x.name)]));
let db=null;
try{
 assert.equal(files.length,19,'expected 19 sequential migrations');
 assert(files.map((f,i)=>Number(f.slice(0,4))===i+1).every(Boolean),'migration sequence 0001..0019 must have no gaps');
 db=new DatabaseSync(dbPath);db.exec('PRAGMA foreign_keys=ON');
 for(const file of files.slice(0,17))db.exec(fs.readFileSync(path.join(migrations,file),'utf8'));
 const baseline=rows(db),baseCount=baseline.length;
 assert.equal(baseCount,19,'expected 19 existing application tables');
 assert(!columns(db,['analytics_diagnostics']).analytics_diagnostics.includes('trace_id'));
 assert(!baseline.includes('admin_trace_incidents'));
 // Dummy data only; no real account verifier or production backup export.
 db.prepare('INSERT INTO admin_accounts(id,username,password_salt,password_hash,iterations) VALUES(1,?,?,?,600000)')
  .run('synthetic-admin','synthetic-salt','synthetic-hash');
 db.prepare('INSERT INTO analytics_errors(day,feature,count) VALUES(?,?,?)').run('2026-11-09','페이지',2);
 db.close();db=null;
 fs.copyFileSync(dbPath,backupPath);
 assert.equal(sha(dbPath),sha(backupPath));
 fs.copyFileSync(backupPath,upgradedPath);
 db=new DatabaseSync(upgradedPath);db.exec('PRAGMA foreign_keys=ON');
 // A release gate must not apply 0019 before 0018 is verified ready.
 assert(!columns(db,['analytics_diagnostics']).analytics_diagnostics.includes('trace_id'));
 db.exec('BEGIN IMMEDIATE');
 try{
  db.exec(fs.readFileSync(path.join(migrations,files[17]),'utf8'));
  assert(columns(db,['analytics_diagnostics']).analytics_diagnostics.includes('trace_json'));
  db.exec(fs.readFileSync(path.join(migrations,files[18]),'utf8'));
  db.exec('COMMIT');
 }catch(error){db.exec('ROLLBACK');throw error}
 const finalTables=rows(db);
 assert.equal(finalTables.length,21,'expected 19 existing + 2 incident tables');
 assert(verifySchema(finalTables,columns(db,finalTables)).ready);
 assert.equal(db.prepare('SELECT username FROM admin_accounts WHERE id=1').get().username,'synthetic-admin');
 assert.equal(db.prepare("SELECT count FROM analytics_errors WHERE day='2026-11-09' AND feature='페이지'").get().count,2);
 assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
 assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check,'ok');
 db.prepare('INSERT INTO admin_trace_incidents(fingerprint,created_ms,updated_ms) VALUES(?,?,?)').run('12345678',Date.now(),Date.now());
 db.prepare('INSERT INTO admin_trace_incident_audit(fingerprint,status,note,happened_ms,revision) VALUES(?,?,?,?,?)').run('12345678','new','',Date.now(),0);
 assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
 db.close();db=null;
 fs.copyFileSync(backupPath,rollbackPath);
 db=new DatabaseSync(rollbackPath);
 assert.equal(rows(db).length,baseCount,'restore must recover exactly the old table set');
 assert.equal(db.prepare('SELECT username FROM admin_accounts WHERE id=1').get().username,'synthetic-admin');
 assert.equal(db.prepare("SELECT count FROM analytics_errors WHERE day='2026-11-09' AND feature='페이지'").get().count,2);
 assert(!rows(db).includes('admin_trace_incidents'));
 assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check,'ok');
 const result={rehearsal:'synthetic-offline-only',status:'pass',migrations:files.slice(17),baseApplicationTables:baseCount,finalApplicationTables:finalTables.length,syntheticAdminRetained:true,syntheticErrorRetained:true,foreignKeysPass:true,sqliteIntegrityPass:true,isolatedRestorePass:true,rollbackToBackupPass:true,productionD1Modified:false,privateProductionBackupVerified:false};
 console.log(JSON.stringify(result));
}finally{try{db?.close()}catch{}fs.rmSync(tmp,{recursive:true,force:true})}
