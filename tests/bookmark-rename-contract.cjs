const assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm');
const lib = require('../dist/assets/pdf-lib/pdf-lib.min.js');
const src = fs.readFileSync('src/editor/index.html','utf8');
const a = src.indexOf('    function renamePdfOutline('), b = src.indexOf('    async function renameExistingBookmark(',a);
assert(a >= 0 && b > a);
const ctx = vm.createContext({window:{PDFLib:lib}}); vm.runInContext(src.slice(a,b),require('./helpers/editor-metrics.cjs')(ctx));
const n = lib.PDFName.of;
(async()=>{
 const pdf=await lib.PDFDocument.create();pdf.addPage([100,100]);pdf.addPage([100,100]);
 const root=pdf.context.obj({Type:'Outlines'}), rr=pdf.context.register(root);pdf.catalog.set(n('Outlines'),rr);
 const first=pdf.context.obj({Title:lib.PDFHexString.fromText('상위'), Parent:rr, Dest:[pdf.getPage(0).ref,n('Fit')], Count:1}); const f=pdf.context.register(first);
 const child=pdf.context.obj({Title:lib.PDFHexString.fromText('자식'), Parent:f, A:{S:'URI',URI:lib.PDFString.of('https://example.org')}}); const c=pdf.context.register(child);
 const second=pdf.context.obj({Title:lib.PDFHexString.fromText('다음'),Parent:rr,Prev:f,Dest:[pdf.getPage(1).ref,n('Fit')]});const sec=pdf.context.register(second);
 first.set(n('Next'),sec);first.set(n('First'),c);first.set(n('Last'),c);root.set(n('First'),f);root.set(n('Last'),sec);root.set(n('Count'),lib.PDFNumber.of(3));
 const rows=[{path:[0],titles:['상위']},{path:[0,0],titles:['상위','자식']},{path:[1],titles:['다음']}];
 ctx.pdf=pdf;ctx.rows=rows;
 assert.throws(()=>vm.runInContext("renamePdfOutline(pdf,[0,0],['상위','틀림'],'새 이름',rows)",require('./helpers/editor-metrics.cjs')(ctx)),/일치하지/);
 assert.equal(child.lookup(n('Title')).decodeText(),'자식');
 ctx.badRows=rows.slice(1);assert.throws(()=>vm.runInContext("renamePdfOutline(pdf,[0,0],['상위','자식'],'새 이름',badRows)",require('./helpers/editor-metrics.cjs')(ctx)),/일치하지/);
 vm.runInContext("renamePdfOutline(pdf,[0,0],['상위','자식'],'  새 이름  ',rows)",require('./helpers/editor-metrics.cjs')(ctx));
 const saved=await pdf.save(), reopened=await lib.PDFDocument.load(saved), r=reopened.catalog.lookup(n('Outlines'));
 const p=reopened.context.lookup(r.get(n('First'))), ch=reopened.context.lookup(p.get(n('First'))), sibling=reopened.context.lookup(p.get(n('Next')));
 assert.equal(ch.lookup(n('Title')).decodeText(),'새 이름');assert.equal(ch.lookup(n('A')).lookup(n('URI')).decodeText(),'https://example.org');
 assert.equal(sibling.lookup(n('Title')).decodeText(),'다음');assert.equal(r.lookup(n('Count')).asNumber(),3);
 assert.equal(p.get(n('Last')).toString(),c.toString());assert.equal(sibling.get(n('Prev')).toString(),f.toString());
 const opEnd=src.indexOf('    async function outlinePage(',b);
 let currentDoc, snapBytes, toast='', destroyed=0, failParse=false;
 const opCtx=vm.createContext({window:{PDFLib:lib}, console:{warn(){}}, activeDoc:()=>currentDoc,
   parsePageCountAndMeta:async()=>{if(failParse)throw Error('reader failure'); return {pdfJsDoc:{destroy:async()=>{destroyed++}}};},
   saveUndoSnapshot:doc=>{snapBytes=doc.bytes;}, reloadDocPdfJs:async(doc,opts)=>{doc.pdfJsDoc=opts.info.pdfJsDoc;},
   refreshAllViews:async()=>{}, showToast:msg=>{toast=msg;}});
 vm.runInContext(src.slice(a,opEnd),require('./helpers/editor-metrics.cjs')(opCtx));
 const untouched=await lib.PDFDocument.load(saved), editedChild=untouched.context.lookup(c);
 editedChild.set(n('Title'),lib.PDFHexString.fromText('자식'));
 const originalBytes=await untouched.save(), reader={};
 currentDoc={bytes:originalBytes,pdfJsDoc:reader,operationBusy:false};
 opCtx.doc=currentDoc;opCtx.reader=reader;opCtx.row=rows[1];opCtx.rows=rows;
 await vm.runInContext("renameExistingBookmark(doc,reader,row,'변경',rows)",require('./helpers/editor-metrics.cjs')(opCtx));
 assert.equal(snapBytes,originalBytes);assert.notEqual(currentDoc.bytes,originalBytes);assert.equal(currentDoc.operationBusy,false);
 const after=await lib.PDFDocument.load(currentDoc.bytes);assert.equal(after.context.lookup(c).lookup(n('Title')).decodeText(),'변경');
 const failDoc={bytes:originalBytes,pdfJsDoc:reader,operationBusy:false};currentDoc=failDoc;opCtx.doc=failDoc;snapBytes=null;failParse=true;
 await vm.runInContext("renameExistingBookmark(doc,reader,row,'변경',rows)",require('./helpers/editor-metrics.cjs')(opCtx));
 assert.equal(failDoc.bytes,originalBytes);assert.equal(snapBytes,null);assert.equal(failDoc.operationBusy,false);assert.match(toast,/변경하지 못했습니다/);
 console.log('PASS: nested outline rename, Unicode persistence, action preservation, mismatch rejection, atomic failure and undo snapshot');
})().catch(e=>{console.error(e);process.exitCode=1});
