'use strict';
// Read-only remote recovery gate. The file SHA-256 is checked against the
// operator's private rehearsal receipt; the dedicated D1 must contain the
// same row counts. Neither this script nor the workflow can see private SQL.
const assert=require('node:assert/strict');
const {spawnSync}=require('node:child_process');
const TABLES=Object.freeze(['inquiries','inquiry_audit','analytics_daily','analytics_sessions','admin_accounts','admin_sessions']);
const {TEST_DATABASE,isolatedConfig}=require('./rehearsal-d1-config.cjs');

function parseEvidence(hash,receipt){
 assert.match(hash||'',/^[0-9a-f]{64}$/i,'Valid protected backup SHA-256 required');
 if((receipt||'').length>256)throw Error('Restore receipt is too long');
 const m=/^r12:([0-9a-f]{64}):([0-9a-z]+(?:,[0-9a-z]+){5})$/i.exec(receipt||'');
 if(!m || m[1].toLowerCase()!==hash.toLowerCase())throw Error('Backup and rehearsal receipt do not match');
 const values=m[2].split(',').map(v=>parseInt(v,36));
 if(values.length!==TABLES.length || values.some(v=>!Number.isSafeInteger(v)||v<0))throw Error('Invalid restored record counts');
 return values;
}
function validateCounts(expected,rows){
 if(!Array.isArray(rows)||rows.length!==TABLES.length)throw Error('Incomplete remote test D1 schema');
 const byTable=new Map(rows.map(row=>[row.table_name,row.row_count]));
 if(byTable.size!==TABLES.length)throw Error('Duplicate isolated D1 table counts');
 for(let i=0;i<TABLES.length;i++){
  if(!Number.isSafeInteger(byTable.get(TABLES[i])) || byTable.get(TABLES[i])!==expected[i])
   throw Error('Isolated D1 counts disagree with the private restore receipt');
 }
 return true;
}
function verifyRemote(expected){
 const config=isolatedConfig();
 const sql=TABLES.map(t=>`SELECT '${t}' AS table_name, COUNT(*) AS row_count FROM ${t}`).join(' UNION ALL ');
 const bin=process.env.WRANGLER_BIN||'wrangler';
 const p=spawnSync(bin,['d1','execute',TEST_DATABASE,'--remote','--config',config,'--command',sql,'--json'],{
  shell:false,encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:120000,maxBuffer:1024*1024
 });
 if(p.error||p.status!==0)throw Error('Read-only isolated D1 verification failed');
 let result;try{result=JSON.parse(p.stdout)}catch{throw Error('Malformed isolated D1 response')}
 if(!Array.isArray(result)||result.length!==1||result[0]?.success!==true)throw Error('Remote D1 response was not successful');
 validateCounts(expected,result[0].results);
 return true;
}
if(require.main===module){
 try{
  const expected=parseEvidence(process.env.BACKUP_HASH,process.env.RESTORE_RECEIPT);
  verifyRemote(expected);
  console.log('PASS: private backup hash tied to rehearsal receipt; live isolated D1 table counts match');
 }catch(e){console.error('RECOVERY GATE BLOCKED: '+e.message);process.exitCode=1}
}
module.exports={TABLES,TEST_DATABASE,parseEvidence,validateCounts};
