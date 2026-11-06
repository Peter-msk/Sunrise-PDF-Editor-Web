'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const lib=require('../dist/assets/pdf-lib/pdf-lib.min.js'),korean=require('../src/assets/korean-font.js');
const html=fs.readFileSync('src/editor/index.html','utf8'),n=lib.PDFName.of;
const assets={bytes:new Uint8Array(fs.readFileSync('dist/assets/fonts/DroidSansFallback.ttf')),metrics:JSON.parse(fs.readFileSync('dist/assets/fonts/DroidSansFallback.metrics.json','utf8'))};
const ctx=vm.createContext({window:{PDFLib:lib,SunriseKoreanFont:{embed:(p,texts)=>korean.embed(p,texts,assets)}},Uint8Array,Intl,Array,Number,Error});
const layoutStart=html.indexOf('    function layoutOverlayText('),layoutEnd=html.indexOf('    async function compileDocumentWithOverlays(',layoutStart);
vm.runInContext(html.slice(layoutStart,layoutEnd),ctx);
const start=html.indexOf('    function nativeAnnotationHasMarker('),end=html.indexOf('    async function openNativeAnnotationsModal(',start);
vm.runInContext(html.slice(start,end),ctx);
async function main(){
 const p=await lib.PDFDocument.create(),page=p.addPage([400,600]);
 const root=p.context.register(p.context.obj({Type:'Annot',Subtype:'FreeText',Rect:[20,20,300,100],Contents:lib.PDFHexString.fromText('원문'),DA:lib.PDFString.of('/Helv 12 Tf 0 g'),RC:lib.PDFString.of('<p>old</p>'),F:4}));page.node.addAnnot(root);
 const reply=p.context.register(p.context.obj({Type:'Annot',Subtype:'Text',Rect:[20,120,40,140],IRT:root,Contents:lib.PDFString.of('reply'),F:4}));page.node.addAnnot(reply);
 const input=await p.save(),loaded=await lib.PDFDocument.load(input);
 await ctx.updateNativeAnnotationWithAppearance(loaded,input,0,0,'edit','새로운 한글 주석\n둘째 줄');
 const saved=await lib.PDFDocument.load(await loaded.save()),a=saved.context.lookup(root),ap=saved.context.lookup(a.get(n('AP'))),appearance=saved.context.lookup(ap.get(n('N')));
 assert(appearance instanceof lib.PDFRawStream);assert(!a.has(n('RC')));assert.equal(a.get(n('Contents')).decodeText(),'새로운 한글 주석\n둘째 줄');
 const stream=new TextDecoder().decode(lib.decodePDFRawStream(appearance).decode());assert.equal((stream.match(/ Tj/g)||[]).length,2);
 assert.equal(saved.context.lookup(reply).get(n('IRT')).toString(),root.toString());
 ctx.updateNativeAnnotation(saved,input,0,1,'edit','수정된 답글');assert.equal(saved.context.lookup(reply).get(n('Contents')).decodeText(),'수정된 답글');
 const thread=await lib.PDFDocument.load(await saved.save());
 const removed=ctx.updateNativeAnnotation(thread,input,0,0,'delete');assert.equal(removed.removedCount,2);assert.equal(thread.getPage(0).node.Annots(),undefined);
 await assert.rejects(ctx.updateNativeAnnotationWithAppearance(saved,input,0,0,'edit','가'.repeat(2000)),/높이|크기/);
 assert.equal(saved.getPage(0).node.Annots().size(),2);
 console.log('R34 annotations: Korean multiline FreeText appearance, rich-text removal, reply preservation/edit and overflow guard passed');
}
main().catch(e=>{console.error(e);process.exitCode=1;});
