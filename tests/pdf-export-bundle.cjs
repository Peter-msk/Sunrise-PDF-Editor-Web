'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const report=require('../src/assets/sunrise-pdf-quality-report.js');
const editor=fs.readFileSync('src/editor/index.html','utf8');
const build=fs.readFileSync('scripts/build-release.cjs','utf8');
const fixture={
 status:'review',bytes:1034,pageCount:8,scannedPages:4,
 orientation:{portrait:5,landscape:3,square:0},fontResources:3,formFields:1,
 emptyRequired:1,blankCandidates:1,errors:0,reviews:2,
 limitations:'OCR/전자서명 검증 안 함',
 issues:[
  {severity:'review',code:'required-field',message:'=SUM(A1:A3)',page:1},
  {severity:'review',code:'blank-candidate',message:'  +1+2',page:4}
 ]
};
const csv=report.createCsv(fixture);
assert(csv.startsWith('\ufeff'));
assert(csv.includes("'=SUM(A1:A3)"),'dangerous spreadsheet values must be neutralized');
assert(csv.includes("'  +1+2"),'formula syntax after whitespace must be neutralized');
assert(csv.includes('"검사","4","확인 필요","blank-candidate"'));
const json=JSON.parse(report.createJson(fixture));
assert.equal(json.format,'Sunrise PDF Preflight 1');
assert.equal(json.pageCount,8);
assert.equal(json.issues[0].message,'=SUM(A1:A3)');
assert(!JSON.stringify(json).includes('sourceName'),'never add private source path/name');
assert.throws(()=>report.createCsv({pageCount:1,issues:[],errors:-1}),/올바르지/);
assert.match(editor,/id="savedQualityCsvBtn"/);
assert.match(editor,/id="savedQualityJsonBtn"/);
assert.match(editor,/SunrisePdfQualityReport\.createCsv/);
assert.match(editor,/SunrisePdfQualityReport\.createJson/);
assert(build.includes("'sunrise-pdf-quality-report.js'"));
const rangeStart=editor.indexOf('    function parseRangeInput(');
const rangeEnd=editor.indexOf('    function applyPageSelection(',rangeStart);
const splitStart=editor.indexOf('    function planDocumentSplit(');
const splitEnd=editor.indexOf('    async function splitDocumentPages(',splitStart);
assert(rangeStart>=0&&rangeEnd>rangeStart&&splitStart>=0&&splitEnd>splitStart);
const ctx=vm.createContext({});
vm.runInContext(editor.slice(rangeStart,rangeEnd)+editor.slice(splitStart,splitEnd),ctx);
function plan(text,pages,chunkSize){
 ctx.text=text;ctx.pages=pages;ctx.chunkSize=chunkSize;
 return vm.runInContext('planDocumentSplit(text,pages,chunkSize)',ctx);
}
const groups=plan('4, 1-2, 4, 8',8,2);
assert.deepEqual(JSON.parse(JSON.stringify(groups)),[[0,1],[3,7]]);
assert.equal(groups.length,2);
assert.deepEqual(JSON.parse(JSON.stringify(plan('1-10',10,3))),[[0,1,2],[3,4,5],[6,7,8],[9]]);
assert.throws(()=>plan('1-100',100,1),/50개/);
assert.throws(()=>plan('3-1',8,0),/1~100/);
assert.throws(()=>plan('not-a-page',8,5),/범위/);
assert.match(editor,/splitReadyResults/);
assert.match(editor,/verifyPdfPageGeometry\(part,reopened,"분할"\)/);
assert.match(editor,/파일 크기에 고정된 용량 제한은 없습니다/);
assert.match(editor,/이 PDF 생성·저장/);
console.log('PASS: CSV formula safety, local JSON preflight, bounded split planning, UI and release build wiring');
