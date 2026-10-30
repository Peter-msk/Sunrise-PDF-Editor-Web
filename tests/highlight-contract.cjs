const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const PDFLib=require('../dist/assets/pdf-lib/pdf-lib.min.js');
const source=fs.readFileSync('src/editor/index.html','utf8');
const start=source.indexOf('    function addPdfHighlight('),end=source.indexOf('    async function highlightCurrentSearchHit(',start);assert(start>=0&&end>start);
const ctx=vm.createContext({window:{PDFLib},console});vm.runInContext(source.slice(start,end),ctx);
(async()=>{
 const pdf=await PDFLib.PDFDocument.create(),page=pdf.addPage([300,400]);
 page.drawText('HELLO WORLD',{x:50,y:300,size:16});
 page.node.addAnnot(pdf.context.register(pdf.context.obj({Type:'Annot',Subtype:'Text',Rect:[5,5,15,15],Contents:PDFLib.PDFString.of('existing')})));
 ctx.pdf=pdf;vm.runInContext('addPdfHighlight(pdf,0,[50,297,95,315])',ctx);
 assert.throws(()=>vm.runInContext('addPdfHighlight(pdf,0,[1,1,0,2])',ctx));
 const bytes=await pdf.save();const saved=await PDFLib.PDFDocument.load(bytes), annotations=saved.getPage(0).node.Annots();
 assert.equal(annotations.size(),2);const highlight=saved.context.lookup(annotations.get(1));
 assert.equal(highlight.get(PDFLib.PDFName.of('Subtype')).toString(),'/Highlight');assert.equal(highlight.lookup(PDFLib.PDFName.of('QuadPoints')).size(),8);assert(highlight.get(PDFLib.PDFName.of('AP')));
 if(process.env.SUNRISE_HIGHLIGHT_FIXTURE) fs.writeFileSync(process.env.SUNRISE_HIGHLIGHT_FIXTURE,bytes);
 console.log('PASS: native highlight, quad geometry, appearance and existing annotations');
})().catch(e=>{console.error(e);process.exitCode=1});
