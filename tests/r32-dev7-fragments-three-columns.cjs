// R32-DEV7 change-specific regression cases. NOT EXECUTED during source authoring.
'use strict';
const assert=require('node:assert/strict');
const redaction=require('../src/assets/sunrise-special-pdf.js');
const office=require('../src/assets/sunrise-office-export.js');

function item(str,x,y,width=40){
 return {str,width,height:12,transform:[12,0,0,12,x,y],dir:'ltr'};
}
{
 const page={pageNumber:1,width:595,height:842,rotation:0,items:[
  item('900101',50,700,44),item('-',94,700,5),item('1234567',99,700,54)
 ]};
 const plan=[{pageNumber:1,rectangles:[{x:40,y:120,width:140,height:40}]}];
 const review=redaction.reviewSensitiveTextCandidates({pages:[page],plan});
 assert.equal(review.fragmentedCandidates,1,'adjacent PDF.js fragments should be joined');
 assert.equal(review.fragmentedOutside,0,'fully masked fragment group should be covered');
 assert.equal(review.covered,1);
 const unsafe=redaction.reviewSensitiveTextCandidates({pages:[page],plan:[]});
 assert.equal(unsafe.fragmentedOutside,1,'unmasked identifier must be surfaced');
 assert.deepEqual(unsafe.outsidePages,[1]);
 assert.equal(unsafe.unmasked[0].fragmented,true);
 assert.equal(Object.values(unsafe).flat().some(x=>typeof x==='string'&&x.includes('900101')),false,
  'source PII must not appear in results');
}
{
 const far={pageNumber:1,width:595,height:842,rotation:0,items:[
  item('900101',50,700,44),item('-',190,700,5),item('1234567',199,700,54)
 ]};
 assert.equal(redaction.reviewSensitiveTextCandidates({pages:[far],plan:[]}).fragmentedCandidates,0,
  'unrelated distant text items must not be joined');
}
{
 const items=[];
 for(const x of [20,220,420])for(const [i,y] of [720,698,676].entries())
  items.push(item('문단'+i,x,y,65));
 const docx=office.docxThreeColumn([{width:600,height:842,rotation:0,items,styles:{}}]);
 assert.ok(docx instanceof Uint8Array);
 assert.equal(docx[0],0x50);assert.equal(docx[1],0x4b);
 assert.throws(()=>office.docxThreeColumn([{width:600,height:842,rotation:0,
  items:[...items,item('단 경계를 넘는 제목',170,640,180)],styles:{}}]),/단 경계/);
}
console.log('R32-DEV7 regression cases PASS');
