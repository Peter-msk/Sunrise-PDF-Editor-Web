'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{spawnSync}=require('node:child_process'),{createHash,randomUUID}=require('node:crypto');
const repo=path.resolve(__dirname,'..'),temp=fs.mkdtempSync(path.join(os.tmpdir(),'sunrise-operator-fixtures-'));
const log=path.join(temp,'calls.jsonl'),source=path.join(temp,'fixture.sql'),privateSQL="CREATE TABLE fixture(value TEXT);INSERT INTO fixture VALUES('SYNTHETIC_PRIVATE_VALUE');\n";
const testD1Id='11111111-2222-4333-8444-555555555555';
const rehearsalConfig=path.join(temp,'isolated-wrangler.jsonc');
fs.writeFileSync(rehearsalConfig,JSON.stringify({d1_databases:[{binding:'REHEARSAL_DB',database_name:'sunrise-pdf-restore-test',database_id:testD1Id}]}));
const run=(script,args,mode='valid',overrides={})=>spawnSync(process.execPath,[path.join(repo,'scripts',script),...args],{cwd:temp,encoding:'utf8',shell:false,timeout:15000,env:{...process.env,WRANGLER_BIN:process.execPath,FIXTURE_LOG:log,FIXTURE_MODE:mode,FIXTURE_EXPORT:privateSQL,WRANGLER_REHEARSAL_CONFIG:rehearsalConfig,REHEARSAL_D1_ID:testD1Id,...overrides}});
const calls=()=>fs.existsSync(log)?fs.readFileSync(log,'utf8').trim().split('\n').filter(Boolean).map(x=>JSON.parse(x)):[];
const reset=()=>fs.writeFileSync(log,'');
const noPrivateOutput=result=>assert(!(result.stdout+result.stderr).includes('SYNTHETIC_PRIVATE_VALUE'));
let alias,accidental;
try{
 fs.writeFileSync(source,privateSQL);
 // Node executes the local file "d1" as the synthetic Wrangler binary. This
 // keeps argv and process behavior real on Windows and POSIX, without network.
 fs.writeFileSync(path.join(temp,'d1'),`const fs=require('node:fs');const args=process.argv.slice(2),mode=process.env.FIXTURE_MODE;fs.appendFileSync(process.env.FIXTURE_LOG,JSON.stringify(args)+'\\n');if(mode==='fail'){console.error('SYNTHETIC_PRIVATE_VALUE');process.exit(2)}if(mode==='malformed-json'){console.log('SYNTHETIC_PRIVATE_VALUE');process.exit(0)}if(args[0]==='export'){fs.writeFileSync(args[args.indexOf('--output')+1],process.env.FIXTURE_EXPORT);console.log('SYNTHETIC_PRIVATE_VALUE');process.exit(0)}if(args.includes('--file')){console.log('SYNTHETIC_PRIVATE_VALUE');process.exit(0)}const q=args[args.indexOf('--command')+1],empty=q.includes('sqlite_master');let value=empty?0:3;if(empty&&mode==='nonempty')value=1;if(empty&&mode==='null-count')value=null;if(empty&&mode==='string-count')value='';console.log(JSON.stringify([{success:mode==='missing-success'?undefined:mode!=='failed-result',results:[empty?{tables_count:value}:{row_count:value}]}]));`);
 const output=path.join(temp,'private export.sql');
 let result=run('d1_backup.cjs',['fixture_database',output]);assert.equal(result.status,0,result.stderr);noPrivateOutput(result);
 assert.equal(fs.readFileSync(output,'utf8'),privateSQL);
 const report=JSON.parse(result.stdout);assert.equal(report.sha256,createHash('sha256').update(privateSQL).digest('hex'));assert.equal(report.restorationVerified,false);
 if(process.platform!=='win32')assert.equal(fs.statSync(output).mode&0o777,0o600);
 reset();result=run('d1_backup.cjs',['fixture_database',output]);assert.notEqual(result.status,0);assert.equal(calls().length,0);assert.equal(fs.readFileSync(output,'utf8'),privateSQL);
 reset();const failed=path.join(temp,'failed.sql');result=run('d1_backup.cjs',['fixture_database',failed],'fail');assert.notEqual(result.status,0);noPrivateOutput(result);assert(!fs.existsSync(failed));assert(!fs.readdirSync(temp).some(x=>x.startsWith('.sunrise-d1-export-')));
 alias=path.join(temp,'repo-alias');fs.symlinkSync(repo,alias,process.platform==='win32'?'junction':'dir');
 const basename='sunrise-fixture-'+randomUUID()+'.sql';accidental=path.join(repo,basename);
 reset();result=run('d1_backup.cjs',['fixture_database',path.join(alias,basename)]);assert.notEqual(result.status,0);assert.equal(calls().length,0,'canonical repository destination must be rejected before export');assert(!fs.existsSync(accidental));
 for(const mode of ['nonempty','null-count','string-count','failed-result','missing-success','malformed-json']){
  reset();result=run('d1_restore_rehearsal.cjs',[source,'sunrise-pdf-restore-test'],mode);assert.notEqual(result.status,0,mode);noPrivateOutput(result);assert(!calls().some(x=>x.includes('--file')),mode+' must not import');
 }
 reset();result=run('d1_restore_rehearsal.cjs',[source,'production-database']);assert.notEqual(result.status,0);assert.equal(calls().length,0);
 // Bad isolated Wrangler settings must fail before any remote D1 invocation.
 for(const bad of [
  {database_name:'sunrise-pdf-editor-web-contact',binding:'REHEARSAL_DB',database_id:testD1Id},
  {database_name:'sunrise-pdf-restore-test',binding:'DB',database_id:testD1Id},
  {database_name:'sunrise-pdf-restore-test',binding:'REHEARSAL_DB',database_id:'efaab4d4-9d79-46dd-b037-461c4cd4c683'}
 ]){
  const badPath=path.join(temp,'bad-isolated-config.jsonc');
  fs.writeFileSync(badPath,JSON.stringify({d1_databases:[bad]}));
  reset();result=run('d1_restore_rehearsal.cjs',[source,'sunrise-pdf-restore-test'],'valid',{WRANGLER_REHEARSAL_CONFIG:badPath,REHEARSAL_D1_ID:bad.database_id});
  assert.notEqual(result.status,0,'Unsafe isolated D1 config must be rejected');assert.equal(calls().length,0);
 }
 reset();result=run('d1_restore_rehearsal.cjs',[source,'sunrise-pdf-restore-test'],'valid',{WRANGLER_REHEARSAL_CONFIG:''});assert.notEqual(result.status,0);assert.equal(calls().length,0);
 reset();result=run('d1_restore_rehearsal.cjs',[source,'sunrise-pdf-restore-test']);assert.equal(result.status,0,result.stderr);noPrivateOutput(result);
 const restore=JSON.parse(result.stdout);assert.equal(restore.productionModified,false);assert.equal(restore.fullAcceptanceVerified,false);assert.equal(Object.keys(restore.counts).length,6);assert.equal(restore.backupSha256,createHash('sha256').update(privateSQL).digest('hex'));assert.match(restore.receipt,/^r12:[a-f0-9]{64}:[0-9a-z]+(?:,[0-9a-z]+){5}$/);assert.equal(calls().filter(x=>x.includes('--file')).length,1);assert(calls().every(x=>x.includes('--config')&&x.includes(rehearsalConfig)),'All remote D1 calls must use the isolated config');
 const python=process.env.SUNRISE_PYTHON||(process.platform==='win32'?'python':'python3');
 const db=path.join(temp,'private source.sqlite'),backup=path.join(temp,'new backup.sqlite');
 let py=spawnSync(python,['-c',"import sqlite3,sys;c=sqlite3.connect(sys.argv[1]);c.execute('CREATE TABLE inquiries(message TEXT)');c.execute('INSERT INTO inquiries VALUES (?)',('SYNTHETIC_PRIVATE_VALUE',));c.commit();c.close()",db],{encoding:'utf8',shell:false});assert.equal(py.status,0,py.stderr);
 const original=fs.readFileSync(db);
 const invoke=args=>spawnSync(python,[path.join(repo,'scripts/admin_sqlite_backup.py'),...args],{encoding:'utf8',shell:false,timeout:15000});
 py=invoke(['backup',db,backup]);assert.equal(py.status,0,py.stderr);noPrivateOutput(py);assert.equal(JSON.parse(py.stdout).tables.inquiries,1);assert.deepEqual(fs.readFileSync(db),original);
 const preserved=fs.readFileSync(backup);py=invoke(['backup',db,backup]);assert.notEqual(py.status,0);assert.deepEqual(fs.readFileSync(backup),preserved);
 py=invoke(['rehearse',backup]);assert.equal(py.status,0,py.stderr);noPrivateOutput(py);assert.equal(JSON.parse(py.stdout).operation,'isolated-restore-rehearsal');
 const bad=path.join(temp,'bad.sqlite'),incomplete=path.join(temp,'incomplete.sqlite');fs.writeFileSync(bad,'not a sqlite database');py=invoke(['backup',bad,incomplete]);assert.notEqual(py.status,0);assert(!fs.existsSync(incomplete));
 console.log('PASS: real operator processes with synthetic Wrangler, canonical path/overwrite/privacy guards, strict empty-DB import gate and actual SQLite backup/rehearsal');
}finally{if(accidental&&fs.existsSync(accidental))fs.unlinkSync(accidental);fs.rmSync(temp,{recursive:true,force:true})}
