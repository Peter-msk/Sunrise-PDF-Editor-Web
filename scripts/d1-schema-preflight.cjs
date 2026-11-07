'use strict';
// Read-only production D1 preflight. Never exports rows, secrets or source PDFs.
const {spawnSync}=require('node:child_process');

const DATABASE='sunrise-pdf-editor-web-contact';
const REQUIRED={
  analytics_diagnostics:['code','phase','worker_version','received_ms'],
  admin_accounts:[],admin_sessions:[],admin_security_events:[],
  admin_maintenance_status:[],inquiry_audit:[],
  analytics_operations:[],analytics_save_operations:[],
  operation_deployments:[],
  analytics_daily:['day','returning_visits'],
  analytics_sessions:['day','session_id','active_seconds'],
  inquiries:['id','revision'],
  site_announcements:['id','first_published_at','revision'],
  site_releases:['id','first_published_at','revision']
};
function parseQueryResult(raw){
  let value;
  try{value=JSON.parse(raw)}catch{throw Error('D1 query result is not valid JSON');}
  const items=Array.isArray(value)?value:[value];
  if(items.length!==1||items[0]?.success!==true||!Array.isArray(items[0].results))
    throw Error('D1 query did not return a confirmed read-only result');
  return items[0].results;
}
function verifySchema(tables,columns){
  if(!Array.isArray(tables)||!tables.every(x=>typeof x==='string'))
    throw Error('D1 table metadata is incomplete');
  const names=new Set(tables),missing=[];
  for(const [table,required] of Object.entries(REQUIRED)){
    if(!names.has(table)){missing.push(table);continue;}
    const actual=columns[table];
    if(!Array.isArray(actual)||!actual.every(x=>typeof x==='string')){
      missing.push(table+' metadata');continue;
    }
    for(const field of required)if(!actual.includes(field))missing.push(table+'.'+field);
  }
  if(missing.length)throw Error('Production D1 schema is missing required structure: '+missing.join(', '));
  return {ready:true,checkedTables:Object.keys(REQUIRED).length,checkedFields:Object.values(REQUIRED).reduce((n,x)=>n+x.length,0)};
}
function readOnlyQuery(sql){
  const r=spawnSync(process.env.WRANGLER_BIN||'wrangler',
    ['d1','execute',DATABASE,'--remote','--command',sql,'--json'],
    {shell:false,encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:60000,maxBuffer:4*1024*1024});
  if(r.error||r.status!==0)throw Error('Could not inspect remote D1 metadata (no changes made)');
  return parseQueryResult(r.stdout);
}
function main(){
  const tableRows=readOnlyQuery("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name");
  const tables=tableRows.map(x=>x?.name);
  const columns={};
  for(const table of Object.keys(REQUIRED)){
    if(!tables.includes(table))continue;
    const rows=readOnlyQuery('PRAGMA table_info('+table+')');
    columns[table]=rows.map(x=>x?.name);
  }
  const result=verifySchema(tables,columns);
  process.stdout.write(JSON.stringify({operation:'read-only-production-schema-preflight',database:DATABASE,...result,modified:false})+'\n');
}
if(require.main===module){
  try{main()}catch(error){console.error('RELEASE BLOCKED: '+(error?.message||'D1 schema inspection failed'));process.exitCode=1;}
}
module.exports={REQUIRED,DATABASE,parseQueryResult,verifySchema};
