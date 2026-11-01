'use strict';
// Invoke only after a real deployment command has produced its result.
const {createHmac}=require('node:crypto');
(async()=>{
 const status=process.argv[2],secret=process.env.DEPLOYMENT_EVENT_SECRET;
 if(!['succeeded','failed','rolled_back'].includes(status)||!secret||secret.length<32)throw Error('Valid status and deployment report secret are required');
 const url=new URL(process.env.DEPLOYMENT_REPORT_URL||'https://sunrise-pdf-editor.ko-pg.workers.dev/api/operations/deployments');
 if(url.protocol!=='https:'||url.hostname!=='sunrise-pdf-editor.ko-pg.workers.dev'||url.pathname!=='/api/operations/deployments'||url.username||url.password||url.search||url.hash)throw Error('Invalid report destination');
 const data={runId:process.env.GITHUB_RUN_ID,runAttempt:Number(process.env.GITHUB_RUN_ATTEMPT),commitSha:process.env.GITHUB_SHA,environment:process.env.DEPLOYMENT_ENVIRONMENT,status,workerVersion:process.env.DEPLOYED_WORKER_VERSION||null};
 if(!/^\d{1,20}$/.test(data.runId||'')||!Number.isSafeInteger(data.runAttempt)||data.runAttempt<1||data.runAttempt>1000||!/^[a-f0-9]{40}$/.test(data.commitSha||'')||!['production','staging'].includes(data.environment))throw Error('Missing deployment run metadata');
 const raw=JSON.stringify(data),stamp=String(Date.now()),signature=createHmac('sha256',secret).update(stamp+'.'+raw).digest('hex');
 const response=await fetch(url,{method:'POST',redirect:'error',headers:{'content-type':'application/json','x-event-timestamp':stamp,'x-event-signature':signature},body:raw,signal:AbortSignal.timeout(15000)});
 if(!response.ok)throw Error('Deployment report rejected: HTTP '+response.status);
 console.log('Deployment report recorded');
})().catch(error=>{console.error(error.message);process.exitCode=1});
