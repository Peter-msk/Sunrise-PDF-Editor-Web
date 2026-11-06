// Source-only regression; not executed at DEV6 authoring.
const assert=require('node:assert/strict');
const special=require('../src/assets/sunrise-special-pdf.js');
const page={pageNumber:1,width:595,height:842,rotation:0,items:[
 {str:'support@sunrise.kr',transform:[12,0,0,12,100,740],height:12,width:140}
]};
const outside=special.reviewSensitiveTextCandidates({pages:[page],plan:[{pageNumber:1,rectangles:[{x:250,y:85,width:120,height:30}]}]});
assert.equal(outside.candidates,1);
assert.equal(outside.outside,1);
assert.deepEqual(outside.outsidePages,[1]);
const covered=special.reviewSensitiveTextCandidates({pages:[page],plan:[{pageNumber:1,rectangles:[{x:90,y:80,width:180,height:45}]}]});
assert.equal(covered.outside,0);
assert.equal(covered.covered,1);
const imageOnly=special.reviewSensitiveTextCandidates({pages:[{...page,items:[]}],plan:[]});
assert.equal(imageOnly.imageOnlyPages,1);
console.log('DEV6 text-layer sensitive candidate contract PASS');
