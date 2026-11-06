'use strict';
// R32-DEV2: examples for a later authorized test run. Not run during coding.
const assert=require('node:assert/strict');
const office=require('../src/assets/sunrise-office-export.js');
function xmlInsideStoredZip(zip,entry){
 const data=Buffer.from(zip),name=Buffer.from(entry,'utf8');let offset=0;
 while(offset+30<=data.length&&data.readUInt32LE(offset)===0x04034b50){
  const size=data.readUInt32LE(offset+18),len=data.readUInt16LE(offset+26),extra=data.readUInt16LE(offset+28);
  const head=offset+30,fileName=data.subarray(head,head+len);
  const dataStart=head+len+extra;
  if(fileName.equals(name))return data.subarray(dataStart,dataStart+size).toString('utf8');
  offset=dataStart+size;
 }
 throw Error('Missing Office ZIP part: '+entry);
}
const raw=[
 {width:595,height:842,rotation:0,styles:{},items:[{str:'제목',width:48,fontName:'Title',transform:[20,0,0,20,72,766],dir:'ltr'}]},
 {width:842,height:595,rotation:0,styles:{},items:[{str:'LANDSCAPE',width:100,fontName:'Body',transform:[14,0,0,14,80,510],dir:'ltr'}]},
];
const doc=xmlInsideStoredZip(office.docxLayout(raw),'word/document.xml');
assert.match(doc,/<w:pgSz w:w="11900" w:h="16840"\/>/);
assert.match(doc,/<w:pgSz w:w="16840" w:h="11900" w:orient="landscape"\/>/);
assert.equal((doc.match(/<w:sectPr>/g)||[]).length,2);
assert.match(doc,/<w:pgMar w:top="\d+" w:right="\d+" w:bottom="\d+" w:left="\d+"/);
assert.match(doc,/<w:spacing w:before="\d+" w:after="0" w:line="276" w:lineRule="auto"\/>/);
assert.throws(()=>office.docxLayout([{width:100,height:600,rotation:0,styles:{},items:[]}]),/용지 크기/);
console.log('DEV2 Word section geometry examples: PASS');
