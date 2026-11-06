// Source-only regression; not executed at DEV6 authoring.
const assert=require('node:assert/strict');
const office=require('../src/assets/sunrise-office-export.js');
const items=[];
for(let i=0;i<4;i++){
 items.push({str:'LEFT'+i,width:90,height:12,transform:[12,0,0,12,52,720-i*22]});
 items.push({str:'RIGHT'+i,width:85,height:12,transform:[12,0,0,12,345,720-i*22]});
}
const page={items,width:595,height:842,rotation:0,styles:{}};
const word=office.docxTwoColumn([page]);
const bytes=Buffer.from(word);
assert(bytes.includes(Buffer.from('<w:tbl>')));
assert(bytes.includes(Buffer.from('LEFT0')));
assert(bytes.includes(Buffer.from('RIGHT0')));
const ambiguous={...page,items:[...items,{str:'WIDE',width:70,height:12,transform:[12,0,0,12,275,600]}]};
assert.throws(()=>office.docxTwoColumn([ambiguous]),/단 경계/);
console.log('DEV6 Word two-column contract PASS');
