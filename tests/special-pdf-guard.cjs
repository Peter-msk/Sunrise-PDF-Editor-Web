'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const lib=require('../dist/assets/pdf-lib/pdf-lib.min.js');
const special=require('../src/assets/sunrise-special-pdf.js');
const editState=require('../src/assets/sunrise-edit-state.js');
const editor=fs.readFileSync('src/editor/index.html','utf8');
const build=fs.readFileSync('scripts/build-release.cjs','utf8');
const fixture=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFUlEQVR4nAXBAQEAAACAEP9PF0JQGR7vBPykAXTzAAAAAElFTkSuQmCC','base64');
const view={width:300,height:400,convertToViewportPoint:(x,y)=>[x,400-y]};
assert.deepEqual(special.correctionCandidate({str:'Original',dir:'ltr',transform:[12,0,0,12,50,300],width:65},view),{
 original:'Original',x:48,y:85,width:71,height:21,fontSize:12
});
assert.equal(special.correctionCandidate({str:'Rotated',dir:'ltr',transform:[0,12,-12,0,20,200],width:50},view),null);
assert.equal(special.correctionCandidate({str:'',transform:[12,0,0,12,50,300],width:60},view),null);
assert.equal(special.correctionCandidate({str:'Edge',transform:[12,0,0,12,290,300],width:30},view),null);
assert.deepEqual(special.validateMaskRect({x:10,y:20,width:50,height:40},300,400),{x:10,y:20,width:50,height:40});
for(const rect of [{x:290,y:10,width:50,height:40},{x:10,y:-1,width:30,height:50},
 {x:20,y:20,width:2,height:10},{x:0,y:0,width:'NaN',height:10}]){
 assert.throws(()=>special.validateMaskRect(rect,300,400),/마스킹|좌표/);
}
assert.throws(()=>special.checkRasterSize(5000,5000),/크기/);
const marks=[];
const ctx={
 fillStyle:'',
 fillRect(...coords){marks.push({color:this.fillStyle,coords})},
 getImageData(x,y){
  const covered=marks.some(m=>m.color==='#000000'&&x>=m.coords[0]&&y>=m.coords[1]&&
    x<m.coords[0]+m.coords[2]&&y<m.coords[1]+m.coords[3]);
  return {data:Uint8ClampedArray.from(covered?[0,0,0,255]:[255,255,255,255])};
 }
};
const makeCanvas=()=>({
 width:0,height:0,getContext:()=>ctx,
 toBlob:callback=>callback({size:fixture.byteLength,arrayBuffer:async()=>Uint8Array.from(fixture).buffer})
});
const page={getViewport:({scale})=>({width:300*scale,height:400*scale}),
 render:({canvasContext,viewport})=>{assert.equal(canvasContext,ctx);assert.equal(viewport.width,600);return {promise:Promise.resolve()};}};
const reader={numPages:1,getPage:async number=>{assert.equal(number,1);return page;}};
(async()=>{
 const out=await special.exportMaskedPage({reader,pageNumber:1,rectangle:{x:10,y:20,width:50,height:40},PDFLib:lib,makeCanvas});
 assert.equal(out.pages,1);
 assert.equal(marks.length,2);
 assert.equal(marks[1].color,'#000000');
 assert.deepEqual(marks[1].coords,[20,40,100,80]);
 const pdf=await lib.PDFDocument.load(out.bytes);
 assert.equal(pdf.getPageCount(),1);
 assert.equal(pdf.getPage(0).getWidth(),300);
 assert.equal(pdf.getPage(0).getHeight(),400);
 const N=lib.PDFName.of;
 for(const key of ['AcroForm','Outlines','Names','Perms','SunriseWebEdits'])
  assert.equal(pdf.catalog.get(N(key)),undefined,'fresh raster PDF should not copy '+key);
 const invalidCtx={...ctx,getImageData:()=>({data:Uint8ClampedArray.from([255,255,255,255])})};
 await assert.rejects(special.exportMaskedPage({reader,pageNumber:1,rectangle:{x:10,y:20,width:50,height:40},
  PDFLib:lib,makeCanvas:()=>({width:0,height:0,getContext:()=>invalidCtx,
   toBlob:callback=>callback({size:fixture.byteLength,arrayBuffer:async()=>Uint8Array.from(fixture).buffer})})}),
  /마스크가 불투명한 검은색/);
 await assert.rejects(special.exportMaskedPage({reader,pageNumber:1,rectangle:{x:10,y:20,width:50,height:40},
  PDFLib:lib,makeCanvas,cancelled:()=>true}),/취소/);
 const doc=await lib.PDFDocument.create();const p=doc.addPage([300,400]),stream=p.getContentStream(false);
 const overlay=[
  {id:'correction',type:'Correction',text:'Replacement',pageIndex:0,x:50,y:50,
   width:150,height:30,fontSize:13,color:'#111111',bgColor:'#FFFFFF',opacity:1},
  {id:'signature',type:'VisualSignature',text:'Visual Only',pageIndex:0,x:50,y:120,
   width:230,height:65,fontSize:14,color:'#194C78',bgColor:'#FFFFFF',opacity:1}
 ];
 editState.record(doc,new Map([[0,{stream,ref:p.contentStreamRef}]]),overlay,lib);
 const saved=await doc.save();
 const restored=await editState.restore(new Uint8Array(saved),lib);
 assert.equal(restored.warning,false);
 assert.deepEqual(restored.overlays.map(x=>x.type),['Correction','VisualSignature']);
 assert.match(editor,/case "visualTextCorrection"/);
 assert.match(editor,/case "maskedPageExport"/);
 assert.match(editor,/case "insertVisualSignature"/);
 assert.match(editor,/id="correctTextSource"/);
 assert.match(editor,/id="maskConfirmed"/);
 assert.match(editor,/원본 PDF의 글자는 삭제되거나 수정되지 않습니다/);
 assert.match(editor,/전자서명·인증서 서명 아님/);
 assert.match(build,/sunrise-special-pdf\.js/);
 console.log('PASS: visual-only correction candidate validation, one-page raster mask output, non-certified signature persistence and safety labels');
})().catch(e=>{console.error(e);process.exitCode=1;});
