const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),lib=require('../dist/assets/pdf-lib/pdf-lib.min.js');
const src=fs.readFileSync('src/editor/index.html','utf8'),a=src.indexOf('    function allowPageStructureChange('),b=src.indexOf('    async function copySelectedPagesToClipboard(',a);assert(a>=0&&b>a);
let message='';const ctx=vm.createContext({window:{PDFLib:lib},console:{warn(){}},showToast:s=>message=s});vm.runInContext(src.slice(a,b),ctx);const n=lib.PDFName.of;
function allow(pdf,removed=[]){ctx.pdf=pdf;ctx.removed=removed;return vm.runInContext('allowPageStructureChange(pdf,removed)',ctx);}
async function fixture(mode){
 const pdf=await lib.PDFDocument.create();for(let i=0;i<4;i++)pdf.addPage();const c=pdf.context,pages=pdf.getPages();
 const root=c.obj({Type:'Outlines'}),rr=c.register(root);pdf.catalog.set(n('Outlines'),rr);
 const a1=c.obj({S:'GoTo',D:[0,n('Fit')]}),a2=c.obj({S:'GoTo',D:[pages[1].ref,n('Fit')]}),a3=c.obj({S:'GoTo',D:[pages[2].ref,n('Fit')]});
 const r1=c.register(a1),r2=c.register(a2),r3=c.register(a3);
 if(mode==='array')a1.set(n('Next'),c.obj([r2,r3]));
 if(mode==='nested'){a1.set(n('Next'),r2);a2.set(n('Next'),r3);}
 if(mode==='shared'){a1.set(n('Next'),c.obj([r2,r3]));a2.set(n('Next'),r3);}
 if(mode==='cycle'){a1.set(n('Next'),r2);a2.set(n('Next'),r1);}
 if(mode==='unsupported'){a1.set(n('Next'),c.obj({S:'URI',URI:lib.PDFString.of('https://example.org')}));}
 if(mode==='broken')a1.set(n('Next'),c.obj([r2,lib.PDFString.of('bad')]));
 const item=c.obj({Title:lib.PDFHexString.fromText('bookmark'),Parent:rr,A:r1}),itemRef=c.register(item);
 root.set(n('First'),itemRef);root.set(n('Last'),itemRef);root.set(n('Count'),lib.PDFNumber.of(1));
 return {pdf,a1,a2,a3,r1,r2,r3};
}
(async()=>{
 for(const mode of ['array','nested','shared']){
  const f=await fixture(mode),original=f.pdf.getPages().map(x=>x.ref.toString());
  assert.equal(allow(f.pdf,[2]),false);assert.match(message,/목적지/);assert(f.a1.lookup(n('D')).get(0) instanceof lib.PDFNumber,'failed checks must not mutate');
  assert.equal(allow(f.pdf,[3]),true,mode);assert.equal(f.a1.lookup(n('D')).get(0).toString(),original[0]);
  const pages=f.pdf.getPages();for(let i=3;i>=0;i--)f.pdf.removePage(i);[3,2,1,0].forEach(i=>f.pdf.addPage(pages[i]));
  const reopened=await lib.PDFDocument.load(await f.pdf.save());assert.equal(allow(reopened),true);assert.equal(reopened.getPage(3).ref.toString(),original[0]);
  for(const ref of [f.r1,f.r2,f.r3])assert(reopened.context.lookup(ref).lookup(n('D')).get(0) instanceof lib.PDFRef);
 }
 for(const mode of ['cycle','unsupported','broken']){const f=await fixture(mode);assert.equal(allow(f.pdf),false,mode);assert(f.a1.lookup(n('D')).get(0) instanceof lib.PDFNumber);}
 const f=await fixture('array');let snapshots=0,clipboard={sourceName:'unchanged'};
 const state={get pageClipboard(){return clipboard},set pageClipboard(v){clipboard=v}};
 const end=src.indexOf('    function openPastePagesModal(',a),delStart=src.indexOf('    async function deleteSelectedPagesFromDoc('),delEnd=src.indexOf('    async function rotateSelectedPages(',delStart);
 const ui=vm.createContext({window:{PDFLib:lib},state,Set,Array,console:{warn(){}},showToast:s=>message=s,saveUndoSnapshot:()=>snapshots++,reloadDocPdfJs:async()=>{},refreshAllViews:async()=>{},remapPageItems(){}});
 vm.runInContext(src.slice(a,end)+src.slice(delStart,delEnd),ui);
 const original=await f.pdf.save();const doc={bytes:original,name:'chain.pdf',pageCount:4,currentPage:2,selectedPages:new Set([2]),overlays:[],bookmarks:[]};ui.doc=doc;
 await vm.runInContext('copySelectedPagesToClipboard(doc,true)',ui);assert.equal(doc.bytes,original);assert.equal(clipboard.sourceName,'unchanged');assert.equal(snapshots,0);
 doc.selectedPages=new Set([3]);await vm.runInContext('deleteSelectedPagesFromDoc(doc)',ui);assert.equal(snapshots,1);
 const reopened=await lib.PDFDocument.load(doc.bytes);assert.equal(reopened.getPageCount(),3);assert.equal(allow(reopened),true);
 console.log('PASS: GoTo chains, arrays, shared actions, page operations, target protection, cycles and atomic rejection');
})().catch(e=>{console.error(e);process.exitCode=1});
