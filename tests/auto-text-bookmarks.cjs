const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {chooseHeading,suggestBookmarks,getLines}=require('../src/assets/sunrise-auto-bookmarks.js');
const item=(text,y,size=11,x=20)=>({str:text,transform:[size,0,0,size,x,y],height:size});
const page=(index,headline,{runningHeader=false}={})=>({
 pageIndex:index,
 items:[
  ...(runningHeader?[item('SUNRISE GROUP OFFICIAL',790,18)]:[]),
  ...(headline?[item(headline,743,19)]:[]),
  item('이 문서는 일반 본문이며 북마크 제목이 아닙니다.',480,10),
  item('본문은 해당 자료를 설명합니다.',450,10),
  item(String(index+1),32,10)
 ]
});
assert.deepEqual(getLines([{str:'',transform:[12,0,0,12,20,760]}]),[]);
assert.equal(chooseHeading([item('이 문서는 문장으로 구성된 본문입니다.',450,10),item('문서 내역',430,10)]),null);
assert.equal(chooseHeading([item('제1장 사업 개요',760,19),item('본문 설명',600,10)]),'제1장 사업 개요');
const docs=[
 page(0,'2026년 사업보고서'),
 page(1,'제1장 사업 개요',{runningHeader:true}),
 page(2,'2. 현황 분석',{runningHeader:true}),
 {pageIndex:3,items:[]}
];
const suggestions=suggestBookmarks(docs);
assert.deepEqual(suggestions.map(x=>x.page),[0,1,2]);
assert.deepEqual(suggestions.map(x=>x.title),['2026년 사업보고서','제1장 사업 개요','2. 현황 분석']);
assert(!suggestions.some(x=>x.title==='SUNRISE GROUP OFFICIAL'));
assert.equal(suggestBookmarks(docs,1).length,1);
assert.deepEqual(suggestBookmarks([{pageIndex:0,items:[]}]),[],'scanned-only pages must not produce OCR guesses');
const scripts=fs.readFileSync('scripts/build-release.cjs','utf8');
const editor=fs.readFileSync('src/editor/index.html','utf8');
assert(scripts.includes("'sunrise-auto-bookmarks.js'"),'release build must include helper');
assert(editor.includes('/assets/sunrise-auto-bookmarks.js'),'editor must load helper');
assert(editor.includes('await createTextLayerBookmarks(doc)'),'ribbon must invoke reviewed bookmark generation');
assert(editor.includes('if (!window.confirm('),'bookmark proposals must require human confirmation');
assert(editor.includes('if (!valid())'),'stale source/document must be discarded');
assert(!editor.includes('문자를 이미지에서 인식'),'OCR not introduced');
console.log('PASS: text-only heading bookmarks, repeated running header suppression, page targets, zero OCR, preview, stale document guard');
