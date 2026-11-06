'use strict';
const assert=require('node:assert/strict');
const PDFLib=require('../dist/assets/pdf-lib/pdf-lib.min.js');
const editor=require('../src/assets/sunrise-content-editor.js');
const n=PDFLib.PDFName.of;
const parentEncoding='2 begincodespacerange <00> <7F> <8100> <81FF> endcodespacerange '+
  '1 begincidchar <41> 10 endcidchar 1 begincidrange <8101> <8102> 11 endcidrange';
const childEncoding='1 begincidchar <8101> 15 endcidchar';
const parentUnicode='3 beginbfchar <41> <0041> <8101> <AC00> <8102> <B098> endbfchar';
const childUnicode='1 beginbfchar <8101> <B2E4> endbfchar';
async function documentWithInheritance(){
 const pdf=await PDFLib.PDFDocument.create(),ctx=pdf.context;
 const encodingBase=ctx.register(ctx.flateStream(parentEncoding));
 const encodingChild=ctx.flateStream(childEncoding);encodingChild.dict.set(n('UseCMap'),encodingBase);
 const encodingRef=ctx.register(encodingChild);
 const unicodeBase=ctx.register(ctx.flateStream(parentUnicode));
 const unicodeChild=ctx.flateStream(childUnicode);unicodeChild.dict.set(n('UseCMap'),unicodeBase);
 const unicodeRef=ctx.register(unicodeChild);
 const cid=ctx.register(ctx.obj({Type:'Font',Subtype:'CIDFontType2',BaseFont:'Source',
    CIDSystemInfo:{Registry:PDFLib.PDFString.of('Adobe'),Ordering:PDFLib.PDFString.of('Identity'),Supplement:0},
    DW:500,W:[10,[500,500,500,500,500,500,500]]}));
 const font=ctx.register(ctx.obj({Type:'Font',Subtype:'Type0',BaseFont:'Source',Encoding:encodingRef,
   DescendantFonts:[cid],ToUnicode:unicodeRef}));
 const page=pdf.addPage([300,500]);page.node.set(n('Resources'),ctx.obj({Font:{F1:font}}));
 page.node.set(n('Contents'),ctx.register(ctx.flateStream('BT /F1 12 Tf <4181018102> Tj ET')));
 return {source:await pdf.save(),encodingChild,encodingRef,unicodeChild,unicodeRef};
}
async function main(){
 const b=editor.encodingCMap(parentEncoding);
 const m=editor.encodingCMap(childEncoding,b);
 assert.equal(m.mapping.get('8101'),15);assert.equal(m.mapping.get('8102'),12);
 assert.equal(m.mapping.get('41'),10);assert.deepEqual(m.codeLengths,[1,2]);
 const u=editor.cmap(childUnicode,[1,2],editor.cmap(parentUnicode,[1,2]));
 assert.equal(u.get('8101'),'다');assert.equal(u.get('8102'),'나');
 assert.throws(()=>editor.encodingCMap('1 begincidchar <8101> 19 endcidchar 1 begincidchar <8101> 20 endcidchar',b),/중복/);
 const {source}=await documentWithInheritance(),copy=Uint8Array.from(source);
 const list=await editor.listText({bytes:source,pageNumber:1,PDFLib});
 assert.equal(list.length,1);assert.equal(list[0].original,'A다나');
 const changed=await editor.replaceText({bytes:source,pageNumber:1,PDFLib,targetId:list[0].id,original:'A다나',replacement:'나다A'});
 assert.deepEqual(source,copy);
 assert.equal((await editor.listText({bytes:changed.bytes,pageNumber:1,PDFLib}))[0].original,'나다A');
 // Reject malicious cross-references that form a stream-parent cycle.
 const bad=await PDFLib.PDFDocument.load(source),fontObj=bad.context.lookup(bad.context.lookup(bad.getPage(0).node.Resources().get(n('Font'))).get(n('F1')));
 const encoding=bad.context.lookup(fontObj.get(n('Encoding')));encoding.dict.set(n('UseCMap'),fontObj.get(n('Encoding')));
 assert.deepEqual(await editor.listText({bytes:await bad.save(),pageNumber:1,PDFLib}),[]);
 console.log('PASS: inherited encoding + ToUnicode CMap, override precedence, source invariant, cycle rejection');
}
main().catch(e=>{console.error(e);process.exitCode=1});
