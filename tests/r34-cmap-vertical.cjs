'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs');
const lib=require('../dist/assets/pdf-lib/pdf-lib.min.js'),core=require('../src/assets/sunrise-content-editor.js'),korean=require('../src/assets/korean-font.js'),n=lib.PDFName.of;
async function main(){
 const mapping=core.encodingCMap('/WMode 1 def 1 begincodespacerange <00> <ff> endcodespacerange 1 begincidrange <01> <03> 10 endcidrange');assert.equal(mapping.vertical,true);assert.equal(mapping.mapping.get(3),12);
 assert.throws(()=>core.encodingCMap('1 begincidchar <0001> 1 endcidchar /KSCms-UHC-H usecmap'),/외부/);
 const p=await lib.PDFDocument.create(),ctx=p.context;
 const unicode=ctx.register(ctx.flateStream('3 beginbfchar <01> <AC00> <02> <B098> <03> <B2E4> endbfchar'));
 const encoding=ctx.register(ctx.flateStream('1 begincodespacerange <00> <ff> endcodespacerange 1 begincidrange <01> <03> 10 endcidrange'));
 const descendant=ctx.register(ctx.obj({Type:'Font',Subtype:'CIDFontType2',BaseFont:'Synthetic',CIDSystemInfo:{Registry:lib.PDFString.of('Adobe'),Ordering:lib.PDFString.of('Identity'),Supplement:0},DW:1000,W:[10,[500,600,700]]}));
 const font=ctx.register(ctx.obj({Type:'Font',Subtype:'Type0',BaseFont:'Synthetic',Encoding:encoding,DescendantFonts:[descendant],ToUnicode:unicode}));
 const page=p.addPage([400,600]);page.node.set(n('Resources'),ctx.obj({Font:{F1:font}}));page.node.set(n('Contents'),ctx.register(ctx.flateStream('BT /F1 12 Tf 1 0 0 1 20 500 Tm <010203> Tj ET')));
 const bytes=await p.save(),items=await core.listText({bytes,pageNumber:1,PDFLib:lib});assert.equal(items[0].original,'가나다');
 const edited=await core.replaceText({bytes,pageNumber:1,targetId:items[0].id,original:'가나다',replacement:'다나가',PDFLib:lib});assert.equal((await core.listText({bytes:edited.bytes,pageNumber:1,PDFLib:lib}))[0].original,'다나가');
 const assets={bytes:new Uint8Array(fs.readFileSync('dist/assets/fonts/DroidSansFallback.ttf')),metrics:JSON.parse(fs.readFileSync('dist/assets/fonts/DroidSansFallback.metrics.json','utf8'))};
 const v=await lib.PDFDocument.create(),vf=await korean.embed(v,['가나다'],assets);v.addPage([400,600]).drawText('가나다',{font:vf,x:100,y:500,size:12});
 const vertical=await lib.PDFDocument.load(await v.save()),fonts=vertical.context.lookup(vertical.getPage(0).node.Resources().get(n('Font')));
 for(const [,ref] of fonts.entries())vertical.context.lookup(ref).set(n('Encoding'),n('Identity-V'));
 const verticalBytes=await vertical.save(),records=await core.listText({bytes:verticalBytes,pageNumber:1,PDFLib:lib});assert.equal(records[0].original,'가나다');
 const changed=await core.replaceText({bytes:verticalBytes,pageNumber:1,targetId:records[0].id,original:'가나다',replacement:'다나',PDFLib:lib});assert.equal((await core.listText({bytes:changed.bytes,pageNumber:1,PDFLib:lib}))[0].original,'다나');
 const q=await lib.PDFDocument.create(),qf=await q.embedFont(lib.StandardFonts.Helvetica);await q.flush();const qp=q.addPage([400,600]);qp.node.set(n('Resources'),q.context.obj({Font:{F1:qf.ref}}));qp.node.set(n('Contents'),q.context.register(q.context.flateStream('BT /F1 12 Tf 15 TL 1 0 0 1 20 500 Tm (FIRST) Tj (SECOND) \' 1 2 (THIRD) " ET')));
 const qbytes=await q.save(),quotes=await core.listText({bytes:qbytes,pageNumber:1,PDFLib:lib});assert.deepEqual(quotes.map(r=>r.original),['FIRST','SECOND','THIRD']);
 const quoteChange=await core.replaceText({bytes:qbytes,pageNumber:1,targetId:quotes[2].id,original:'THIRD',replacement:'FOURTH',PDFLib:lib});assert.equal((await core.listText({bytes:quoteChange.bytes,pageNumber:1,PDFLib:lib}))[2].original,'FOURTH');
 console.log('R34 font encodings: embedded source-to-CID CMaps, Identity-V vertical text and quote operators passed');
}
main().catch(e=>{console.error(e);process.exitCode=1;});
