'use strict';
// Explicit operator rehearsal against one dedicated, empty test database only.
const fs=require('node:fs'),{spawnSync}=require('node:child_process');
const [input,target]=process.argv.slice(2),allowedTarget='sunrise-pdf-restore-test';
function execute(args){
 const r=spawnSync(process.env.WRANGLER_BIN||'wrangler',args,{shell:false,encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:120000,maxBuffer:8*1024*1024});
 if(r.error||r.status!==0)throw Error('Test database command failed; inspect the isolated database privately');
 return r.stdout;
}
function query(sql){
 const raw=execute(['d1','execute',target,'--remote','--command',sql,'--json']);
 const parsed=JSON.parse(raw),entries=Array.isArray(parsed)?parsed:[parsed];
 const rows=entries.flatMap(item=>item.results||[]);
 if(!rows.length)throw Error('Could not read the test database query result');return rows;
}
try{
 if(!input||target!==allowedTarget||!fs.statSync(input).isFile())throw Error('Usage: node scripts/d1_restore_rehearsal.cjs PRIVATE_EXPORT.sql sunrise-pdf-restore-test');
 const before=query("SELECT COUNT(*) AS tables_count FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' AND name<>'d1_migrations'");
 if(Number(before[0].tables_count)!==0)throw Error('The dedicated test database must be empty; existing data will not be overwritten');
 execute(['d1','execute',target,'--remote','--file',fs.realpathSync(input),'--yes']);
 const tables=['inquiries','inquiry_audit','analytics_daily','analytics_sessions','admin_accounts','admin_sessions'];
 const counts={};for(const name of tables){const rows=query('SELECT COUNT(*) AS row_count FROM '+name);const count=Number(rows[0].row_count);if(!Number.isSafeInteger(count)||count<0)throw Error('Invalid restored count');counts[name]=count}
 console.log(JSON.stringify({operation:'isolated-d1-import-rehearsal',target,queryChecks:'passed',counts,productionModified:false,fullAcceptanceVerified:false}));
}catch(error){console.error(error.message);process.exitCode=1}
