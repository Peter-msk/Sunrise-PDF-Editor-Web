const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),lib=require('../dist/assets/pdf-lib/pdf-lib.min.js');
const src=fs.readFileSync('src/editor/index.html','utf8'), n=lib.PDFName.of;
const section=(a,b)=>{const i=src.indexOf(a),j=src.indexOf(b,i);assert(i>=0&&j>i);return src.slice(i,j)};
let notice='', snapshots=0, callback, clipboard={sourceName:'old'};
const state={get pageClipboard(){return clipboard},set pageClipboard(v){clipboard=v}};
const elements={reorderInput:{value:'3, 1, 2'},reorderConfirmBtn:{addEventListener:(_,f)=>callback=f},reorderCancelBtn:{addEventListener(){}},reorderReverseBtn:{addEventListener(){}}};
const ctx=vm.createContext({window:{PDFLib:lib},state,Set,Array,console:{warn(){}},showToast:s=>notice=s,saveUndoSnapshot:()=>snapshots++,reloadDocPdfJs:async()=>{},refreshAllViews:async()=>{},closeModal(){},openModal:c=>c.onMount(),document:{getElementById:id=>elements[id]},remapPageItems(){}});
vm.runInContext(section('    function allowPageStructureChange(', '    function openPastePagesModal(')+section('    async function deleteSelectedPagesFromDoc(', '    async function rotateSelectedPages('),require('./helpers/editor-metrics.cjs')(ctx));
async function fixture(type='direct'){
 const pdf=await lib.PDFDocument.create();pdf.addPage();pdf.addPage();pdf.addPage();const c=pdf.context;
 const root=c.obj({Type:'Outlines'}),rr=c.register(root);pdf.catalog.set(n('Outlines'),rr);
 const item=c.obj({Title:lib.PDFHexString.fromText('mark'),Parent:rr});
 if(type==='direct') item.set(n('Dest'),c.obj([pdf.getPage(1).ref,n('Fit')]));
 if(type==='number') item.set(n('Dest'),c.obj([99,n('Fit')]));
 if(type==='validnumber') item.set(n('Dest'),c.obj([1,n('Fit')]));
 if(type==='action') item.set(n('A'),c.obj({S:'URI',URI:lib.PDFString.of('https://example.org')}));
 const ref=c.register(item);root.set(n('First'),ref);root.set(n('Last'),ref);root.set(n('Count'),lib.PDFNumber.of(1));
 return {bytes:await pdf.save(),name:'sample.pdf',pageCount:3,currentPage:0,selectedPages:new Set([0]),overlays:[],bookmarks:[]};
}
async function destinationIndex(bytes){const d=await lib.PDFDocument.load(bytes),r=d.catalog.lookup(n('Outlines')),bm=d.context.lookup(r.get(n('First'))),dest=bm.lookup(n('Dest'));return d.getPages().findIndex(p=>p.ref.toString()===dest.get(0).toString());}
(async()=>{
 let doc=await fixture();ctx.doc=doc;vm.runInContext('openReorderPagesModal(doc)',require('./helpers/editor-metrics.cjs')(ctx));await callback();assert.equal(await destinationIndex(doc.bytes),2);assert.equal(snapshots,1);
 doc=await fixture('validnumber');ctx.doc=doc;vm.runInContext('openReorderPagesModal(doc)',require('./helpers/editor-metrics.cjs')(ctx));await callback();assert.equal(await destinationIndex(doc.bytes),2);
 doc=await fixture();ctx.doc=doc;await vm.runInContext('deleteSelectedPagesFromDoc(doc)',require('./helpers/editor-metrics.cjs')(ctx));assert.equal(await destinationIndex(doc.bytes),0);assert.equal((await lib.PDFDocument.load(doc.bytes)).getPageCount(),2);
 doc=await fixture();ctx.doc=doc;await vm.runInContext('copySelectedPagesToClipboard(doc,true)',require('./helpers/editor-metrics.cjs')(ctx));assert.equal(await destinationIndex(doc.bytes),0);assert.equal(clipboard.sourceName,'sample.pdf');
 clipboard={sourceName:'old'};
 doc=await fixture();ctx.doc=doc;doc.selectedPages=new Set([1]);const before=doc.bytes, count=snapshots;await vm.runInContext('deleteSelectedPagesFromDoc(doc)',require('./helpers/editor-metrics.cjs')(ctx));assert.equal(doc.bytes,before);assert.equal(snapshots,count);assert.match(notice,/가리키는 기존 북마크/);
 await vm.runInContext('copySelectedPagesToClipboard(doc,true)',require('./helpers/editor-metrics.cjs')(ctx));assert.equal(doc.bytes,before);assert.equal(clipboard.sourceName,'old');
 for(const type of ['number','action']){doc=await fixture(type);ctx.doc=doc;const bytes=doc.bytes;vm.runInContext('openReorderPagesModal(doc)',require('./helpers/editor-metrics.cjs')(ctx));await callback();assert.equal(doc.bytes,bytes);assert.match(notice,/북마크 보호/);}
 console.log('PASS: direct bookmark survives reorder and unrelated deletion; targeted deletion, invalid numeric destinations and unsupported actions blocked');
})().catch(e=>{console.error(e);process.exitCode=1});
