const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const src=fs.readFileSync('src/editor/index.html','utf8');
const start=src.indexOf('    function captureSaveState('),end=src.indexOf('    function openInsertBlankPageModal(',start);assert(start>=0&&end>start);
const els={}; for(const id of ['saveAsConfirmBtn','saveAsCancelBtn','saveAsDownloadLink','saveAsDownloadedBtn','saveAsFilenameInput','saveAsStatus','modalBackdrop']) els[id]={style:{},listeners:{},value:'saved.pdf',classList:{contains:()=>true},addEventListener(n,fn){this.listeners[n]=fn},focus(){}};
els.saveAsDownloadedBtn.style.display='none';
let renderCount=0,closeCount=0, compiled, resolveCompile, damagedOutput=false, verified=0, publishedUrls=0;
const events=[];
const doc={name:'a.pdf',bytes:new Uint8Array([1,2]),pdfJsDoc:{},overlays:[{text:'old'}],bookmarks:[],metadata:{title:'old'},attachments:[{name:'x',bytes:new Uint8Array([3])}],dirty:true};
const ctx=vm.createContext({doc,console,JSON,Blob,Uint8Array,window:{SunriseDiagnostics:require('../src/assets/sunrise-diagnostics.js'),navigator:{userAgent:'Chrome/123'}},beginOperationMetric:feature=>(stage,detail)=>events.push({feature,stage,detail}),URL:{createObjectURL:()=> {publishedUrls++;return 'blob:test';}},document:{getElementById:id=>els[id]},
 openModal: opts=>opts.onMount(),closeModal:()=>closeCount++,escapeHtml:x=>x,renderDocTabs:()=>renderCount++,updateCommandStates:()=>{},showToast:()=>{},
 verifySavedPdfBytes:async()=>{verified++;if(damagedOutput)throw Error('손상된 출력 PDF');},
 compileDocumentWithOverlays: snapshot=>{compiled=snapshot;return new Promise(r=>resolveCompile=r)}});
const from=src.indexOf('    function tracedOperationFailure('),to=src.indexOf('    async function openPdfFile(',from);
assert(from>=0&&to>from);
vm.runInContext('let pendingSaveUrl = null;\n'+src.slice(from,to)+src.slice(start,end),ctx);
(async()=>{
 const capture=vm.runInContext('captureSaveState(doc)',ctx);doc.overlays[0].text='changed';assert.equal(capture.snapshot.overlays[0].text,'old');assert.equal(vm.runInContext('saveStateIsCurrent(doc, capture)',vm.createContext({...ctx,capture})),false);
 doc.overlays[0].text='old';vm.runInContext('openSaveAsModal(doc)',ctx);
 let prepare=els.saveAsConfirmBtn.listeners.click();assert.strictEqual(compiled.bytes,doc.bytes,'immutable PDF bytes must be shared without a large copy');doc.metadata.title='changed';resolveCompile(new Uint8Array([8]));await prepare;
 assert(els.saveAsStatus.textContent.includes('변경'));
 assert.equal(events.at(-1).detail.code,'save_stale_state');assert.equal(events.at(-1).detail.trace?.callsite,'check_snapshot');assert.equal(els.saveAsDownloadLink.style.display,undefined);assert.equal(doc.dirty,true);
 doc.metadata.title='old';
 damagedOutput=true;prepare=els.saveAsConfirmBtn.listeners.click();resolveCompile(new Uint8Array([8]));await prepare;
 assert(els.saveAsStatus.textContent.includes('손상된 출력 PDF'));
 assert.equal(events.at(-1).detail.code,'save_verify_failed');assert.equal(events.at(-1).detail.trace?.module,'document_save');
 assert(events.at(-1).detail.trace?.steps.some(s=>s.step==='verify_failed'));assert(!JSON.stringify(events).includes('손상된 출력 PDF'));
 assert.equal(publishedUrls,0,'Damaged PDF must not become a downloadable Blob URL');
 assert.equal(els.saveAsDownloadLink.style.display,undefined);
 assert.equal(doc.dirty,true);
 damagedOutput=false;prepare=els.saveAsConfirmBtn.listeners.click();resolveCompile(new Uint8Array([8]));await prepare;
 assert.equal(publishedUrls,1);assert.equal(events.at(-1).stage,'succeeded');assert.equal(events.at(-1).feature,'save_prepare');
 assert(verified>=2,'Saved output must be checked prior to publication');
 assert.equal(els.saveAsDownloadedBtn.style.display,'none');
 let prevented=false;els.saveAsDownloadLink.onclick({preventDefault(){prevented=true}});assert.equal(prevented,false);assert.equal(doc.dirty,true);assert.equal(els.saveAsDownloadedBtn.style.display,'inline-flex');
 doc.overlays[0].text='new';els.saveAsDownloadedBtn.onclick();assert.equal(doc.dirty,true);assert.equal(closeCount,0);
 doc.overlays[0].text='old';els.saveAsDownloadedBtn.onclick();assert.equal(doc.dirty,false);assert.equal(closeCount,1);
 console.log('PASS: save snapshot, damaged output blocked before URL publication, explicit download confirmation, later edits preserved');
})().catch(e=>{console.error(e);process.exitCode=1});
