'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {DatabaseSync}=require('node:sqlite');
(async()=>{
 const sqlite=new DatabaseSync(':memory:');
 sqlite.exec(fs.readFileSync('migrations/0001_inquiries_and_site_updates.sql','utf8'));
 sqlite.exec(fs.readFileSync('migrations/0002_admin_analytics.sql','utf8'));
 sqlite.exec("INSERT INTO inquiries(id,category,email,message) VALUES(1,'기타','test@local.invalid','test')");
 const db={
  prepare(sql){return {sql,args:[],bind(...args){this.args=args;return this}}},
  async batch(statements){
   sqlite.exec('BEGIN');
   try{const results=statements.map(x=>({meta:{changes:Number(sqlite.prepare(x.sql).run(...x.args).changes)}}));sqlite.exec('COMMIT');return results}
   catch(e){sqlite.exec('ROLLBACK');throw e}
  }
 };
 const {adminApi}=await import('../src/admin-api.mjs');
 const origin='https://example.test';
 const call=(id,status,note='')=>{
  const url=new URL(origin+'/api/admin/inquiries/'+id);
  return adminApi(new Request(url,{method:'PATCH',headers:{origin,'content-type':'application/json'},body:JSON.stringify({status,note})}),{DB:db},url,'admin');
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
 assert(responses.every(x=>x.status===200));
 history=sqlite.prepare('SELECT old_status,new_status FROM inquiry_audit ORDER BY id').all().map(x=>[x.old_status,x.new_status]);
 assert.deepEqual(history.slice(-2),[['answered','read'],['read','in_progress']]);
 assert.equal(sqlite.prepare('SELECT status FROM inquiries WHERE id=1').get().status,'in_progress');
 sqlite.close();
 console.log('PASS: inquiry status and audit update atomically, including rollback and serialized changes');
})().catch(error=>{console.error(error);process.exitCode=1});
