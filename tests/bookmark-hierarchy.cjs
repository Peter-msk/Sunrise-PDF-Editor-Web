'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const lib=require('../dist/assets/pdf-lib/pdf-lib.min.js');
const helper=require('../src/assets/sunrise-auto-bookmarks.js');
const n=lib.PDFName.of;
function item(text,y,size=16){return {str:text,transform:[size,0,0,size,20,y],height:size};}
const page=(pageIndex,title)=>({pageIndex,items:[
 item(title,730,18),item('일반 본문 설명입니다.',480,10),item('추가 내용입니다.',450,10)
]});
assert.equal(helper.inferLevel('제1장 사업 개요'),0);
assert.equal(helper.inferLevel('제2절 조사 범위'),1);
assert.equal(helper.inferLevel('제3항 세부 자료'),2);
assert.equal(helper.inferLevel('제4목 사례'),3);
assert.equal(helper.inferLevel('1. 보고서'),0);
assert.equal(helper.inferLevel('1.1 조사'),1);
assert.equal(helper.inferLevel('1.2.3 분석'),2);
assert.equal(helper.inferLevel('1.2.3.4 결론'),3);
assert.equal(helper.inferLevel('2026년 종합 보고서'),0);
const sections=helper.suggestBookmarks([
 page(0,'제1장 사업 개요'),page(1,'1.1 대상지'),page(2,'1.1.1 조사 범위'),
 page(3,'1.2 조사 결과'),page(4,'제2장 결론')]);
assert.deepEqual(sections.map(x=>x.level),[0,1,2,1,0]);
assert.deepEqual(sections.map(x=>x.page),[0,1,2,3,4]);
assert.deepEqual(helper.normalizeLevels([{level:2},{level:3},{level:3},{level:0}]).map(x=>x.level),[0,1,2,0]);
assert.equal(helper.changeLevel([{level:0},{level:0},{level:0}],0,1),null);
assert.deepEqual(helper.changeLevel([{level:0},{level:0},{level:0}],1,1).map(x=>x.level),[0,1,0]);
assert.deepEqual(helper.changeLevel([{level:0},{level:1},{level:2}],1,-1).map(x=>x.level),[0,0,1]);
const nested=[{title:'A',level:0},{title:'A.1',level:1},{title:'A.1.1',level:2},
 {title:'B',level:0},{title:'B.1',level:1},{title:'C',level:0}];
const deletion=helper.removeSubtree(nested,3);
assert.deepEqual(deletion.bookmarks.map(x=>x.title),['A','A.1','A.1.1','C']);
assert.equal(deletion.removedCount,2);
assert.deepEqual(helper.removeSubtree(nested,0).bookmarks.map(x=>x.title),['B','B.1','C']);
assert.throws(()=>helper.removeSubtree(nested,99),/위치/);

const editor=fs.readFileSync('src/editor/index.html','utf8');
assert.match(editor,/data-bm-indent/);
assert.match(editor,/data-bm-outdent/);
assert.match(editor,/SunriseAutoBookmarks\.normalizeLevels\(/);
assert.match(editor,/level: item\.level/);
const start=editor.indexOf('    function appendPdfBookmarks(');
const end=editor.indexOf('    async function compileDocumentWithOverlays(',start);
assert(start>=0&&end>start);
const context=vm.createContext({window:{PDFLib:lib},console});
vm.runInContext(editor.slice(start,end),context);
function append(pdf,items){context.pdf=pdf;context.items=items;vm.runInContext('appendPdfBookmarks(pdf,items)',context);}
function obj(pdf,ref){return pdf.context.lookup(ref);}
function title(item){return item.lookup(n('Title')).decodeText();}
(async()=>{
 const pdf=await lib.PDFDocument.create();
 for(let i=0;i<5;i++)pdf.addPage([300,420]);
 append(pdf,[{title:'기존 북마크',page:0}]);
 const root=pdf.catalog.lookup(n('Outlines'));
 const previousFirst=root.get(n('First')).toString();
 append(pdf,sections);
 const saved=await pdf.save();
 const reopened=await lib.PDFDocument.load(saved);
 const r=reopened.catalog.lookup(n('Outlines'));
 assert.equal(r.lookup(n('Count')).asNumber(),6);
 assert.equal(r.get(n('First')).toString(),previousFirst,'previous original outline must remain first');
 const old=obj(reopened,r.get(n('First')));
 assert.equal(title(old),'기존 북마크');
 const chapter=obj(reopened,old.get(n('Next')));
 assert.equal(title(chapter),'제1장 사업 개요');
 assert.equal(chapter.get(n('Prev')).toString(),r.get(n('First')).toString());
 assert.equal(chapter.lookup(n('Count')).asNumber(),3);
 const firstSection=obj(reopened,chapter.get(n('First')));
 assert.equal(title(firstSection),'1.1 대상지');
 assert.equal(firstSection.lookup(n('Count')).asNumber(),1);
 assert.equal(firstSection.get(n('Parent')).toString(),old.get(n('Next')).toString());
 const subsection=obj(reopened,firstSection.get(n('First')));
 assert.equal(title(subsection),'1.1.1 조사 범위');
 const secondSection=obj(reopened,firstSection.get(n('Next')));
 assert.equal(title(secondSection),'1.2 조사 결과');
 assert.equal(secondSection.get(n('Prev')).toString(),chapter.get(n('First')).toString());
 assert.equal(chapter.get(n('Last')).toString(),firstSection.get(n('Next')).toString());
 const secondChapter=obj(reopened,chapter.get(n('Next')));
 assert.equal(title(secondChapter),'제2장 결론');
 assert.equal(r.get(n('Last')).toString(),chapter.get(n('Next')).toString());
 const pages=reopened.getPages();
 const destination=secondSection.lookup(n('Dest'));
 assert.equal(destination.get(0).toString(),pages[3].ref.toString());
 const invalid=await lib.PDFDocument.create();invalid.addPage();
 assert.throws(()=>append(invalid,[{title:'잘못된 단계',page:0,level:4}]),/단계/);
 assert.throws(()=>append(invalid,[{title:'잘못된 페이지',page:1,level:0}]),/페이지/);
 const orphan=await lib.PDFDocument.create();orphan.addPage();orphan.addPage();
 append(orphan,[{title:'선행 부모 누락',page:0,level:2},{title:'하위',page:1,level:3}]);
 const safe=await lib.PDFDocument.load(await orphan.save());
 const sr=safe.catalog.lookup(n('Outlines'));
 assert.equal(sr.lookup(n('Count')).asNumber(),2);
 assert.equal(obj(safe,sr.get(n('First'))).lookup(n('Count')).asNumber(),1);
 console.log('PASS: inferred chapter hierarchy, manual indent/outdent, nested PDF outline persistence, legacy outline preservation, safe normalization');
})().catch(e=>{console.error(e);process.exitCode=1;});
