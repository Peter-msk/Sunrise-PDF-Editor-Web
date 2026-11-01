'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const pdfLib=require('../dist/assets/pdf-lib/pdf-lib.min.js');
const editState=require('../src/assets/sunrise-edit-state.js');
const src=fs.readFileSync('src/editor/index.html','utf8');
const a=src.indexOf('    function validateEditableTableCells(');
const b=src.indexOf('    function openInsertTableModal(',a);
assert(a>=0&&b>a,'overlay input validators and shape insertion must exist');
const ctx=vm.createContext({});
vm.runInContext(src.slice(a,b),ctx);
const call=(expression)=>vm.runInContext(expression,ctx);
const json=x=>JSON.parse(JSON.stringify(x));
assert.deepEqual(json(call('parseEditableTableText("담당\\t검토\\t승인\\n김\\t박\\t이")')),[
 ['담당','검토','승인'],['김','박','이']]);
assert.equal(call('validateOverlayDimension("0.55",.1,1,"opacity")'),.55,'decimal opacity support');
for(const input of ['한열\n한열','a\tb\nc','a\tb\nc\td',
 'a\tb\nc\td\tvery-long-extra','a\tb\nc\t'+('x'.repeat(81))]){
 assert.throws(()=>{ctx.input=input;vm.runInContext('parseEditableTableText(input)',ctx);},/셀|행|열|표/);
}
assert.throws(()=>call('validateOverlayDimension("",20,800,"너비")'),/범위/);
assert.throws(()=>call('validateOverlayDimension("-10",20,800,"너비")'),/범위/);
assert.throws(()=>call('validateOverlayDimension("Infinity",20,800,"너비")'),/범위/);
assert.match(src,/case "insertShape"/);
assert.match(src,/data-ov-edit/);
assert.match(src,/editTableCellsInput/);
assert.match(src,/editShapeKindInput/);
assert.match(src,/editItemBgInput/);
assert.match(src,/editItemOpacityInput/);
assert.match(src,/node\.setAttribute\("stroke-width"/);
assert.match(src,/octx\.ellipse\(/);
assert.match(src,/if \(item\.type === "Shape"\) \{\s+\/\/ Shape geometry/);
async function roundtrip(){
 const pdf=await pdfLib.PDFDocument.create();const p=pdf.addPage([500,650]);
 const stream=p.getContentStream(false);
 const original=[{
  id:'ov_shape',pageIndex:0,type:'Shape',shapeKind:'ellipse',
  text:'',x:90,y:110,width:180,height:90,color:'#123456',bgColor:'#FFFFFF',
  strokeWidth:4,opacity:.7
 },{
  id:'ov_table',pageIndex:0,type:'Table',text:'표 (항목/내용)',x:100,y:250,
  width:260,height:94,cells:[['항목','내용'],['수질','기준 충족'],['대기','적합']],
  color:'#1B2631',bgColor:'#FFFFFF',opacity:.98
 },{
  id:'ov_note',pageIndex:0,type:'Note',text:'수정된 의견',x:60,y:360,
  width:240,height:80,fontSize:12,color:'#5C3B09',bgColor:'#FFF6D6',opacity:.55
 }];
 editState.record(pdf,new Map([[0,{stream,ref:p.contentStreamRef}]]),original,pdfLib);
 const saved=await pdf.save();
 const restored=await editState.restore(new Uint8Array(saved),pdfLib);
 assert.equal(restored.warning,false,'shape + table + annotation must restore intact');
 assert.deepEqual(json(restored.overlays),original);
 const reopened=await pdfLib.PDFDocument.load(restored.bytes);
 assert.equal(reopened.getPageCount(),1);
 // Restored contents must remain a legal PDF even after removing the editor's content stream.
 const bad=await pdfLib.PDFDocument.create();const badPage=bad.addPage([500,650]);
 const badStream=badPage.getContentStream(false);
 assert.throws(()=>editState.record(bad,new Map([[0,{stream:badStream,ref:badPage.contentStreamRef}]]),
  [{...original[0],strokeWidth:400}],pdfLib),/삽입 항목/);
 console.log('PASS: table rectangular edits, shape UI/save hooks, review panel, safe PDF overlay metadata roundtrip incl. colors/opacity');
}
roundtrip().catch(e=>{console.error(e);process.exitCode=1});
