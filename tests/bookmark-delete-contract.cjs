const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const lib=require('../dist/assets/pdf-lib/pdf-lib.min.js'),src=fs.readFileSync('src/editor/index.html','utf8');
const a=src.indexOf('    function renamePdfOutline('),b=src.indexOf('    async function renameExistingBookmark(',a);assert(a>=0&&b>a);
const ctx=vm.createContext({window:{PDFLib:lib}});vm.runInContext(src.slice(a,b),ctx);const n=lib.PDFName.of;
async function fixture(closed=false){
 const pdf=await lib.PDFDocument.create();pdf.addPage();const C=pdf.context;
 const root=C.obj({Type:'Outlines'}),r=C.register(root);pdf.catalog.set(n('Outlines'),r);
 const A=C.obj({Title:lib.PDFHexString.fromText('A'),Parent:r,Count:closed?-2:2}),ar=C.register(A);
 const B=C.obj({Title:lib.PDFHexString.fromText('B'),Parent:r,Prev:ar,Dest:[pdf.getPage(0).ref,n('Fit')]}),br=C.register(B);A.set(n('Next'),br);
 const X=C.obj({Title:lib.PDFHexString.fromText('X'),Parent:ar}),xr=C.register(X);
 const Y=C.obj({Title:lib.PDFHexString.fromText('Y'),Parent:ar,Prev:xr}),yr=C.register(Y);X.set(n('Next'),yr);A.set(n('First'),xr);A.set(n('Last'),yr);
 root.set(n('First'),ar);root.set(n('Last'),br);root.set(n('Count'),lib.PDFNumber.of(closed?2:4));
 const rows=[{path:[0],titles:['A']},{path:[0,0],titles:['A','X']},{path:[0,1],titles:['A','Y']},{path:[1],titles:['B']}];
 return {pdf,root,A,B,X,Y,ar,br,xr,yr,rows};
}
function remove(f,path,titles){ctx.pdf=f.pdf;ctx.path=path;ctx.titles=titles;ctx.rows=f.rows;vm.runInContext("renamePdfOutline(pdf,path,titles,'',rows,true)",ctx);}
(async()=>{
 let f=await fixture();remove(f,[0,0],['A','X']);assert.equal(f.A.get(n('First')).toString(),f.yr.toString());assert.equal(f.Y.get(n('Prev')),undefined);assert.equal(f.A.lookup(n('Count')).asNumber(),1);assert.equal(f.root.lookup(n('Count')).asNumber(),3);
 let saved=await f.pdf.save(),r=await lib.PDFDocument.load(saved);assert.equal(r.context.lookup(f.yr).lookup(n('Title')).decodeText(),'Y');
 f=await fixture(true);remove(f,[0,1],['A','Y']);assert.equal(f.A.lookup(n('Count')).asNumber(),-1);assert.equal(f.root.lookup(n('Count')).asNumber(),2);assert.equal(f.X.get(n('Next')),undefined);
 f=await fixture();remove(f,[0],['A']);assert.equal(f.root.get(n('First')).toString(),f.br.toString());assert.equal(f.B.get(n('Prev')),undefined);assert.equal(f.root.lookup(n('Count')).asNumber(),1);assert.equal(f.B.lookup(n('Title')).decodeText(),'B');
 f=await fixture();remove(f,[1],['B']);assert.equal(f.root.get(n('Last')).toString(),f.ar.toString());assert.equal(f.A.get(n('Next')),undefined);assert.equal(f.root.lookup(n('Count')).asNumber(),3);
 f=await fixture();f.root.set(n('Count'),lib.PDFNumber.of(99));assert.throws(()=>remove(f,[0],['A']),/개수/);assert.equal(f.root.get(n('First')).toString(),f.ar.toString());assert.equal(f.A.get(n('Next')).toString(),f.br.toString());
 console.log('PASS: nested deletion, subtree deletion, first/last links, closed ancestors and invalid counts');
})().catch(e=>{console.error(e);process.exitCode=1});
