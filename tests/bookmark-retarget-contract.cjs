const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),lib=require('../dist/assets/pdf-lib/pdf-lib.min.js');
const src=fs.readFileSync('src/editor/index.html','utf8'),a=src.indexOf('    function renamePdfOutline('),b=src.indexOf('    async function renameExistingBookmark(',a);assert(a>=0&&b>a);
const ctx=vm.createContext({window:{PDFLib:lib}});vm.runInContext(src.slice(a,b),ctx);const n=lib.PDFName.of;
(async()=>{
 const pdf=await lib.PDFDocument.create();for(let i=0;i<3;i++)pdf.addPage();const c=pdf.context;
 const root=c.obj({Type:'Outlines'}),rr=c.register(root);pdf.catalog.set(n('Outlines'),rr);
 const shared=c.obj({S:'GoTo',D:[pdf.getPage(0).ref,n('Fit')]}),ar=c.register(shared);
 const A=c.obj({Title:lib.PDFHexString.fromText('A'),Parent:rr,A:ar}),ra=c.register(A);
 const B=c.obj({Title:lib.PDFHexString.fromText('B'),Parent:rr,Prev:ra,A:ar}),rb=c.register(B);
 const X=c.obj({Title:lib.PDFHexString.fromText('외부'),Parent:rr,Prev:rb,A:{S:'URI',URI:lib.PDFString.of('https://example.org')}}),rx=c.register(X);
 A.set(n('Next'),rb);B.set(n('Next'),rx);root.set(n('First'),ra);root.set(n('Last'),rx);root.set(n('Count'),lib.PDFNumber.of(3));
 ctx.pdf=pdf;ctx.rows=[{path:[0],titles:['A']},{path:[1],titles:['B']},{path:[2],titles:['외부']}];
 assert.throws(()=>vm.runInContext("renamePdfOutline(pdf,[0],['A'],'',rows,false,3)",ctx),/페이지/);
 assert.throws(()=>vm.runInContext("renamePdfOutline(pdf,[2],['외부'],'',rows,false,1)",ctx),/안전하게/);
 assert.throws(()=>vm.runInContext("renamePdfOutline(pdf,[0],['오류'],'',rows,false,1)",ctx),/일치하지/);
 vm.runInContext("renamePdfOutline(pdf,[0],['A'],'',rows,false,2)",ctx);
 assert.equal(A.lookup(n('A')).lookup(n('D')).get(0).toString(),pdf.getPage(2).ref.toString());
 assert.equal(B.lookup(n('A')).lookup(n('D')).get(0).toString(),pdf.getPage(0).ref.toString());
 assert.equal(shared.lookup(n('D')).get(0).toString(),pdf.getPage(0).ref.toString());
 const reopened=await lib.PDFDocument.load(await pdf.save());const root2=reopened.catalog.lookup(n('Outlines')),one=reopened.context.lookup(root2.get(n('First'))),two=reopened.context.lookup(one.get(n('Next')));
 assert.equal(one.lookup(n('A')).lookup(n('D')).get(0).toString(),reopened.getPage(2).ref.toString());
 assert.equal(two.lookup(n('A')).lookup(n('D')).get(0).toString(),reopened.getPage(0).ref.toString());
 assert.equal(one.lookup(n('Title')).decodeText(),'A');assert.equal(root2.lookup(n('Count')).asNumber(),3);
 const reader={}, original=await pdf.save();let current={bytes:original,pdfJsDoc:reader,operationBusy:false}, snapshot, fail=false;
 const end=src.indexOf('    async function outlinePage(',b);
 const op=vm.createContext({window:{PDFLib:lib},console:{warn(){}},activeDoc:()=>current,
   parsePageCountAndMeta:async()=>{if(fail)throw Error('read failure');return {pdfJsDoc:{destroy:async()=>{}}}},
   saveUndoSnapshot:doc=>snapshot=doc.bytes,reloadDocPdfJs:async(doc,options)=>{doc.pdfJsDoc=options.info.pdfJsDoc},refreshAllViews:async()=>{},showToast(){}});
 vm.runInContext(src.slice(a,end),op);op.doc=current;op.reader=reader;op.rows=ctx.rows;op.bm=ctx.rows[0];
 await vm.runInContext("renameExistingBookmark(doc,reader,bm,'',rows,false,1)",op);
 assert.equal(snapshot,original);assert.notEqual(current.bytes,original);assert.equal(current.operationBusy,false);
 const result=await lib.PDFDocument.load(current.bytes),r=result.catalog.lookup(n('Outlines')),item=result.context.lookup(r.get(n('First')));
 assert.equal(item.lookup(n('A')).lookup(n('D')).get(0).toString(),result.getPage(1).ref.toString());
 current={bytes:original,pdfJsDoc:reader,operationBusy:false};op.doc=current;snapshot=null;fail=true;
 await vm.runInContext("renameExistingBookmark(doc,reader,bm,'',rows,false,1)",op);
 assert.equal(current.bytes,original);assert.equal(snapshot,null);assert.equal(current.operationBusy,false);
 console.log('PASS: bookmark page retarget, shared action isolation, save/reopen, undo snapshot and failure safety');
})().catch(e=>{console.error(e);process.exitCode=1});
