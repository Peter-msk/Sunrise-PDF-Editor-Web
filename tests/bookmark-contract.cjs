const assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm');
const lib = require('../dist/assets/pdf-lib/pdf-lib.min.js');
const src = fs.readFileSync('src/editor/index.html','utf8');
const a = src.indexOf('    function appendPdfBookmarks('), b = src.indexOf('    async function compileDocumentWithOverlays(',a);
assert(a>=0 && b>a);
const ctx=vm.createContext({window:{PDFLib:lib,SunriseOutlineTransfer:require('../src/assets/sunrise-outline-transfer.js')}}); vm.runInContext(src.slice(a,b),ctx);
(async()=>{
 const pdf=await lib.PDFDocument.create();pdf.addPage([300,400]);pdf.addPage([300,400]);ctx.pdf=pdf;
 vm.runInContext(`appendPdfBookmarks(pdf,[{title:'첫 장',page:0},{title:'두 번째',page:1}])`,ctx);
 const bytes=await pdf.save();const reopened=await lib.PDFDocument.load(bytes);ctx.pdf2=reopened;
 vm.runInContext(`appendPdfBookmarks(pdf2,[{title:'추가',page:1}])`,ctx);
 const saved=await reopened.save();fs.writeFileSync('/tmp/sunrise-bookmark-check.pdf',saved);
 const check=await lib.PDFDocument.load(saved);const n=lib.PDFName.of;let root=check.catalog.lookup(n('Outlines'));assert.equal(root.lookup(n('Count')).asNumber(),3);
 let first=check.context.lookup(root.get(n('First'))), second=check.context.lookup(first.get(n('Next'))), third=check.context.lookup(second.get(n('Next')));
 assert.equal(first.lookup(n('Title')).decodeText(),'첫 장');assert.equal(second.lookup(n('Title')).decodeText(),'두 번째');assert.equal(third.lookup(n('Title')).decodeText(),'추가');
 assert.equal(third.get(n('Prev')).toString(),first.get(n('Next')).toString());
 assert.throws(()=>vm.runInContext(`appendPdfBookmarks(pdf2,[{title:'bad',page:99}])`,ctx));
 console.log('PASS: Unicode titles, page destinations, append without replacing existing bookmarks, invalid page');
})().catch(e=>{console.error(e);process.exitCode=1});
