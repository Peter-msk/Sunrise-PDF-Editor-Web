'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const {chromium}=require('playwright');
const file=path.resolve(__dirname,'../dist/admin/index.html');
const today=new Date(Date.now()+9*3600000).toISOString().slice(0,10);
const requestedDays=[];
const healthy={status:'ready',services:{worker:'responsive',database:'ready'},checkedAt:new Date().toISOString(),probeMs:2,
 version:{application:'1.0.0',releaseTag:null,deploymentId:null}};
const quality={windowDays:14,since:today,sessions:{total:10,withErrors:3,percent:30},trend:[],
 overdueInquiries:1,alerts:[{code:'old-inquiries',severity:'review',message:'48시간 이상 미확인 문의 1건이 있습니다.'}],
 definition:'익명 탭 세션 중 최소 한 번의 오류가 기록된 세션 비율.'};
function respond(req,res){
 const url=new URL(req.url,'http://localhost');
 const json=(data,status=200)=>{res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store'});res.end(JSON.stringify(data))};
 if(url.pathname==='/admin/'){res.writeHead(200,{'content-type':'text/html; charset=utf-8'});res.end(fs.readFileSync(file));return}
 if(url.pathname==='/__test/health-degraded'){healthy.status='degraded';healthy.services.database='unavailable';json({ok:true});return}
 if(url.pathname==='/__test/health-recovered'){
  healthy.status='ready';healthy.services.database='ready';
  healthy.version={application:'1.0.0',releaseTag:'published-v2',deploymentId:'123e4567-e89b-42d3-a456-426614174000',
   source:'cloudflare',versionCreatedAt:'2026-10-31T15:00:00.000Z'};
  json({ok:true});return;
 }
 if(url.pathname==='/api/admin/health'){json(healthy,healthy.status==='ready'?200:503);return}
 if(url.pathname==='/api/admin/quality'){json(quality);return}
 if(url.pathname==='/api/admin/save-quality'){json({windowDays:Number(url.searchParams.get('days')||14),version:url.searchParams.get('version'),attempts:5,ready:2,failed:1,cancelled:1,pending:1,retries:1,recovered:1});return}
 if(url.pathname==='/api/admin/overview'){
  const days=Number(url.searchParams.get('days')||14);requestedDays.push(days);
  json({since:today,days,visits:{today:2,week:5,total:30},usage:{today:360,total:1200},
   trend:days===7?[]:[{day:today,visits:days===30?6:2,seconds:days===30?120:360}],errors:[{feature:'저장',count:2}],inquiries:[{status:'new',count:2}],
   definitions:'익명 탭 세션 집계'});return;
 }
 if(url.pathname==='/api/admin/inquiries'){json({items:[]});return}
 if(url.pathname==='/api/admin/site-updates'){json({today,announcements:[],releases:[],next:{announcement:null,release:null}});return}
 res.writeHead(404);res.end('Not found');
}
async function main(){
 const server=http.createServer(respond);let browser;
 try{
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve)});
  browser=await require('./helpers/launch-browser.cjs')(chromium);
  const page=await browser.newPage({viewport:{width:1250,height:850}});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('http://127.0.0.1:'+server.address().port+'/admin/',{waitUntil:'load',timeout:30000});
  await page.waitForFunction(()=>document.querySelector('#qualityPercent')?.textContent==='30.0%',null,{timeout:20000});
  await page.waitForFunction(()=>document.querySelector('#saveAttempts')?.textContent==='5',null,{timeout:20000});
  assert.equal(await page.locator('#saveReady').innerText(),'2');
  assert.equal(await page.locator('#saveFailed').innerText(),'1');
  assert.equal(await page.locator('#saveOther').innerText(),'2');
  assert.equal(await page.locator('#saveFailureRate').innerText(),'33.3%');
  assert.equal(await page.locator('#saveRetries').innerText(),'1');
  assert.equal(await page.locator('#saveRecovered').innerText(),'1');
  await page.waitForFunction(()=>document.querySelector('#visitsToday')?.textContent==='2',null,{timeout:20000});
  assert.equal(await page.locator('#periodVisits').innerText(),'2');
  assert.equal(await page.locator('#periodSeconds').innerText(),'6분');
  assert.equal(await page.locator('#periodAverage').innerText(),'180초');
  assert((await page.locator('body').innerText()).includes('선택 기간 기능 오류 기록'));
  assert((await page.locator('#operationAlerts').innerText()).includes('48시간 이상 미확인 문의'));
  assert((await page.locator('#operationAlerts').innerText()).includes('미확인 문의 2건'));
  assert.equal(await page.locator('#qualityOverdue').innerText(),'1');
  assert.equal(await page.locator('#healthRelease').innerText(),'미설정');
  assert.equal(await page.locator('#visitChart .barwrap').count(),14);
  await page.locator('#dashboardDays').selectOption('30');
  await page.waitForFunction(()=>document.querySelectorAll('#visitChart .barwrap').length===30,null,{timeout:15000});
  assert.equal(await page.locator('#periodVisits').innerText(),'6');
  assert.equal(await page.locator('#periodAverage').innerText(),'20초');
  await page.locator('#dashboardDays').selectOption('7');
  await page.waitForFunction(()=>document.querySelectorAll('#visitChart .barwrap').length===7,null,{timeout:15000});
  assert.equal(await page.locator('#periodVisits').innerText(),'0');
  assert.equal(await page.locator('#periodAverage').innerText(),'—');
  assert(requestedDays.includes(14)&&requestedDays.includes(30)&&requestedDays.includes(7));
  assert.equal(await page.locator('#healthVersionCreated').innerText(),'미설정');
  // An HTTP 503 with well-formed health JSON must display a D1-specific
  // warning; the dashboard must not interpret the Worker as unreachable.
  await page.request.get(new URL('/__test/health-degraded',page.url()).toString());
  await page.locator('#operationsReload').click();
  await page.waitForFunction(()=>document.querySelector('#healthDatabase')?.textContent==='연결 오류',null,{timeout:15000});
  assert.equal(await page.locator('#healthWorker').innerText(),'응답 정상');
  assert((await page.locator('#operationAlerts').innerText()).includes('D1 연결'));
  assert(Number(await page.locator('#operationAlertCount').innerText())>=2);
  await page.request.get(new URL('/__test/health-recovered',page.url()).toString());
  await page.locator('#operationsReload').click();
  await page.waitForFunction(()=>document.querySelector('#healthDatabase')?.textContent==='연결 정상',null,{timeout:15000});
  assert.equal(await page.locator('#healthRelease').innerText(),'published-v2');
  assert.equal(await page.locator('#healthDeployment').innerText(),'123e4567-e89b-42d3-a456-426614174000');
  assert((await page.locator('#healthVersionCreated').innerText()).includes('2026.'));
  assert(!(await page.locator('#operationAlerts').innerText()).includes('D1 연결'));
  assert.equal(errors.length,0,'Browser errors: '+errors.join(' | '));
  console.log('PASS: Chromium dashboard periods, D1 degraded/recovered, operation refresh, version metadata and alerts');
 }finally{
  await browser?.close();
  await new Promise(resolve=>server.close(resolve));
 }
}
main().catch(e=>{console.error('Admin browser E2E failure',e);process.exitCode=1});
