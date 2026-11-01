'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),http=require('node:http'),path=require('node:path');
const {chromium}=require('playwright');
const html=path.resolve(__dirname,'../dist/admin/index.html');
const today=new Date(Date.now()+9*3600000).toISOString().slice(0,10);
const ago=n=>new Date(Date.parse(today+'T00:00:00Z')-n*86400000).toISOString().slice(0,10);
let nextId=80;
let inquiries=[{id:51,created_at:new Date().toISOString(),category:'오류 신고',email:'tester@example.test',message:'저장할 때 화면이 멈추는 문제를 확인해 주세요.',status:'new',admin_note:''},
 {id:52,created_at:new Date().toISOString(),category:'기타',email:'other@example.test',message:'일반 문의입니다.',status:'answered',admin_note:''}];
for(let i=0;i<60;i++)inquiries.push({id:100+i,created_at:'2026-01-01T00:00:00.000Z',category:'기타',email:'sample@example.test',message:'목록 시험',status:'new',admin_note:''});
const audit=[];
let announcements=[
 {id:1,title:'오래된 안내',body:'만료된 공지',level:'info',is_active:1,first_published_at:ago(8),published_at:ago(8),visibility:'expired'},
 {id:2,title:'최근 안내',body:'보이는 공지',level:'info',is_active:1,first_published_at:ago(2),published_at:ago(2),visibility:'published'}
];
let releases=[
 {id:3,version:'오래된 업데이트',added:'예전 기능',improved:'',removed:'',is_active:1,first_published_at:ago(8),released_at:ago(8),visibility:'expired'}];
for(const row of [...inquiries,...announcements,...releases])row.revision=0;
const send=(res,body,code=200)=>{res.writeHead(code,{'content-type':'application/json;charset=utf-8','cache-control':'no-store'});res.end(JSON.stringify(body))};
async function serve(req,res){
 const url=new URL(req.url,'http://localhost'),pathname=url.pathname;
 let body=null;
 if(req.method==='POST'||req.method==='PATCH'){
  let chunks='';for await(const chunk of req)chunks+=chunk;
  try{body=JSON.parse(chunks)}catch{send(res,{error:'Invalid JSON'},400);return}
 }
 if(pathname==='/admin/'){res.writeHead(200,{'content-type':'text/html;charset=utf-8'});res.end(fs.readFileSync(html));return}
 if(pathname==='/api/admin/health'){send(res,{status:'ready',services:{worker:'responsive',database:'ready'},checkedAt:new Date().toISOString(),probeMs:1,version:{application:'1.0.0'}});return}
 if(pathname==='/api/admin/quality'){send(res,{windowDays:14,since:today,sessions:{total:10,withErrors:1,percent:10},trend:[],alerts:[],overdueInquiries:0,definition:'익명 세션 중 오류가 기록된 비율'});return}
 if(pathname==='/api/admin/overview'){
  const by={};for(const item of inquiries)by[item.status]=(by[item.status]||0)+1;
  send(res,{since:today,days:Number(url.searchParams.get('days')||14),visits:{today:1,week:3,total:10},
   usage:{today:30,total:100},trend:[],errors:[],inquiries:Object.entries(by).map(([status,count])=>({status,count}))});return
 }
 if(pathname==='/api/admin/inquiries'&&req.method==='GET'){
  const status=url.searchParams.get('status')||'all',q=(url.searchParams.get('q')||'').toLowerCase();
  const before=url.searchParams.get('before'),beforeId=Number(url.searchParams.get('before_id'));
  const filtered=inquiries.filter(item=>(status==='all'||item.status===status)&&
   [item.category,item.message,item.email].some(v=>v.toLowerCase().includes(q))&&(!before||item.created_at<before||(item.created_at===before&&item.id<beforeId)))
   .sort((a,b)=>b.created_at.localeCompare(a.created_at)||b.id-a.id);
  const items=filtered.slice(0,50),last=items.at(-1);
  send(res,{items,next:filtered.length>50?{before:last.created_at,before_id:last.id}:null,checkedAt:new Date().toISOString()});return
 }
 const hist=pathname.match(/^\/api\/admin\/inquiries\/(\d+)\/history$/);
 if(hist&&req.method==='GET'){send(res,{items:audit.filter(item=>item.inquiry_id===Number(hist[1]))});return}
 const issue=pathname.match(/^\/api\/admin\/inquiries\/(\d+)$/);
 if(issue&&req.method==='PATCH'){
  const item=inquiries.find(x=>x.id===Number(issue[1]));if(!item){send(res,{error:'Not found'},404);return}
  if(item.revision!==body.revision){send(res,{error:'Stale inquiry'},409);return}
  item.revision++;
  if(item.status!==body.status)audit.push({inquiry_id:item.id,changed_at:new Date().toISOString(),old_status:item.status,new_status:body.status});
  item.status=body.status;item.admin_note=body.note;send(res,{ok:true});return
 }
 if(pathname==='/api/admin/site-updates'&&req.method==='GET'){
  const kind=url.searchParams.get('kind')||'all',status=url.searchParams.get('status')||'all',q=(url.searchParams.get('q')||'').toLowerCase();
  const filter=(name,list)=>kind!=='all'&&kind!==name?[]:list.filter(row=>(status==='all'||row.visibility===status)&&(row.title||row.version).toLowerCase().includes(q));
  send(res,{today,announcements:filter('announcement',announcements),releases:filter('release',releases),next:{announcement:null,release:null}});return
 }
 const pub=pathname.match(/^\/api\/admin\/site-updates\/(announcement|release)(?:\/(\d+))?$/);
 if(pub&&['POST','PATCH'].includes(req.method)){
  const list=pub[1]==='announcement'?announcements:releases;
  const current=pub[2]?list.find(x=>x.id===Number(pub[2])):null;
  if(pub[2]&&!current){send(res,{error:'Not found'},404);return}
  if(current&&current.revision!==body.revision){send(res,{error:'Stale publication'},409);return}
  const oldDate=current?.first_published_at||null;
  const next={...(current||{}),...body};
  next.id=current?.id||nextId++;next.revision=current?current.revision+1:0;
  next.first_published_at=oldDate||(body.is_active?today:null);
  next.visibility=!next.first_published_at?'draft':!body.is_active?'hidden':
   next.first_published_at<ago(6)?'expired':'published';
  if(!current)list.push(next);else Object.assign(current,next);
  send(res,{ok:true},current?200:201);return
 }
 if(pathname==='/api/admin/statistics.csv'){
  res.writeHead(200,{'content-type':'text/csv;charset=utf-8','content-disposition':'attachment; filename="sunrise-statistics.csv"'});
  res.end('\ufeff"날짜(KST)","방문 세션","활성 편집 시간(초)"\r\n"'+today+'","3","90"\r\n');return
 }
 res.writeHead(404);res.end('not found');
}
async function main(){
 const server=http.createServer((req,res)=>serve(req,res).catch(e=>{console.error(e);res.writeHead(500);res.end('error')}));
 let browser;
 try{
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve)});
  browser=await require('./helpers/launch-browser.cjs')(chromium);
  const context=await browser.newContext({acceptDownloads:true,viewport:{width:1360,height:900}});
  const page=await context.newPage(),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.goto('http://127.0.0.1:'+server.address().port+'/admin/',{waitUntil:'load'});
  await page.waitForFunction(()=>document.querySelector('#publicationList')?.textContent.includes('오래된 안내'),null,{timeout:15000});
  // Search and inspect a selected inquiry, then keep detail visible after saving.
  await page.locator('#query').fill('저장할 때');
  await page.locator('#query').press('Enter');
  await page.locator('#inquiryRows tr[data-id="51"]').waitFor();
  assert.equal(await page.locator('#inquiryRows tr[data-id]').count(),1);
  await page.locator('#inquiryRows tr[data-id="51"]').click();
  await page.locator('#editStatus').selectOption('in_progress');
  await page.locator('#adminNote').fill('원인 파악 중');
  await page.locator('#saveStatus').click();
  await page.waitForFunction(()=>document.querySelector('#saveResult')?.textContent.includes('저장 완료'),null,{timeout:15000});
  assert.equal(await page.locator('#detail').isVisible(),true,'saved inquiry must remain visible');
  assert.equal(await page.locator('#editStatus').inputValue(),'in_progress');
  await page.waitForFunction(()=>document.querySelector('#inquiryHistory')?.textContent.includes('처리 중'),null,{timeout:15000});
  assert.equal(inquiries[0].admin_note,'원인 파악 중');
  await page.locator('#query').fill('');await page.locator('#query').press('Enter');
  await page.waitForFunction(()=>!document.querySelector('#inquiryNext')?.disabled,null,{timeout:15000});
  assert((await page.locator('#inquiryRows').innerText()).includes('48시간 이상 미확인'));
  await page.locator('#inquiryNext').click();
  await page.waitForFunction(()=>document.querySelector('#inquiryPage')?.textContent==='2쪽',null,{timeout:15000});
  assert.equal(await page.locator('#inquiryRows tr[data-id]').count(),12);
  await page.locator('#inquiryPrevious').click();
  await page.waitForFunction(()=>document.querySelector('#inquiryPage')?.textContent==='1쪽',null,{timeout:15000});
  assert.equal(await page.locator('#inquiryRows tr[data-id]').count(),50);

  // Old publications remain editable in admin but cannot regain a fresh date.
  const oldFirst=announcements[0].first_published_at;
  await page.locator('#publicationList button').filter({hasText:'오래된 안내'}).click();
  await page.locator('#publicationBody').fill('수정된 오래된 공지');
  await page.locator('#publicationSave').click();
  await page.waitForFunction(()=>document.querySelector('#publicationResult')?.textContent==='저장했습니다.',null,{timeout:15000});
  await page.waitForFunction(()=>document.querySelector('#publicationResult')?.textContent==='저장했습니다.',null,{timeout:15000});
  assert.equal(announcements[0].first_published_at,oldFirst);
  assert.equal(announcements[0].body,'수정된 오래된 공지');
  await page.locator('#publicationList button').filter({hasText:'오래된 안내'}).click();
  await page.locator('#publicationActive').uncheck();
  await page.locator('#publicationSave').click();
  await page.waitForFunction(()=>document.querySelector('#publicationResult')?.textContent==='저장했습니다.',null,{timeout:15000});
  await page.locator('#publicationList button').filter({hasText:'오래된 안내'}).click();
  await page.locator('#publicationActive').check();
  await page.locator('#publicationSave').click();
  await page.waitForFunction(()=>document.querySelector('#publicationResult')?.textContent==='저장했습니다.',null,{timeout:15000});
  assert.equal(announcements[0].first_published_at,oldFirst,'reposting must never reset initial date');

  await page.locator('#newPublication').click();
  await page.locator('#publicationTitle').fill('신규 공지');
  await page.locator('#publicationBody').fill('신규 공지 내용');
  await page.locator('#publicationSave').click();
  await page.waitForFunction(()=>document.querySelector('#publicationResult')?.textContent==='저장했습니다.',null,{timeout:15000});
  await page.waitForFunction(()=>document.querySelector('#publicationList')?.textContent.includes('신규 공지'),null,{timeout:15000});
  assert.equal(announcements.find(x=>x.title==='신규 공지')?.first_published_at,today);

  await page.locator('#newPublication').click();
  await page.locator('#publicationKind').selectOption('release');
  await page.locator('#publicationTitle').fill('신규 업데이트');
  await page.locator('#publicationAdded').fill('새 기능 추가');
  await page.locator('#publicationSave').click();
  await page.waitForFunction(()=>document.querySelector('#publicationResult')?.textContent==='저장했습니다.',null,{timeout:15000});
  await page.waitForFunction(()=>document.querySelector('#publicationList')?.textContent.includes('신규 업데이트'),null,{timeout:15000});
  assert.equal(releases.find(x=>x.version==='신규 업데이트')?.first_published_at,today);
  assert((await page.locator('#publicationList').innerText()).includes('표시기간 만료'));

  const pending=page.waitForEvent('download',{timeout:15000});
  await page.locator('#statisticsDownload').click();
  const download=await pending;
  assert.equal(download.suggestedFilename(),'sunrise-statistics.csv');
  const csv=await download.path();const bytes=fs.readFileSync(csv,'utf8');
  assert(bytes.startsWith('\ufeff'));assert(bytes.includes('방문 세션'));
  assert(!bytes.includes('tester@example.test'),'CSV must never contain inquiry PII');
  assert.equal(errors.length,0,'browser page errors: '+errors.join(' | '));
  console.log('PASS: Chromium admin inquiry search, update/history, announcement/release CRUD & 7-day labels, actual CSV download');
  await context.close();
 }finally{await browser?.close();await new Promise(resolve=>server.close(resolve))}
}
main().catch(e=>{console.error('Administrator workflow E2E:',e);process.exitCode=1});
