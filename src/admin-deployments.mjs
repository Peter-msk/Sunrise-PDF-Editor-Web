// Reports from a trusted deployment pipeline; not Cloudflare verification.
const reply=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'}});
export async function acceptDeploymentReport(request,env){
 if(request.method!=='POST')return reply({error:'Method not allowed'},405);
 const secret=env.DEPLOYMENT_EVENT_SECRET;
 if(typeof secret!=='string'||secret.length<32||!env.DB)return reply({error:'Deployment reporting unavailable'},503);
 const stamp=request.headers.get('x-event-timestamp'),signature=request.headers.get('x-event-signature');
 if(!/^\d{13}$/.test(stamp||'')||Math.abs(Date.now()-Number(stamp))>300000||!/^[a-f0-9]{64}$/.test(signature||''))return reply({error:'Unauthorized'},401);
 if(!request.headers.get('content-type')?.startsWith('application/json'))return reply({error:'Invalid content type'},415);
 // Bound streamed input before parsing or authenticating it.
 const reader=request.body?.getReader();if(!reader)return reply({error:'Missing body'},400);
 const chunks=[];let size=0;
 try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>4096){await reader.cancel();return reply({error:'Payload too large'},413)}chunks.push(value)}}finally{reader.releaseLock()}
 const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length}
 const raw=new TextDecoder().decode(bytes);
 const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['verify']);
 const sig=Uint8Array.from(signature.match(/../g),value=>parseInt(value,16));
 if(!await crypto.subtle.verify('HMAC',key,sig,new TextEncoder().encode(stamp+'.'+raw)))return reply({error:'Unauthorized'},401);
 let data;try{data=JSON.parse(raw)}catch{return reply({error:'Invalid JSON'},400)}
 const uuid=value=>typeof value==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value);
 if(!data||typeof data!=='object'||Array.isArray(data)||typeof data.runId!=='string'||!/^\d{1,20}$/.test(data.runId)||!Number.isSafeInteger(data.runAttempt)||data.runAttempt<1||data.runAttempt>1000||!['production','staging'].includes(data.environment)||!['succeeded','failed','rolled_back'].includes(data.status)||typeof data.commitSha!=='string'||!/^[a-f0-9]{40}$/.test(data.commitSha)||!(data.workerVersion==null||uuid(data.workerVersion)))return reply({error:'Invalid report'},400);
 await env.DB.prepare('INSERT INTO operation_deployments(run_id,run_attempt,environment,status,commit_sha,worker_version,reported_ms) VALUES (?,?,?,?,?,?,?) ON CONFLICT(run_id,run_attempt,environment) DO UPDATE SET status=excluded.status,commit_sha=excluded.commit_sha,worker_version=excluded.worker_version,reported_ms=excluded.reported_ms,received_at=strftime(\'%Y-%m-%dT%H:%M:%fZ\',\'now\') WHERE excluded.reported_ms>operation_deployments.reported_ms')
  .bind(data.runId,data.runAttempt,data.environment,data.status,data.commitSha,data.workerVersion||null,Number(stamp)).run();
 return reply({ok:true});
}
export async function readDeploymentReports(request,env){
 if(request.method!=='GET')return reply({error:'Method not allowed'},405);
 try{
  const result=await env.DB.prepare('SELECT run_id,run_attempt,environment,status,commit_sha,worker_version,reported_ms,received_at FROM operation_deployments ORDER BY reported_ms DESC LIMIT 20').all();
  return reply({items:result.results||[],source:'signed-pipeline-report'});
 }catch{return reply({error:'Deployment history unavailable'},503)}
}
