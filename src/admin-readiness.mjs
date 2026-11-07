export async function adminReadiness(env){
 const required=['analytics_diagnostics','inquiries','inquiry_audit','inquiry_rate_limits','analytics_errors','analytics_daily','analytics_sessions','analytics_save_operations','analytics_operations','admin_accounts','admin_sessions','admin_login_limits','site_announcements','site_releases','operation_deployments','admin_security_events','admin_maintenance_status'];
 const schema=await env.DB.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
 const present=new Set((schema.results||[]).map(row=>row.name));
 const missingTables=required.filter(name=>!present.has(name));
 const columns={analytics_diagnostics:['code','phase','worker_version','received_ms'],analytics_daily:['returning_visits'],analytics_sessions:['active_seconds'],analytics_save_operations:['retry_of','worker_version'],analytics_operations:['worker_version'],admin_maintenance_status:['state','started_ms','finished_ms','last_success_ms','failed_step'],inquiries:['revision'],site_announcements:['first_published_at','revision'],site_releases:['first_published_at','revision']};
 const missingColumns=[];
 for(const [name,expected] of Object.entries(columns)){
  if(!present.has(name))continue;
  const info=await env.DB.prepare('PRAGMA table_info('+name+')').all();
  const found=new Set((info.results||[]).map(row=>row.name));
  for(const column of expected)if(!found.has(column))missingColumns.push(name+'.'+column);
 }
 return {checkedAt:new Date().toISOString(),schema:{ready:!missingTables.length&&!missingColumns.length,missingTables,missingColumns},configuration:{adminVerifier:typeof env.INQUIRY_HASH_SALT==='string'&&env.INQUIRY_HASH_SALT.length>0,deploymentReporting:typeof env.DEPLOYMENT_EVENT_SECRET==='string'&&env.DEPLOYMENT_EVENT_SECRET.length>=32,workerVersion:typeof env.CF_VERSION_METADATA?.id==='string'},scope:'basic-structure-and-config-only'};
}
