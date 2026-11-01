const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const images=require('../src/assets/sunrise-embedded-images.js');
(async()=>{
  const kind={GRAYSCALE_1BPP:1,RGB_24BPP:2,RGBA_32BPP:3};
  assert.deepEqual([...images.pixelsToRgba({width:2,height:1,kind:2,data:Uint8Array.from([255,0,0,0,0,255])},kind)],
    [255,0,0,255,0,0,255,255]);
  assert.deepEqual([...images.pixelsToRgba({width:2,height:1,kind:1,data:Uint8Array.of(128)},kind)],
    [255,255,255,255,0,0,0,255]);
  assert.throws(()=>images.pixelsToRgba({width:2,height:2,kind:3,data:Uint8Array.of(1)},kind),/길이/);
  assert.throws(()=>images.validateImage({width:8192,height:8192}),/화소/);
  let contextPixels=[];
  const createCanvas=(w,h)=>({
    width:w,height:h,
    getContext:()=>({
      createImageData:()=>({data:new Uint8ClampedArray(w*h*4)}),
      putImageData:im=>contextPixels.push([...im.data])
    }),
    toBlob:cb=>cb({size:3,arrayBuffer:async()=>Uint8Array.of(1,2,3).buffer})
  });
  const ops={paintImageXObject:10,paintJpegXObject:11,paintInlineImageXObject:12,
    paintImageXObjectRepeat:13,paintInlineImageXObjectGroup:14};
  const img={width:2,height:1,kind:2,data:Uint8Array.from([255,0,0,0,0,255])};
  const page={
    objs:{has:key=>key==='Im0',get:()=>img},
    getOperatorList:async()=>({fnArray:[10,10,12,2,13],argsArray:[['Im0'],['Im0'],[img],[],['Im0']]})
  };
  const received=[];
  const reader={numPages:1,getPage:async()=>page};
  const report=await images.extract(reader,{OPS:ops,createCanvas,onImage:item=>received.push(item),
    yieldTask:async()=>{}});
  assert.equal(report.images,2);
  assert.equal(report.pages,1);
  assert.equal(report.skipped,0);
  assert.deepEqual(received.map(x=>[x.page,x.index,x.bytes.byteLength]),[[1,1,3],[1,2,3]]);
  assert.equal(contextPixels.length,2);
  const canceled=images.extract(reader,{OPS:ops,createCanvas,onImage:()=>{},
    cancelled:()=>true,yieldTask:async()=>{}});
  await assert.rejects(canceled,/취소/);
  const tooLarge={numPages:101,getPage:async()=>({
    objs:{has:()=>false},
    getOperatorList:async()=>({fnArray:[],argsArray:[]})
  })};
  const limited=await images.extract(tooLarge,{OPS:ops,createCanvas,onImage:()=>{},
    yieldTask:async()=>{}});
  assert.equal(limited.pages,100);
  assert.equal(limited.limited,true);
  const editor=fs.readFileSync(path.join(__dirname,'../src/editor/index.html'),'utf8');
  const build=fs.readFileSync(path.join(__dirname,'../scripts/build-release.cjs'),'utf8');
  assert.match(editor,/<script src="\/assets\/sunrise-embedded-images\.js"><\/script>/);
  assert.match(editor,/case "extractEmbeddedImages":[\s\S]{0,120}openEmbeddedImagesModal\(doc\)/);
  assert.match(editor,/PNG 저장/);
  assert.match(build,/sunrise-embedded-images\.js/);
  console.log('Embedded PDF image extraction contracts passed');
})().catch(e=>{console.error(e);process.exitCode=1;});
