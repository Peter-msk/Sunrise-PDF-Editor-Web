const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const lib=require('../dist/assets/pdf-lib/pdf-lib.min.js'),edit=require('../dist/assets/sunrise-edit-state.js'),font=require('../dist/assets/korean-font.js');
const assets={bytes:new Uint8Array(fs.readFileSync('dist/assets/fonts/DroidSansFallback.ttf')),metrics:JSON.parse(fs.readFileSync('dist/assets/fonts/DroidSansFallback.metrics.json','utf8'))};
const src=fs.readFileSync('src/editor/index.html','utf8');
function section(a,b){const i=src.indexOf(a),j=src.indexOf(b,i);assert(i>=0&&j>i);return src.slice(i,j)}
const png='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFElEQVR4nGMUzpv/n4GBgYGJAQoAH5wCI2l1nlIAAAAASUVORK5CYII=';
const paint={measureText:()=>({width:50}),scale(){},fillRect(){},strokeRect(){},fillText(){}};
const ctx=vm.createContext({document:{createElement:()=>({getContext:()=>paint,toDataURL:()=>png})},window:{PDFLib:lib,SunriseEditState:edit,SunriseKoreanFont:{embed:(p,t)=>font.embed(p,t,assets)}},console,Uint8Array,Date});
vm.runInContext(section('    function appendPdfBookmarks(', '    async function compileDocumentWithOverlays(')+section('    async function compileDocumentWithOverlays','    // =========================================================================\n    // Feature 1:'),ctx);
(async()=>{
 for(const rot of [0,90,180,270]) {
  const pdf=await lib.PDFDocument.create(),page=pdf.addPage([300,500]);page.setRotation(lib.degrees(rot));
  const position=(x,y)=>rot===0?[x,y]:rot===90?[500-y,x]:rot===180?[300-x,500-y]:[y,300-x];
  const item=(type,x,y)=>{const [px,py]=position(x,y);return {type,text:type==='Text'?'HELLO':'STAMP',pageIndex:0,x:px,y:py,width:120,height:30,fontSize:13,rotation:rot}};
  const convert=(x,y)=>rot===0?[x,500-y]:rot===90?[y,x]:rot===180?[300-x,y]:[300-y,500-x];
  const view={rotate:rot,getViewport:()=>({convertToPdfPoint:convert})};
  ctx.doc={bytes:await pdf.save(),pdfJsDoc:{getPage:async()=>view},overlays:[item('Text',30,40),item('Stamp',70,120),item('Watermark',70,200)],bookmarks:[],metadata:{},attachments:[]};
  const output=await vm.runInContext('compileDocumentWithOverlays(doc)',ctx);const restored=await edit.restore(output,lib);
  assert.equal(restored.warning,false);assert.deepEqual(Array.from(restored.overlays,x=>x.rotation),[rot,rot,rot]);
  if(process.env.SUNRISE_ROTATE_FIXTURES)fs.writeFileSync(`${process.env.SUNRISE_ROTATE_FIXTURES}-${rot}.pdf`,output);
 }
 console.log('PASS: rotated searchable text, stamp and watermark save and edit-state restoration');
})().catch(e=>{console.error(e);process.exitCode=1});
