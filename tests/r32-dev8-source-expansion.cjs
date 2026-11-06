// DEV8 change-specific regression scenarios. Authored only; NOT executed.
'use strict';
const assert = require('node:assert/strict');
const office = require('../src/assets/sunrise-office-export.js');
const special = require('../src/assets/sunrise-special-pdf.js');
const PDFLib = require('../dist/assets/pdf-lib/pdf-lib.min.js');

function textItem(str,x,y,w=50){
  return {str,width:w,height:12,transform:[12,0,0,12,x,y],dir:'ltr'};
}
async function checkTJEdit(){
  const pdf=await PDFLib.PDFDocument.create();
  const font=await pdf.embedFont(PDFLib.StandardFonts.Helvetica);
  pdf.addPage([595,842]).drawText('HELLO WORLD',{x:40,y:740,font,size:14});
  const bytes=await pdf.save(), source=await PDFLib.PDFDocument.load(bytes);
  const page=source.getPage(0),n=PDFLib.PDFName.of;
  const raw=page.node.get(n('Contents'));
  const ref=raw instanceof PDFLib.PDFArray ? raw.get(0) : raw;
  const stream=source.context.lookup(ref);
  const original=Buffer.from(PDFLib.decodePDFRawStream(stream).decode()).toString('latin1');
  const target='<48454C4C4F20574F524C44> Tj';
  assert.ok(original.includes(target),'test fixture expected Helvetica hex Tj');
  const replacement='[<48454C4C4F> 30 <20574F524C44>] TJ';
  const modified=Buffer.from(original.replace(target,replacement),'latin1');
  const dict=stream.dict.clone();dict.delete(n('Filter'));dict.delete(n('DecodeParms'));
  dict.set(n('Length'),PDFLib.PDFNumber.of(modified.length));
  source.context.assign(ref,PDFLib.PDFRawStream.of(dict,new Uint8Array(modified)));
  const segmented=await source.save();
  const before=Buffer.from(segmented);
  const result=await special.replaceSimpleSourceText({
    bytes:segmented,pageNumber:1,original:'HELLO WORLD',replacement:'WORLD HELLO',PDFLib
  });
  assert.deepEqual(Buffer.from(segmented),before,'input PDF must be immutable');
  const output=await PDFLib.PDFDocument.load(result.bytes);
  const outRaw=output.getPage(0).node.get(n('Contents'));
  const outRef=outRaw instanceof PDFLib.PDFArray ? outRaw.get(0) : outRaw;
  const outputStream=output.context.lookup(outRef);
  const out=Buffer.from(PDFLib.decodePDFRawStream(outputStream).decode()).toString('latin1');
  assert.match(out,/\[<574F524C44> 30 <2048454C4C4F>\] TJ/);
  assert.equal(output.getPageCount(),1);
  await assert.rejects(special.replaceSimpleSourceText({
    bytes:segmented,pageNumber:1,original:'HELLO WORLD',replacement:'한글',PDFLib
  }),/Type1|WinAnsi|입력/);
}
async function main(){
  const good={pageNumber:1,width:595,height:842,items:[textItem('4111 1111 1111 1111',40,740,165)]};
  const bad={pageNumber:1,width:595,height:842,items:[textItem('4111 1111 1111 1112',40,740,165)]};
  assert.equal(special.reviewSensitiveTextCandidates({pages:[good],plan:[]}).outside,1);
  assert.equal(special.reviewSensitiveTextCandidates({pages:[bad],plan:[]}).outside,0);
  const pages=[];
  for(const cols of [1,2,3]){
    const xs=cols===1?[40]:cols===2?[40,345]:[25,225,425];
    const items=[];
    for(const x of xs)for(let i=0;i<6;i++)items.push(textItem('문단'+i,x,735-i*24,54));
    pages.push({width:600,height:842,items,styles:{}});
  }
  const word=office.docxAutoColumns(pages);
  assert.equal(word[0],0x50);assert.equal(word[1],0x4b);
  const excel=office.xlsxPerPage(['첫 쪽\n내용','=FORMULA(1)\n둘째 쪽']);
  assert.ok(Buffer.from(excel).includes(Buffer.from('sheet2.xml')));
  assert.ok(Buffer.from(excel).includes(Buffer.from('t="inlineStr"')),'formula must be literal');
  assert.throws(()=>office.xlsxPerPage(Array(51).fill('텍스트')),/50/);
  await checkTJEdit();
  console.log('DEV8 changed-scope regressions PASS');
}
main().catch(error=>{console.error(error);process.exitCode=1});
