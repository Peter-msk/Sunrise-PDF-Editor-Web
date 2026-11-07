const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const src=fs.readFileSync('src/editor/index.html','utf8');const a=src.indexOf('    async function parsePageCountAndMeta('),b=src.indexOf('    async function ensurePageTexts(',a);assert(a>=0&&b>a);
let active=0,max=0,deleted=0,failPage=0,failAttach=false;
const reader={numPages:12,getAttachments:async()=>{if(failAttach)throw Error('attachments');return {'x':{filename:'x',content:new Uint8Array([7])}}},
 getPage:async n=>{active++;max=Math.max(max,active);await new Promise(r=>setImmediate(r));active--;if(n===failPage)throw Error('page failure');return {getViewport:()=>({width:n*10,height:100+n})}},destroy:async()=>deleted++};
const fakePdf={getPageCount:()=>12,getTitle:()=>'',getAuthor:()=>'',getSubject:()=>'',getKeywords:()=>''};
const ctx=vm.createContext({window:{PDFLib:{PDFDocument:{load:async()=>fakePdf}},pdfjsLib:{getDocument:()=>({promise:Promise.resolve(reader)})}},Uint8Array,console:{warn(){}},pdfJsLoadOptions:()=>({})});vm.runInContext(src.slice(src.indexOf('    function isEncryptedPdfError('),src.indexOf('    async function openPdfFile('))+src.slice(a,b),ctx);
(async()=>{let out=await vm.runInContext('parsePageCountAndMeta(new Uint8Array([1]))',ctx);assert.equal(max,4);assert.deepEqual(Array.from(out.pageSizes,x=>x.width),Array.from({length:12},(_,i)=>(i+1)*10));assert.deepEqual(Array.from(out.pageTexts),Array(12).fill(null));assert.equal(out.attachments[0].name,'x');
 failAttach=true;out=await vm.runInContext('parsePageCountAndMeta(new Uint8Array([1]))',ctx);assert.equal(out.attachmentsReadable,false);assert.equal(out.attachments.length,0);
 failPage=3;await assert.rejects(vm.runInContext('parsePageCountAndMeta(new Uint8Array([1]))',ctx),/페이지 정보를 읽지 못했습니다/);assert.equal(deleted,1);assert.equal(active,0);
 console.log('PASS: bounded parallel page metadata, ordered pages, attachment failure and cleanup');
})().catch(e=>{console.error(e);process.exitCode=1});
