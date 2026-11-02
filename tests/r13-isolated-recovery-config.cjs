'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),{spawnSync}=require('node:child_process');
const repo=path.resolve(__dirname,'..'),temp=fs.mkdtempSync(path.join(os.tmpdir(),'sunrise-r13-isolated-'));
const hash='a'.repeat(64),counts=[2,0,10,5,1,3],receipt='r12:'+hash+':'+counts.map(x=>x.toString(36)).join(',');
const id='11111111-2222-4333-8444-555555555555';
const config=path.join(temp,'wrangler.rehearsal.jsonc'),wrangler=path.join(temp,'d1'),log=path.join(temp,'call.txt');
const names=['inquiries','inquiry_audit','analytics_daily','analytics_sessions','admin_accounts','admin_sessions'];
try{
 fs.writeFileSync(config,JSON.stringify({d1_databases:[{binding:'REHEARSAL_DB',database_name:'sunrise-pdf-restore-test',database_id:id}]}));
 fs.writeFileSync(wrangler,`const fs=require('fs');const a=process.argv.slice(2);fs.appendFileSync(process.env.FIXTURE_CALL,a.join(' ')+'\\n');if(process.env.FIXTURE_BAD==='yes')process.exit(12);console.log(JSON.stringify([{success:true,results:${JSON.stringify(names.map((table_name,i)=>({table_name,row_count:counts[i]})))} }]));`);
 function invoke(overrides={}){
  return spawnSync(process.execPath,[path.join(repo,'scripts/check-release-recovery-evidence.cjs')],{cwd:temp,encoding:'utf8',shell:false,timeout:10000,env:{...process.env,WRANGLER_BIN:process.execPath,WRANGLER_REHEARSAL_CONFIG:config,REHEARSAL_D1_ID:id,BACKUP_HASH:hash,RESTORE_RECEIPT:receipt,FIXTURE_CALL:log,...overrides}});
 }
 let x=invoke();assert.equal(x.status,0,x.stderr);assert.match(x.stdout,/PASS:/);
 const calls=fs.readFileSync(log,'utf8').trim().split('\n');assert.equal(calls.length,1);assert(calls[0].includes('--config '+config));assert(calls[0].includes('sunrise-pdf-restore-test'));
 for(const changes of [{WRANGLER_REHEARSAL_CONFIG:''},{REHEARSAL_D1_ID:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'},{BACKUP_HASH:'b'.repeat(64)},{FIXTURE_BAD:'yes'}]){
  const bad=invoke(changes);assert.notEqual(bad.status,0,'Invalid gate input must block deployment');
 }
 assert.equal(fs.readFileSync(log,'utf8').trim().split('\n').length,2,'Invalid D1 configuration/evidence must fail before issuing remote query');
 console.log('PASS: exact isolated D1 config, ID/backup receipt binding, read-only Wrangler invocation and failure gates');
}finally{fs.rmSync(temp,{recursive:true,force:true})}
