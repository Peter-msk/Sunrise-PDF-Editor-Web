'use strict';
// Read-only gate: never migrate production data or trigger deployment itself.
// Run under GitHub production environment immediately before Wrangler deploy.
const assert=require('node:assert/strict');
const env=process.env,account=env.CLOUDFLARE_ACCOUNT_ID,token=env.CLOUDFLARE_API_TOKEN;
const database=env.SUNRISE_D1_DATABASE_ID||'efaab4d4-9d79-46dd-b037-461c4cd4c683';
if(!account||!token||!env.DEPLOYMENT_EVENT_SECRET||env.DEPLOYMENT_EVENT_SECRET.length<32)
 throw Error('Missing production Cloudflare credentials or deployment HMAC secret');
async function api(path,options={}){
 const resp=await fetch('https://api.cloudflare.com/client/v4'+path,{
  ...options,headers:{Authorization:'Bearer '+token,'Content-Type':'application/json',...(options.headers||{})}
 });
 const body=await resp.json();
 if(!resp.ok||!body.success)throw Error('Cloudflare production readiness API failed ('+resp.status+')');
 return body.result;
}
async function query(sql){
 const response=await api('/accounts/'+account+'/d1/database/'+database+'/query',{
  method:'POST',body:JSON.stringify({sql})
 });
 if(response?.[0]?.meta?.changed_db||Number(response?.[0]?.meta?.rows_written)>0)
  throw Error('Read-only readiness query unexpectedly wrote data');
 return response?.[0]?.results||[];
}
(async()=>{
 const names=new Set((await query("SELECT name FROM sqlite_master WHERE type='table'"))
  .map(row=>row.name));
 const required=['inquiries','inquiry_audit','inquiry_rate_limits','analytics_errors','analytics_daily',
  'analytics_sessions','analytics_save_operations','analytics_operations','admin_accounts','admin_sessions',
  'admin_login_limits','site_announcements','site_releases','operation_deployments',
  'admin_security_events','admin_maintenance_status'];
 const absent=required.filter(name=>!names.has(name));
 const columns={analytics_daily:['returning_visits'],analytics_sessions:['active_seconds'],
  analytics_save_operations:['retry_of','worker_version'],analytics_operations:['worker_version'],
  admin_maintenance_status:['state','started_ms','finished_ms','last_success_ms','failed_step'],
  inquiries:['revision'],site_announcements:['first_published_at','revision'],
  site_releases:['first_published_at','revision']};
 const missing=[];
 for(const [table,keys] of Object.entries(columns)){
  if(!names.has(table))continue;
  const present=new Set((await query('PRAGMA table_info('+table+')')).map(row=>row.name));
  for(const k of keys)if(!present.has(k))missing.push(table+'.'+k);
 }
 const settings=await api('/accounts/'+account+'/workers/scripts/sunrise-pdf-editor/settings');
 const bindings=new Map((settings?.bindings||[]).map(b=>[b.name,b.type]));
 const requiredBindings=[['DB','d1'],['ASSETS','assets'],['INQUIRY_HASH_SALT','secret_text'],['DEPLOYMENT_EVENT_SECRET','secret_text']];
 const missingBindings=requiredBindings.filter(([name,type])=>bindings.get(name)!==type).map(([name])=>name);
 const administrators=(await query('SELECT COUNT(*) AS n FROM admin_accounts'))[0]?.n||0;
 if(!administrators)missing.push('admin_accounts: no registered administrator');
 if(absent.length||missing.length||missingBindings.length){
  console.error('Admin release blocked:',JSON.stringify({missingTables:absent,missingColumns:missing,missingBindings}));
  process.exitCode=1;
  return;
 }
 console.log('PASS: production D1 structure, secrets binding types and admin account; safe to begin reviewed Wrangler release');
})().catch(error=>{console.error('Admin release blocked:',error?.message||error);process.exitCode=1});
