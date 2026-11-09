'use strict';
// Regression for real 2026-11-09 batch_split failed operations: fixed, private
// failure-stage attribution and non-destructive handling of common PDF flags.
const assert=require('node:assert/strict'),fs=require('node:fs');
const L=require('../dist/assets/pdf-lib/pdf-lib.min.js');
const B=require('../src/assets/sunrise-batch-pages.js');
const diag=require('../src/assets/sunrise-diagnostics.js');
const uuid=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
const make=(name,bytes)=>({name,size:bytes.byteLength,bytes});
const opts={PDFLib:L,readFile:async f=>f.bytes};
const setup=()=>{const results=[],errors=[];return {results,errors,handlers:{cancelled:()=>false,result:x=>results.push(x),error:x=>errors.push(x)}}};
async function fixture(markInfo){
 const doc=await L.PDFDocument.create();doc.addPage([612,792]).drawText('Safe PDF',{x:30,y:700});
 if(markInfo)doc.catalog.set(L.PDFName.of('MarkInfo'),doc.context.obj(markInfo));
 return make('client_secret_document.pdf',Uint8Array.from(await doc.save()));
}
async function execute(file,options=opts){const out=setup();await B.process([file],{mode:'split',pagesPerFile:1},out.handlers,options);return out}
(async()=>{
 const valid=await fixture();
 const untagged=await fixture({Marked:false,Suspects:false});
 const before=Uint8Array.from(untagged.bytes);
 let a=await execute(untagged);
 assert.equal(a.errors.length,0,'explicit untagged PDF should safely split');
 assert.equal(a.results.length,1);
 assert.equal((await L.PDFDocument.load(a.results[0].bytes)).getPageCount(),1);
 assert.deepEqual(untagged.bytes,before,'source bytes not mutated');
 for(const markInfo of [{Marked:true},{Marked:false,Suspects:true},{Marked:false,Extra:'unexpected'}]){
  a=await execute(await fixture(markInfo));assert.equal(a.results.length,0);
  assert.equal(a.errors[0]?.code,'batch_unsupported_structure');
  assert.equal(a.errors[0]?.pages,1);
 }
 // Tagged-document structure never silently discarded even when Marked is false.
 const struct=await L.PDFDocument.create();struct.addPage();
 struct.catalog.set(L.PDFName.of('MarkInfo'),struct.context.obj({Marked:false}));
 struct.catalog.set(L.PDFName.of('StructTreeRoot'),struct.context.obj({Type:'StructTreeRoot'}));
 a=await execute(make('tagged.pdf',Uint8Array.from(await struct.save())));
 assert.equal(a.errors[0]?.code,'batch_unsupported_structure');
 assert.equal(a.results.length,0);
 const badRead={...valid,size:valid.size+1};a=await execute(badRead);
 assert.equal(a.errors[0]?.code,'batch_read_failed');
 a=await execute(valid,{...opts,readFile:async()=>{throw Error('Do not send sensitive file read message')}});
 assert.equal(a.errors[0]?.code,'batch_read_failed');
 a=await execute(make('secret_name.pdf',Uint8Array.from([1,2,3,4,5,6])));
 assert.equal(a.errors[0]?.code,'batch_parse_failed');
 const failureCode=(override)=>({...L,PDFDocument:{...L.PDFDocument,
  create:async()=>{const p=await L.PDFDocument.create();override(p);return p},
  load:(...args)=>L.PDFDocument.load(...args)
 }});
 a=await execute(valid,{...opts,PDFLib:failureCode(p=>p.copyPages=async()=>{throw Error('sensitive page copy stack')})});
 assert.equal(a.errors[0]?.code,'batch_copy_failed');
 a=await execute(valid,{...opts,PDFLib:failureCode(p=>p.save=async()=>{throw Error('sensitive save stack')})});
 assert.equal(a.errors[0]?.code,'batch_save_failed');
 let loads=0;
 const tampered={...L,PDFDocument:{...L.PDFDocument,
  load:async(...args)=>{const p=await L.PDFDocument.load(...args);if(++loads===2)p.getPage(0).node.delete(L.PDFName.of('Contents'));return p}
 }};
 a=await execute(valid,{...opts,PDFLib:tampered});
 assert.equal(a.errors[0]?.code,'batch_verify_failed');
 const limit=await L.PDFDocument.create();for(let i=0;i<151;i++)limit.addPage();
 a=await execute(make('too-long.pdf',await limit.save()));
 assert.equal(a.errors[0]?.code,'batch_limit_exceeded');
 // Fixed vocabulary is an allowlist; no PDF filenames/messages/stack in payload.
 for(const code of ['batch_read_failed','batch_parse_failed','batch_unsupported_structure','batch_limit_exceeded',
  'batch_copy_failed','batch_save_failed','batch_verify_failed','batch_unexpected']){
  const info=diag.capture({sunriseDiagnosticCode:code,message:'client_secret_document.pdf'},
    {origin:'file',bytes:valid.size,pages:1,ua:'Mozilla/5.0 Edg/127'});
  assert.equal(info.code,code);assert.equal(info.browser,'edge');assert.equal(info.pages,'one');
  assert.deepEqual(diag.normalize(info),info);
  assert(!JSON.stringify(info).includes('secret'));
  assert.equal(diag.normalize({...info,filename:'client_secret_document.pdf'}),null);
 }
 // Full D1 contract: one structured failure, no duplicate count, feature filter.
 const {sqlite,db,close}=require('./helpers/d1-sqlite.cjs').createD1Fixture();
 try{
  const {telemetry,adminApi}=await import('../src/admin-api.mjs');
  const root='https://sunrise.test',session=uuid(1),operationId=uuid(2),today=new Date(Date.now()+9*3600000).toISOString().slice(0,10);
  const env={DB:db,CF_VERSION_METADATA:{id:'11111111-1111-4111-8111-111111111111'}};
  const send=async data=>telemetry(new Request(root+'/api/telemetry',{method:'POST',headers:{origin:root,'content-type':'application/json'},body:JSON.stringify({session,...data})}),env,new URL(root+'/api/telemetry'));
  assert.equal((await send({type:'visit'})).status,200);
  await send({type:'operation',feature:'batch_split',operationId,stage:'started'});
  const details=diag.capture({sunriseDiagnosticCode:'batch_unsupported_structure'},
   {origin:'file',bytes:valid.size,pages:1,ua:'Edg/127'});
  assert.equal((await send({type:'operation',feature:'batch_split',operationId,stage:'failed',diagnostic:details})).status,200);
  await send({type:'operation',feature:'batch_split',operationId,stage:'failed',diagnostic:details});
  assert.equal(sqlite.prepare('SELECT COUNT(*) as n FROM analytics_diagnostics').get().n,1);
  assert.equal(sqlite.prepare("SELECT count FROM analytics_errors WHERE day=? AND feature='페이지'").get(today).count,1);
  const read=async uri=>{const u=new URL(root+uri);return adminApi(new Request(u),env,u,'admin')};
  const found=await read('/api/admin/diagnostics?feature=batch_split&days=14');assert.equal(found.status,200);
  const json=await found.json();assert.equal(json.items.length,1);assert.equal(json.items[0].code,'batch_unsupported_structure');assert.equal(json.legacyOpen.length,0);
  assert(!JSON.stringify(json).includes(session));
  assert.equal((await read('/api/admin/diagnostics?feature=batch_merge&days=14')).status,200);
  const csv=await read('/api/admin/diagnostics.csv?feature=batch_split');assert((await csv.text()).includes('batch_unsupported_structure'));
  assert.equal((await read('/api/admin/diagnostics?feature=client_secret_document.pdf')).status,400);
 }finally{close()}
 const html=fs.readFileSync('src/editor/index.html','utf8'),admin=fs.readFileSync('dist/admin/index.html','utf8');
 assert(html.includes("captureBatchFailure=(code,index,pageCount)"));
 assert(html.includes("finish(outcome,outcome==='failed'?firstFailure:null)"));
 assert(admin.includes('<option value="batch_split">일괄 분할</option>'));
 console.log('PASS: batch split benign MarkInfo, secure refusals, 7 failure stages, privacy allowlist, D1 exact once, filtered admin diagnostics');
})().catch(error=>{console.error(error);process.exitCode=1});
