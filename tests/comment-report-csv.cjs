'use strict';
const assert=require('node:assert/strict');
const mod=require('../src/assets/sunrise-comment-report.js');
const txt=mod.createCsv(
 [{pageIndex:0,type:'Note',text:'=HYPERLINK("a","b")',x:30,y:40}],
 [{pageIndex:3,subtype:'Highlight',text:'@SUM(1+2)',index:0},
  {pageIndex:5,subtype:'Text',text:'한글 내용\n후속 줄',index:1}]);
assert(txt.startsWith('\uFEFF'));
assert(txt.includes('"Sunrise 삽입"'));
assert(txt.includes('"원본 PDF"'));
assert(txt.includes('"\'=HYPERLINK(""a"",""b"")"'));
assert(txt.includes('"\'@SUM(1+2)"'));
assert(txt.includes('한글 내용\n후속 줄'));
assert.equal(mod.cell('   +SUM(1,2)'),'"\'   +SUM(1,2)"');
assert.equal(mod.cell('정상 메모'),'"정상 메모"');
assert.throws(()=>mod.createCsv([], [{pageIndex:0,subtype:'Widget',text:''}]),/원본 PDF 주석/);
assert.throws(()=>mod.createCsv([{pageIndex:-2,type:'Note'}],[]),/삽입 항목/);
assert.throws(()=>mod.createCsv(new Array(5001).fill({pageIndex:0,type:'Note'}),[]),/너무 많/);
console.log('PASS: local review report Unicode, original annotation inclusion, formula neutralization and bounded count');
