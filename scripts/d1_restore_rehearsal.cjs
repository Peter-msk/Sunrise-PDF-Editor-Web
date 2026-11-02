'use strict';
// Explicit operator rehearsal against one dedicated, empty test database only.
const fs=require('node:fs'),crypto=require('node:crypto'),{spawnSync}=require('node:child_process');
const {TEST_DATABASE,isolatedConfig}=require('./rehearsal-d1-config.cjs');
const [input,target]=process.argv.slice(2),allowedTarget=TEST_DATABASE;
let privateConfig;
function execute(args){
 const r=spawnSync(process.env.WRANGLER_BIN||'wrangler',[...args,'--config',privateConfig],{shell:false,encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:120000,maxBuffer:8*1024*1024});
 if(r.error||r.status!==0)throw Error('Test database command failed; inspect the isolated database privately');
 return r.stdout;
}
function query(sql){
 const raw=execute(['d1','execute',target,'--remote','--command',sql,'--json']);
 let parsed;try{parsed=JSON.parse(raw)}catch{throw Error('Could not read the test database query result')}
 const entries=Array.isArray(parsed)?parsed:[parsed];
 if(entries.length!==1||!entries[0]||typeof entries[0]!=='object'||entries[0].success!==true||!Array.isArray(entries[0].results)||entries[0].results.length!==1)throw Error('Could not read the test database query result');
 return entries[0].results;
}
try{
 if(!input||target!==allowedTarget||!fs.statSync(input).isFile())throw Error('Usage: node scripts/d1_restore_rehearsal.cjs PRIVATE_EXPORT.sql sunrise-pdf-restore-test');
 privateConfig=isolatedConfig();
 const before=query("SELECT COUNT(*) AS tables_count FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' AND name<>'d1_migrations'");
 if(!Number.isSafeInteger(before[0].tables_count)||before[0].tables_count!==0)throw Error('The dedicated test database must be empty; existing data will not be overwritten');
 execute(['d1','execute',target,'--remote','--file',fs.realpathSync(input),'--yes']);
 const tables=['inquiries','inquiry_audit','analytics_daily','analytics_sessions','admin_accounts','admin_sessions'];
 const counts={};for(const name of tables){const rows=query('SELECT COUNT(*) AS row_count FROM '+name);const count=rows[0].row_count;if(!Number.isSafeInteger(count)||count<0)throw Error('Invalid restored count');counts[name]=count}
 const hash=crypto.createHash('sha256'),fd=fs.openSync(input,'r'),chunk=Buffer.alloc(1024*1024);
 try{let n;while((n=fs.readSync(fd,chunk,0,chunk.length,null))>0)hash.update(chunk.subarray(0,n))}finally{fs.closeSync(fd)}
 const backupSha256=hash.digest('hex');
 const receipt='r12:'+backupSha256+':'+tables.map(t=>counts[t].toString(36)).join(',');
 console.log(JSON.stringify({operation:'isolated-d1-import-rehearsal',target,queryChecks:'passed',counts,backupSha256,receipt,productionModified:false,fullAcceptanceVerified:false}));
}catch(error){console.error(error.message);process.exitCode=1}
