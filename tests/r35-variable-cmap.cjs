'use strict';
const assert=require('node:assert/strict');
const lib=require('../dist/assets/pdf-lib/pdf-lib.min.js');
const core=require('../src/assets/sunrise-content-editor.js');
const n=lib.PDFName.of;
const encoding='/WMode 0 def 2 begincodespacerange <00> <7F> <8100> <81FF> endcodespacerange '+
  '1 begincidchar <41> 10 endcidchar 1 begincidrange <8101> <8102> 11 endcidrange';
const unicode='3 beginbfchar <41> <0041> <8101> <AC00> <8102> <B098> endbfchar';

async function main(){
  const parsed=core.encodingCMap(encoding);
  assert.equal(parsed.variableLength,true);
  assert.deepEqual(parsed.codeLengths,[1,2]);
  assert.equal(parsed.mapping.get('41'),10);
  assert.equal(parsed.mapping.get('8101'),11);
  assert.equal(parsed.mapping.get('8102'),12);
  assert.equal(core.cmap(unicode,[1,2]).get('8101'),'가');
  assert.throws(()=>core.encodingCMap(
    '2 begincodespacerange <00> <FF> <8100> <81FF> endcodespacerange 1 begincidchar <41> 10 endcidchar'
  ),/모호/);
  assert.throws(()=>core.encodingCMap(
    '1 begincodespacerange <8100> <81FF> endcodespacerange 1 begincidchar <41> 10 endcidchar'
  ),/밖/);
  assert.throws(()=>core.encodingCMap(
    '1 begincodespacerange <8100> <81FF> endcodespacerange 1 begincidrange <8101> <82FF> 10 endcidrange'
  ),/범위|밖/);
  assert.throws(()=>core.cmap('1 beginbfchar <41> <0041> endbfchar',[2]),/길이/);
  assert.equal(core.cmap('1 beginbfrange <8101> <8102> <AC00> endbfrange',[1,2]).get('8102'),'각');
  assert.throws(()=>core.encodingCMap(
    '2 begincodespacerange <00> <7F> <40> <7E> endcodespacerange 1 begincidchar <41> 10 endcidchar'
  ),/중복/);


  const pdf=await lib.PDFDocument.create(),ctx=pdf.context;
  const encRef=ctx.register(ctx.flateStream(encoding));
  const unicodeRef=ctx.register(ctx.flateStream(unicode));
  const descendant=ctx.register(ctx.obj({Type:'Font',Subtype:'CIDFontType2',BaseFont:'Synthetic',
    CIDSystemInfo:{Registry:lib.PDFString.of('Adobe'),Ordering:lib.PDFString.of('Identity'),Supplement:0},
    DW:1000,W:[10,[500,600,700]]}));
  const fontRef=ctx.register(ctx.obj({Type:'Font',Subtype:'Type0',BaseFont:'Synthetic',Encoding:encRef,
    DescendantFonts:[descendant],ToUnicode:unicodeRef}));
  const p=pdf.addPage([400,600]);p.node.set(n('Resources'),ctx.obj({Font:{F1:fontRef}}));
  p.node.set(n('Contents'),ctx.register(ctx.flateStream('BT /F1 12 Tf 1 0 0 1 20 500 Tm <4181018102> Tj ET')));
  const source=await pdf.save(),copy=Uint8Array.from(source);
  const records=await core.listText({bytes:source,pageNumber:1,PDFLib:lib});
  assert.equal(records.length,1);assert.equal(records[0].original,'A가나');
  const result=await core.replaceText({bytes:source,pageNumber:1,targetId:records[0].id,
    original:'A가나',replacement:'나가A',PDFLib:lib});
  assert.deepEqual(source,copy,'original source bytes must remain immutable');
  assert.equal((await core.listText({bytes:result.bytes,pageNumber:1,PDFLib:lib}))[0].original,'나가A');
  const reopened=await lib.PDFDocument.load(result.bytes);
  assert.equal(reopened.getPageCount(),1);
  // A valid space may include codes for which neither the encoding nor ToUnicode has a mapping;
  // they must not be silently decoded or modified.
  const bad=await lib.PDFDocument.load(source),badPage=bad.getPage(0);
  badPage.node.set(n('Contents'),bad.context.register(bad.context.flateStream('BT /F1 12 Tf <8180> Tj ET')));
  assert.deepEqual(await core.listText({bytes:await bad.save(),pageNumber:1,PDFLib:lib}),[]);
  console.log('R35 mixed 1/2-byte CMap: roundtrip, source integrity, boundary ambiguity and unmapped-code guards PASS');
}
main().catch(e=>{console.error(e);process.exitCode=1;});
