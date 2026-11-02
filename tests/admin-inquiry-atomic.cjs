'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {DatabaseSync}=require('node:sqlite');
(async()=>{
 const sqlite=new DatabaseSync(':memory:');
 sqlite.exec(fs.readFileSync('migrations/0001_inquiries_and_site_updates.sql','utf8'));
 sqlite.exec(fs.readFileSync('migrations/0002_admin_analytics.sql','utf8'));
 sqlite.exec(fs.readFileSync('migrations/0015_admin_edit_revisions.sql','utf8'));
 sqlite.exec("INSERT INTO inquiries(id,category,email,message) VALUES(1,'기타','test@local.invalid','test')");
 const db={
  prepare(sql){return {sql,args:[],bind(...args){this.args=args;return this},async first(){return sqlite.prepare(sql).get(...this.args)||null}}},
  async batch(statements){
   sqlite.exec('BEGIN');
   try{const results=statements.map(x=>({meta:{changes:Number(sqlite.prepare(x.sql).run(...x.args).changes)}}));sqlite.exec('COMMIT');return results}
   catch(e){sqlite.exec('ROLLBACK');throw e}
  }
 };
 const {adminApi}=await import('../src/admin-api.mjs');
 const origin='https://example.test';
 const call=(id,status,note='',revision=sqlite.prepare('SELECT revision FROM inquiries WHERE id=?').get(id)?.revision??0)=>{
  const url=new URL(origin+'/api/admin/inquiries/'+id);
  return adminApi(new Request(url,{method:'PATCH',headers:{origin,'content-type':'application/json'},body:JSON.stringify({status,note,revision})}),{DB:db},url,'admin');
 };
 assert.equal((await call(1,'read','first')).status,200);
 assert.equal((await call(1,'read','memo only')).status,200);
 assert.equal((await call(999,'answered')).status,404);
 assert.equal((await call(1,'answered','done')).status,200);
 let history=sqlite.prepare('SELECT old_status,new_status FROM inquiry_audit ORDER BY id').all().map(x=>[x.old_status,x.new_status]);
 assert.deepEqual(history,[['new','read'],['read','answered']]);
 // Force the second statement to fail after the history insert; both roll back.
 sqlite.exec("CREATE TRIGGER fail_update BEFORE UPDATE ON inquiries BEGIN SELECT RAISE(ABORT,'test failure'); END");
 await assert.rejects(call(1,'in_progress'));
 assert.equal(sqlite.prepare('SELECT status FROM inquiries WHERE id=1').get().status,'answered');
 assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM inquiry_audit').get().n,2);
 sqlite.exec('DROP TRIGGER fail_update');
 const responses=await Promise.all([call(1,'read'),call(1,'in_progress')]);
 assert.deepEqual(responses.map(x=>x.status).sort(),[200,409],'one stale snapshot must be rejected');
 const current=sqlite.prepare('SELECT status FROM inquiries WHERE id=1').get().status;
 assert.equal((await call(1,current==='read'?'in_progress':'read')).status,200,'fresh snapshot may save after a conflict');
 history=sqlite.prepare('SELECT old_status,new_status FROM inquiry_audit ORDER BY id').all().map(x=>[x.old_status,x.new_status]);
 assert.deepEqual(history.slice(-2),[['answered',current],[current,current==='read'?'in_progress':'read']]);
 assert.equal(sqlite.prepare('SELECT status FROM inquiries WHERE id=1').get().status,current==='read'?'in_progress':'read');
 sqlite.close();
 console.log('PASS: inquiry status and audit update atomically, including rollback and serialized changes');
})().catch(error=>{console.error(error);process.exitCode=1});
