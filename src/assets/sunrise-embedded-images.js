// Local, decoded raster extraction from existing PDF image paint operators.
// Not a PDF page screenshot, original JPEG-byte export, or security-redaction tool.
(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.SunriseEmbeddedImages=api;
})(typeof globalThis!=='undefined'?globalThis:undefined,function(){
  'use strict';
  const MAX_PAGES=100,MAX_IMAGES=20,MAX_PIXELS=16*1024*1024,MAX_OUTPUT=60*1024*1024;
  function validateImage(image){
    const w=image?.width,h=image?.height;
    if(!Number.isSafeInteger(w)||!Number.isSafeInteger(h)||w<1||h<1||w*h>MAX_PIXELS)
      throw Error('지원 가능한 이미지 크기(최대 1,677만 화소)를 초과했습니다.');
    return {w,h};
  }
  function asBytes(data){
    if(data instanceof Uint8Array)return data;
    if(ArrayBuffer.isView(data)&&data.BYTES_PER_ELEMENT===1)
      return new Uint8Array(data.buffer,data.byteOffset,data.byteLength);
    throw Error('지원하지 않는 이미지 화소 데이터입니다.');
  }
  function pixelsToRgba(image,kind){
    const {w,h}=validateImage(image),data=asBytes(image.data),n=w*h;
    const out=new Uint8ClampedArray(n*4);
    if(image.kind===kind.RGBA_32BPP){
      if(data.byteLength<n*4)throw Error('RGBA 화소 길이가 올바르지 않습니다.');
      out.set(data.subarray(0,n*4));
    }else if(image.kind===kind.RGB_24BPP){
      if(data.byteLength<n*3)throw Error('RGB 화소 길이가 올바르지 않습니다.');
      for(let i=0;i<n;i++){const p=i*3,q=i*4;out[q]=data[p];out[q+1]=data[p+1];out[q+2]=data[p+2];out[q+3]=255;}
    }else if(image.kind===kind.GRAYSCALE_1BPP){
      const stride=Math.ceil(w/8);
      if(data.byteLength<stride*h)throw Error('흑백 이미지 길이가 올바르지 않습니다.');
      for(let y=0;y<h;y++)for(let x=0;x<w;x++){
        const gray=(data[y*stride+(x>>3)]&(128>>(x&7)))?255:0,q=(y*w+x)*4;
        out[q]=gray;out[q+1]=gray;out[q+2]=gray;out[q+3]=255;
      }
    }else throw Error('지원하지 않는 이미지 색상 형식입니다.');
    return out;
  }
  function getRaster(page,opcode,args,OPS){
    if(opcode===OPS.paintInlineImageXObject||opcode===OPS.paintInlineImageXObjectGroup)
      return args?.[0]||null;
    if(opcode!==OPS.paintImageXObject&&opcode!==OPS.paintJpegXObject&&opcode!==OPS.paintImageXObjectRepeat)
      return null;
    const id=args?.[0];
    if(typeof id!=='string'||!page.objs?.has?.(id))return null;
    return page.objs.get(id);
  }
  async function rasterToPng(image,kind,makeCanvas){
    const {w,h}=validateImage(image),canvas=makeCanvas(w,h);
    if(!canvas||typeof canvas.getContext!=='function')throw Error('이미지 캔버스를 만들지 못했습니다.');
    canvas.width=w;canvas.height=h;
    const ctx=canvas.getContext('2d',{willReadFrequently:false});
    if(!ctx)throw Error('이미지 캔버스를 사용할 수 없습니다.');
    if(image.bitmap){
      ctx.drawImage(image.bitmap,0,0,w,h);
    }else{
      const raw=pixelsToRgba(image,kind),pixels=ctx.createImageData(w,h);
      pixels.data.set(raw);ctx.putImageData(pixels,0,0);
    }
    try{
      const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));
      if(!blob||!blob.size)throw Error('이미지를 PNG로 인코딩하지 못했습니다.');
      return new Uint8Array(await blob.arrayBuffer());
    }finally{canvas.width=0;canvas.height=0;}
  }
  async function extract(reader,options){
    const opt=options||{},ops=opt.OPS,kind=opt.ImageKind||{GRAYSCALE_1BPP:1,RGB_24BPP:2,RGBA_32BPP:3};
    if(!reader?.getPage||!Number.isInteger(reader.numPages)||reader.numPages<1||!ops||!kind||
      typeof opt.onImage!=='function')throw Error('PDF 이미지 추출 입력이 올바르지 않습니다.');
    const makeCanvas=opt.createCanvas||((w,h)=>{const c=document.createElement('canvas');c.width=w;c.height=h;return c;});
    const pages=opt.currentPage===undefined?Array.from({length:Math.min(reader.numPages,MAX_PAGES)},(_,i)=>i+1):[opt.currentPage];
    if(pages.some(p=>!Number.isInteger(p)||p<1||p>reader.numPages))throw Error('페이지 번호가 올바르지 않습니다.');
    const result={images:0,skipped:0,pages:0,bytes:0,limited:reader.numPages>MAX_PAGES&&opt.currentPage===undefined};
    const cancelled=()=>{if(opt.cancelled?.())throw Error('이미지 추출이 취소되었습니다.');};
    const taskYield=opt.yieldTask||(()=>new Promise(resolve=>setTimeout(resolve,0)));
    for(const number of pages){
      cancelled();
      const page=await reader.getPage(number);
      const operations=await page.getOperatorList();
      const ids=new Set();
      for(let i=0;i<operations.fnArray.length;i++){
        cancelled();
        const opcode=operations.fnArray[i],args=operations.argsArray[i];
        if(opcode!==ops.paintImageXObject&&opcode!==ops.paintJpegXObject&&
           opcode!==ops.paintImageXObjectRepeat&&opcode!==ops.paintInlineImageXObject&&
           opcode!==ops.paintInlineImageXObjectGroup)continue;
        const id=typeof args?.[0]==='string'?args[0]:null;
        if(id&&ids.has(id))continue;
        if(id)ids.add(id);
        if(result.images>=MAX_IMAGES){result.limited=true;break;}
        try{
          const raster=getRaster(page,opcode,args,ops);
          if(!raster){result.skipped++;continue;}
          const bytes=await rasterToPng(raster,kind,makeCanvas);
          if(result.bytes+bytes.byteLength>MAX_OUTPUT){result.skipped++;result.limited=true;continue;}
          await opt.onImage({page:number,index:result.images+1,width:raster.width,height:raster.height,bytes});
          result.bytes+=bytes.byteLength;result.images++;
        }catch(error){
          if(String(error?.message||'').includes('취소'))throw error;
          result.skipped++;
        }
      }
      result.pages++;
      opt.onProgress?.({...result,total:pages.length});
      if(result.images>=MAX_IMAGES)break;
      await taskYield();
    }
    return result;
  }

  // Export unchanged JPEG stream bytes from /Resources/XObject. Unlike the
  // PDF.js PNG path, this does not render, recompress or flatten pixels.
  // Deliberately limited to direct DCTDecode image streams without masks,
  // auxiliary filters or Decode parameters; nested Form XObjects are not
  // traversed. Unused resource images may be found as well.
  async function extractOriginalJpegs(pdfBytes,options){
    const opt=options||{},lib=opt.PDFLib;
    if(!lib?.PDFDocument?.load||!lib?.PDFName?.of||typeof opt.onImage!=='function')
      throw Error('PDF 원본 JPEG 추출 엔진 또는 출력 기능이 없습니다.');
    const bytes=pdfBytes instanceof Uint8Array?pdfBytes:
      pdfBytes instanceof ArrayBuffer?new Uint8Array(pdfBytes):null;
    if(!bytes?.byteLength)throw Error('원본 PDF 바이트가 비어 있거나 올바르지 않습니다.');
    const cancelled=()=>{if(opt.cancelled?.())throw Error('이미지 추출이 취소되었습니다.');};
    const taskYield=opt.yieldTask||(()=>new Promise(resolve=>setTimeout(resolve,0)));
    cancelled();
    const pdf=await lib.PDFDocument.load(bytes,{updateMetadata:false});
    cancelled();
    const pages=opt.currentPage===undefined?
      Array.from({length:Math.min(pdf.getPageCount(),MAX_PAGES)},(_,i)=>i+1):
      [opt.currentPage];
    if(pages.some(p=>!Number.isSafeInteger(p)||p<1||p>pdf.getPageCount()))
      throw Error('페이지 번호가 올바르지 않습니다.');
    const result={images:0,skipped:0,pages:0,bytes:0,
      limited:pdf.getPageCount()>MAX_PAGES&&opt.currentPage===undefined};
    const n=lib.PDFName.of,seen=new Set();
    for(const number of pages){
      cancelled();
      const page=pdf.getPage(number-1),resources=page.node.Resources();
      const objects=resources?.get?.(n('XObject'));
      const dict=objects?pdf.context.lookup(objects):null;
      const pending=dict?.entries?[{dict,depth:0}]:[],visitedForms=new Set();
      let objectCount=0;
      while(pending.length){
        const current=pending.pop();
        if(current.depth>12)throw Error('중첩 그림 리소스가 너무 깊습니다.');
        for(const [resourceName,ref] of current.dict.entries()){
          cancelled();if(++objectCount>4000)throw Error('이미지 리소스가 너무 많습니다.');
          const image=pdf.context.lookup(ref);
          if(image?.dict?.get?.(n('Subtype'))?.toString()==='/Form'){
            const key=ref instanceof lib.PDFRef?ref.toString():image;
            if(visitedForms.has(key))continue;visitedForms.add(key);
            const ownResources=pdf.context.lookup(image.dict.get(n('Resources')));
            const nested=pdf.context.lookup(ownResources?.get?.(n('XObject')));
            if(nested?.entries)pending.push({dict:nested,depth:current.depth+1});
            continue;
          }
          if(image?.dict?.get?.(n('Subtype'))?.toString()!=='/Image')continue;
          const key=ref instanceof lib.PDFRef?ref.toString():number+':'+resourceName.toString();
          if(seen.has(key))continue;
          seen.add(key);
          if(result.images>=MAX_IMAGES){result.limited=true;break;}
          const meta=image.dict;
          // A JPEG with a transparency mask, custom Decode, or multiple
          // filters cannot be represented faithfully by one standalone JPG.
          if(meta.get(n('Filter'))?.toString()!=='/DCTDecode'||
             meta.has(n('SMask'))||meta.has(n('Mask'))||
             meta.has(n('Decode'))||meta.has(n('DecodeParms'))||
             meta.get(n('ImageMask'))?.toString()==='true'){
            result.skipped++;continue;
          }
          const width=pdf.context.lookup(meta.get(n('Width')))?.asNumber?.();
          const height=pdf.context.lookup(meta.get(n('Height')))?.asNumber?.();
          if(!Number.isSafeInteger(width)||!Number.isSafeInteger(height)||
             width<1||height<1||width*height>MAX_PIXELS){
            result.skipped++;continue;
          }
          const raw=image.getContents?.();
          if(!(raw instanceof Uint8Array)||raw.byteLength<4||
             raw[0]!==255||raw[1]!==216||
             raw[raw.length-2]!==255||raw[raw.length-1]!==217){
            result.skipped++;continue;
          }
          if(result.bytes+raw.byteLength>MAX_OUTPUT){
            result.skipped++;result.limited=true;continue;
          }
          // Copy only accepted JPEG bytes. Result buttons own these bytes,
          // not a reference into the source PDF's mutable parser context.
          const output=Uint8Array.from(raw);
          cancelled();
          await opt.onImage({page:number,index:result.images+1,width,height,
            bytes:output,format:'jpeg'});
          cancelled();
          result.images++;result.bytes+=output.byteLength;
        }
      }
      result.pages++;
      opt.onProgress?.({...result,total:pages.length});
      if(result.images>=MAX_IMAGES)break;
      await taskYield();
    }
    cancelled();
    return result;
  }

  // Image objects only, with their page placement. Never rasterize the page or
  // its editable text; unsupported clipping/skew fails instead of losing it.
  async function placements(page,opt={}){
    const OPS=opt.OPS,kind=opt.ImageKind||{GRAYSCALE_1BPP:1,RGB_24BPP:2,RGBA_32BPP:3};
    if(!OPS||!page?.getOperatorList)throw Error('이미지 배치 분석 엔진이 없습니다.');
    const canvas=opt.createCanvas||(()=>document.createElement('canvas'));
    const operations=await page.getOperatorList(),output=[],stack=[],cache=new Map();
    let matrix=[1,0,0,1,0,0],clipped=false,total=0;
    const multiply=(a,b)=>[a[0]*b[0]+a[2]*b[1],a[1]*b[0]+a[3]*b[1],a[0]*b[2]+a[2]*b[3],a[1]*b[2]+a[3]*b[3],a[0]*b[4]+a[2]*b[5]+a[4],a[1]*b[4]+a[3]*b[5]+a[5]];
    for(let i=0;i<operations.fnArray.length;i++){
      if(opt.cancelled?.())throw new DOMException('변환 취소','AbortError');
      const op=operations.fnArray[i],args=operations.argsArray[i];
      if(op===OPS.save||op===OPS.paintFormXObjectBegin){
        if(stack.length>=64)throw Error('이미지 배치의 중첩이 너무 깊습니다.');
        stack.push({matrix:matrix.slice(),clipped});
        if(op===OPS.paintFormXObjectBegin){if(args?.[0])matrix=multiply(matrix,args[0]);if(args?.[1])clipped=true;}
      }else if(op===OPS.restore||op===OPS.paintFormXObjectEnd){
        const previous=stack.pop();if(!previous)throw Error('이미지 그래픽 상태가 일치하지 않습니다.');
        matrix=previous.matrix;clipped=previous.clipped;
      }else if(op===OPS.transform){
        if(!Array.isArray(args)||args.length!==6||!args.every(Number.isFinite))throw Error('이미지 변환 행렬이 올바르지 않습니다.');matrix=multiply(matrix,args);
      }else if(op===OPS.clip||op===OPS.eoClip)clipped=true;
      else if([OPS.paintImageXObjectRepeat,OPS.paintInlineImageXObjectGroup,OPS.paintImageMaskXObject,OPS.paintImageMaskXObjectGroup].some(code=>code!==undefined&&op===code))
        throw Error('반복·그룹·마스크 이미지는 편집 가능한 Word 혼합 배치를 지원하지 않습니다.');
      else if([OPS.paintImageXObject,OPS.paintJpegXObject,OPS.paintInlineImageXObject].some(code=>code!==undefined&&op===code)){
        if(clipped||Math.abs(matrix[1])>.001||Math.abs(matrix[2])>.001||matrix[0]===0||matrix[3]===0)throw Error('잘림·회전·기울임 이미지의 Word 배치를 확정할 수 없습니다.');
        if(output.length>=20)throw Error('한 페이지 이미지는 최대 20개입니다.');
        const key=typeof args?.[0]==='string'?args[0]:null;
        let png=key?cache.get(key):null;
        if(!png){
          let image=getRaster(page,op,args,OPS);
          if(!image&&key&&page.objs?.get)image=await new Promise((resolve,reject)=>{
            const timer=setTimeout(()=>reject(Error('PDF 이미지 해독 시간을 초과했습니다.')),5000);
            try{page.objs.get(key,value=>{clearTimeout(timer);resolve(value);});}catch(error){clearTimeout(timer);reject(error);}
          });
          if(!image)throw Error('내장 이미지 데이터를 읽을 수 없습니다.');
          png=await rasterToPng(image,kind,canvas);if(key)cache.set(key,png);
        }
        total+=png.length;if(total>MAX_OUTPUT)throw Error('이미지 데이터가 60MiB를 초과했습니다.');
        output.push({png,x:Math.min(matrix[4],matrix[4]+matrix[0]),y:Math.min(matrix[5],matrix[5]+matrix[3]),width:Math.abs(matrix[0]),height:Math.abs(matrix[3]),flipH:matrix[0]<0,flipV:matrix[3]<0});
      }
    }
    if(stack.length)throw Error('이미지 그래픽 상태가 닫히지 않았습니다.');
    return output;
  }

  return {extract,extractOriginalJpegs,placements,pixelsToRgba,validateImage};
});
