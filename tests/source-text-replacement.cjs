'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs');
const lib=require('../dist/assets/pdf-lib/pdf-lib.min.js');
const special=require('../src/assets/sunrise-special-pdf.js'),n=lib.PDFName.of;
async function makePdf(repeat=false){
 const pdf=await lib.PDFDocument.create();pdf.setTitle('Invoice R24');
 const font=await pdf.embedFont(lib.StandardFonts.Helvetica);
 const page=pdf.addPage([450,600]);
 page.drawText('INVOICE 2026',{x:30,y:560,size:14,font});
 if(repeat)page.drawText('INVOICE 2026',{x:30,y:520,size:14,font});
 pdf.addPage([450,600]).drawText('SECOND PAGE',{x:30,y:560,size:12,font});
 return pdf.save();
}
function content(pdf,index){
 const node=pdf.getPage(index).node,entry=node.get(n('Contents'));
 const resolved=pdf.context.lookup(entry);
 const refs=resolved instanceof lib.PDFArray?
  Array.from({length:resolved.size()},(_,i)=>resolved.get(i)):[entry];
 return refs.map(ref=>{
  const o=pdf.context.lookup(ref);
  return o instanceof lib.PDFRawStream?
   Buffer.from(lib.decodePDFRawStream(o).decode()).toString('latin1'):'';
 }).join('\n');
}
(async()=>{
 const bytes=await makePdf(),copy=Uint8Array.from(bytes);
 const updated=await special.replaceSimpleSourceText({
  bytes,pageNumber:1,original:'INVOICE 2026',replacement:'INVOICE 2027',PDFLib:lib
 });
 assert.deepEqual(bytes,copy,'source bytes untouched');
 const before=await lib.PDFDocument.load(bytes),after=await lib.PDFDocument.load(updated.bytes);
 assert.equal(after.getPageCount(),2);assert.equal(after.getTitle(),'Invoice R24');
 assert.match(content(before,0),/494E564F4943452032303236/i);
 assert.match(content(after,0),/494E564F4943452032303237/i);
 assert.doesNotMatch(content(after,0),/494E564F4943452032303236/i);
 assert.equal(content(after,1),content(before,1));
 for(const opts of [
  {original:'INVOICE 2026',replacement:'INVOICE 2028 MORE'},
  {original:'INVOICE 2026',replacement:'INVOICE 2026'},
  {original:'INVOICE 2026',replacement:'한글 INVOICE'},
  {original:'NOT FOUND!!!',replacement:'REPLACEMENT!'},
 ]){
  await assert.rejects(special.replaceSimpleSourceText({bytes,pageNumber:1,PDFLib:lib,...opts}));
 }
 await assert.rejects(special.replaceSimpleSourceText({
  bytes:await makePdf(true),pageNumber:1,original:'INVOICE 2026',
  replacement:'INVOICE 2027',PDFLib:lib
 }),/여러 곳/);
 const form=await lib.PDFDocument.load(bytes);
 form.getForm().createTextField('a').addToPage(form.getPage(0));
 await assert.rejects(special.replaceSimpleSourceText({
  bytes:await form.save(),pageNumber:1,original:'INVOICE 2026',
  replacement:'INVOICE 2027',PDFLib:lib
 }),/서명·양식/);
 const invalid=await lib.PDFDocument.load(bytes);
 const fonts=invalid.context.lookup(invalid.getPage(0).node.Resources().get(n('Font')));
 invalid.context.lookup(fonts.entries()[0][1]).set(n('Subtype'),n('Type0'));
 await assert.rejects(special.replaceSimpleSourceText({
  bytes:await invalid.save(),pageNumber:1,original:'INVOICE 2026',
  replacement:'INVOICE 2027',PDFLib:lib
 }),/대상이 없습니다/);
 const editor=fs.readFileSync('src/editor/index.html','utf8');
 for(const term of ['case "directSourceText":','function openDirectSourceTextModal','replaceSimpleSourceText(',
  'saveUndoSnapshot(doc,"PDF 원문 텍스트 직접 수정"','개인정보 완전 삭제에는 사용하면 안 됩니다']){
  assert(editor.includes(term),'Missing direct text edit UI: '+term);
 }
 console.log('PASS R24: source text Tj operator rewritten; ambiguous, forms, unsupported fonts rejected, source immutable, UI wired');
})().catch(e=>{console.error(e);process.exitCode=1});
