// Private data retention. Keep purge statements in one place so cron and
// offline SQLite rehearsal use the same rules. No production data exports here.
export async function runAdminRetention(db,now=Date.now()){
 if(!db||!Number.isSafeInteger(now)||now<=0)throw Error('Invalid retention configuration');
 const date=new Date(now);
 if(!Number.isFinite(date.getTime())||now<90*86400000)throw Error('Invalid retention configuration');
 const execute=async(sql,...params)=>db.prepare(sql).bind(...params).run();
 const inquiryCutoff=new Date(now-90*86400000).toISOString();
 const rateCutoff=new Date(now-2*86400000).toISOString().slice(0,10);
 const sessionCutoff=new Date(now+9*3600000-14*86400000).toISOString().slice(0,10);
 // Inquiries and their change history must share the 90-day retention boundary.
 // Clean history first so no orphan is left when parent rows are removed.
 await execute('DELETE FROM inquiry_audit WHERE inquiry_id IN (SELECT id FROM inquiries WHERE created_at < ?) OR inquiry_id NOT IN (SELECT id FROM inquiries)',inquiryCutoff);
 await execute('DELETE FROM inquiries WHERE created_at < ?',inquiryCutoff);
 await execute('DELETE FROM inquiry_rate_limits WHERE day < ?',rateCutoff);
 await execute('DELETE FROM analytics_sessions WHERE day < ?',sessionCutoff);
 await execute('DELETE FROM admin_sessions WHERE expires_ms<? OR last_seen_ms<?',now,now-30*60*1000);
 await execute('DELETE FROM admin_login_limits WHERE window_start_ms<?',now-24*60*60*1000);
 return {ok:true,policy:{inquiriesDays:90,sessionDays:14,rateLimitDays:2,idleMinutes:30}};
}
