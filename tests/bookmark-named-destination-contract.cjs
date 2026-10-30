const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),lib=require('../dist/assets/pdf-lib/pdf-lib.min.js');
const src=fs.readFileSync('src/editor/index.html','utf8'), a=src.indexOf('    function allowPageStructureChange('),b=src.indexOf('    async function copySelectedPagesToClipboard(',a);assert(a>=0&&b>a);
let toast='';const ctx=vm.createContext({window:{PDFLib:lib},console:{warn(){}},showToast:s=>toast=s});vm.runInContext(src.slice(a,b),ctx);const n=lib.PDFName.of;
async function fixture(type){
 const pdf=await lib.PDFDocument.create();for(let i=0;i<3;i++)pdf.addPage();const c=pdf.context;
 const root=c.obj({Type:'Outlines'}),rr=c.register(root);pdf.catalog.set(n('Outlines'),rr);
 const bm=c.obj({Title:lib.PDFHexString.fromText('목차'),Parent:rr}),ref=c.register(bm);
 root.set(n('First'),ref);root.set(n('Last'),ref);root.set(n('Count'),lib.PDFNumber.of(1));
 const dest=c.obj([pdf.getPage(1).ref,n('Fit')]);
 if(type==='legacy'){pdf.catalog.set(n('Dests'),c.obj({chapter:dest}));bm.set(n('Dest'),n('chapter'));}
 if(['tree','action-named','duplicate','numeric'].includes(type)){
   const value=type==='numeric'?c.obj([1,n('Fit')]):c.obj({D:dest});
   const leaf=c.obj({Names:[lib.PDFString.of('chapter'),value]});
   const tree=c.obj({Kids:[c.register(leaf)]});pdf.catalog.set(n('Names'),c.obj({Dests:c.register(tree)}));
   if(type==='duplicate')pdf.catalog.set(n('Dests'),c.obj({chapter:dest}));
   if(type==='action-named')bm.set(n('A'),c.obj({S:'GoTo',D:lib.PDFString.of('chapter')}));
   else bm.set(n('Dest'),lib.PDFString.of('chapter'));
 }
 if(type==='action')bm.set(n('A'),c.obj({S:'GoTo',D:dest}));
 if(type==='chain')bm.set(n('A'),c.obj({S:'GoTo',D:dest,Next:{S:'URI',URI:lib.PDFString.of('https://example.org')}}));
 return pdf;
}
function allow(pdf, removed=[]){ctx.pdf=pdf;ctx.removed=removed;return vm.runInContext('allowPageStructureChange(pdf,removed)',ctx);}
(async()=>{
 for(const type of ['legacy','tree','action','action-named','numeric']){
  const pdf=await fixture(type);assert.equal(allow(pdf),true,type);assert.equal(allow(pdf,[0]),true,type);assert.equal(allow(pdf,[1]),false,type);assert.match(toast,/가리키는|목적지/);
  const oldRef=pdf.getPage(1).ref.toString(), pages=pdf.getPages();for(let i=2;i>=0;i--)pdf.removePage(i);[2,0,1].forEach(i=>pdf.addPage(pages[i]));
  const reopened=await lib.PDFDocument.load(await pdf.save());assert.equal(reopened.getPage(2).ref.toString(),oldRef);assert.equal(allow(reopened),true,type);
 }
 for(const type of ['duplicate','chain'])assert.equal(allow(await fixture(type)),false,type);
 console.log('PASS: legacy and name-tree destinations, GoTo actions, reorder, referenced-page protection, ambiguous names and chained actions');
})().catch(e=>{console.error(e);process.exitCode=1});
