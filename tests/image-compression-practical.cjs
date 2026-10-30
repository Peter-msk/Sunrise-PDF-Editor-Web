// Native-codec integration check. Install @napi-rs/canvas or set SUNRISE_CANVAS_MODULE.
// This exercises PDF objects and real JPEG encoding; it is not a browser UI test.
const assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm'), zlib = require('node:zlib');
const {createCanvas, loadImage} = require(process.env.SUNRISE_CANVAS_MODULE || '@napi-rs/canvas');
const lib = require('../dist/assets/pdf-lib/pdf-lib.min.js'), n = lib.PDFName.of;
const src = fs.readFileSync('src/editor/index.html','utf8');
function canvas(w=1,h=1) {
  const c=createCanvas(w,h);
  c.toBlob=(cb,type,q)=>cb(new Blob([c.toBuffer('image/jpeg',Math.round(q*100))],{type}));
  return c;
}
const ctx=vm.createContext({window:{PDFLib:lib},document:{createElement:()=>canvas()},
  createImageBitmap:async input=>{
    const image=input instanceof Blob ? await loadImage(Buffer.from(await input.arrayBuffer())) : input;
    const copy=canvas(image.width,image.height);copy.getContext('2d').drawImage(image,0,0);copy.close=()=>{};return copy;
  },Blob,Response,CompressionStream,DecompressionStream,Uint8Array,console});
vm.runInContext(src.slice(src.indexOf('    function pdfCompressionSettings('),src.indexOf('    function openSaveAsModal(')),ctx);
async function run(bytes,strength){ctx.input=bytes;ctx.strength=strength;return vm.runInContext('compressPdfImages(input,pdfCompressionSettings(strength))',ctx)}
(async()=>{
  const c=canvas(2400,1800),paint=c.getContext('2d'),data=paint.createImageData(c.width,c.height);let seed=7;
  for(let i=0;i<data.data.length;i+=4){seed=(Math.imul(seed,1664525)+1013904223)>>>0;const noise=(seed>>>24)%50;
    data.data[i]=120+(i/4%2400)/30+noise;data.data[i+1]=100+noise;data.data[i+2]=150+noise;data.data[i+3]=255;}
  paint.putImageData(data,0,0);paint.fillStyle='white';paint.fillRect(150,200,1500,300);paint.fillStyle='black';paint.font='90px sans-serif';paint.fillText('SCAN SAMPLE 12345',200,400);
  const pdf=await lib.PDFDocument.create(),page=pdf.addPage([600,800]);
  const jpg=await pdf.embedJpg(c.toBuffer('image/jpeg',100));page.drawImage(jpg,{x:0,y:100,width:600,height:450});
  page.drawText('SEARCHABLE TEST',{x:30,y:50,size:18});pdf.setTitle('Compression fixture');await pdf.attach(Buffer.from('attachment retained'),'keep.txt');
  const root=pdf.context.obj({Type:'Outlines'}),rr=pdf.context.register(root),mark=pdf.context.obj({Title:lib.PDFString.of('Keep bookmark'),Parent:rr,Dest:[page.ref,n('Fit')]});
  const mr=pdf.context.register(mark);root.set(n('First'),mr);root.set(n('Last'),mr);root.set(n('Count'),lib.PDFNumber.of(1));pdf.catalog.set(n('Outlines'),rr);
  const bytes=await pdf.save();const sizes=[];
  if(process.env.SUNRISE_IMAGE_FIXTURES)fs.writeFileSync(process.env.SUNRISE_IMAGE_FIXTURES+'-original.pdf',bytes);
  for(const strength of [0,20,60,90]){
    const out=await run(bytes,strength),parsed=await lib.PDFDocument.load(out.bytes);sizes.push(out.bytes.length);
    assert(out.bytes.length<=bytes.length);assert.equal(parsed.getPageCount(),1);assert.equal(parsed.getTitle(),'Compression fixture');
    assert(parsed.catalog.get(n('Outlines')));assert(parsed.catalog.get(n('Names')));
    if(strength)assert.equal(out.images,1);
    if(process.env.SUNRISE_IMAGE_FIXTURES)fs.writeFileSync(process.env.SUNRISE_IMAGE_FIXTURES+'-'+strength+'.pdf',out.bytes);
    console.log(`strength ${strength}: ${bytes.length} -> ${out.bytes.length}, images ${out.images}`);
  }
  assert(sizes[3]<sizes[2]&&sizes[2]<sizes[1]);
  // Flate RGB with PNG Up predictor, plus an unsupported CMYK image preserved.
  const png=await lib.PDFDocument.create();png.addPage();const rows=Buffer.alloc(128*(128*3+1));for(let y=0;y<128;y++){rows[y*385]=2;for(let x=0;x<384;x++)rows[y*385+1+x]=y===0?100:0;}
  const image=lib.PDFRawStream.of(png.context.obj({Type:'XObject',Subtype:'Image',Width:128,Height:128,ColorSpace:'DeviceRGB',BitsPerComponent:8,Filter:'FlateDecode',DecodeParms:{Predictor:12,Colors:3,Columns:128,BitsPerComponent:8}}),zlib.deflateSync(rows,{level:0}));
  png.context.register(image);const cmyk=lib.PDFRawStream.of(png.context.obj({Type:'XObject',Subtype:'Image',Width:128,Height:128,ColorSpace:'DeviceCMYK',BitsPerComponent:8}),Buffer.alloc(65536,100));const cr=png.context.register(cmyk);
  const out=await run(await png.save(),60);assert.equal(out.images,1);assert.equal(out.skipped,1);
  const parsed=await lib.PDFDocument.load(out.bytes);assert.equal(parsed.context.lookup(cr).dict.get(n('ColorSpace')),n('DeviceCMYK'));
  // Alpha masks stay lossless; their parent may change codec but not dimensions.
  const mask=png.context.register(lib.PDFRawStream.of(png.context.obj({Type:'XObject',Subtype:'Image',Width:128,Height:128,ColorSpace:'DeviceGray',BitsPerComponent:8}),Buffer.alloc(16384,255)));
  image.dict.set(n('SMask'),mask);const protectedResult=await run(await png.save(),90);assert.equal(protectedResult.images,1);
  const protectedPdf=await lib.PDFDocument.load(protectedResult.bytes);
  assert.deepEqual(Buffer.from(lib.decodePDFRawStream(protectedPdf.context.lookup(mask)).decode()),Buffer.alloc(16384,255));
  png.context.lookup(mask).dict.set(n('Matte'),png.context.obj([1,1,1]));
  const matteResult=await run(await png.save(),90);assert.equal(matteResult.images,0);
  // A real RGBA PNG; the max-edge request must not resample its alpha channel.
  const rgba=canvas(600,400),rgbaPaint=rgba.getContext('2d'),rgbaData=rgbaPaint.createImageData(600,400);
  for(let i=0;i<600*400;i++){rgbaData.data[i*4]=(i*31)%256;rgbaData.data[i*4+1]=(i*7)%256;rgbaData.data[i*4+2]=100;rgbaData.data[i*4+3]=Math.floor((i%600)*255/599);}
  rgbaPaint.putImageData(rgbaData,0,0);
  const transparent=await lib.PDFDocument.create(),tp=transparent.addPage([600,400]);
  const ti=await transparent.embedPng(rgba.toBuffer('image/png'));tp.drawImage(ti,{x:0,y:0,width:600,height:400});
  const transparentBytes=await transparent.save();
  const before=await lib.PDFDocument.load(transparentBytes),alphaRef=before.context.lookup(ti.ref).dict.get(n('SMask'));
  const beforeAlpha=Buffer.from(lib.decodePDFRawStream(before.context.lookup(alphaRef)).decode());
  ctx.input=transparentBytes;
  const transparentResult=await vm.runInContext('compressPdfImages(input,{...pdfCompressionSettings(60),maxEdge:128})',ctx);
  const after=await lib.PDFDocument.load(transparentResult.bytes),afterImage=after.context.lookup(ti.ref);
  assert.equal(transparentResult.images,1);assert.equal(afterImage.dict.lookup(n('Width')).asNumber(),600);
  assert.equal(afterImage.dict.lookup(n('Height')).asNumber(),400);
  assert.deepEqual(Buffer.from(lib.decodePDFRawStream(after.context.lookup(alphaRef)).decode()),beforeAlpha);
  if(process.env.SUNRISE_IMAGE_FIXTURES){fs.writeFileSync(process.env.SUNRISE_IMAGE_FIXTURES+'-alpha-original.pdf',transparentBytes);fs.writeFileSync(process.env.SUNRISE_IMAGE_FIXTURES+'-alpha-compressed.pdf',transparentResult.bytes);}
  console.log(`transparent PNG: ${transparentBytes.length} -> ${transparentResult.bytes.length}, alpha bytes identical`);
  await assert.rejects(run(bytes,101),/강도/);
  console.log('PASS: real JPEG codec, ordered presets, Flate PNG predictor, masks/CMYK preserved, PDF metadata/bookmark/attachment retained');
})().catch(e=>{console.error(e);process.exitCode=1});
