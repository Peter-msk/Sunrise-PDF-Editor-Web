export async function securityEvent(db,kind){
 // Never retain usernames, IP addresses, password proofs, or error payloads.
 if(!['login_failed','login_succeeded','password_changed','sessions_revoked'].includes(kind))return;
 try{await db.prepare('INSERT INTO admin_security_events(kind,happened_ms) VALUES (?,?)').bind(kind,Date.now()).run()}
 catch{console.error('Admin security event could not be recorded')}
}
