/* Sunrise PDF Editor (Web) — LOCAL-09 page crop / page-size normalization.
 * Source overlay only: browser-local pdf-lib, no OCR/server upload.
 * Crop modifies CropBox (not permanent redaction). Resize changes vector
 * content geometry and is intentionally restricted to uncomplicated pages.
 */
(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports) module.exports=api;
  if(root) root.SunrisePdfPageGeometry=api;
})(typeof globalThis!=='undefined'?globalThis:undefined,function(){
  'use strict';
  const MM_TO_PT=72/25.4;
  const MAX_PAGES=200;
  const MAX_NAME=220;
  const MAX_DIM_PT=14400;
  const FORMATS=Object.freeze({
    a4:[210,297],a3:[297,420],letter:[215.9,279.4],legal:[215.9,355.6]
  });
  const BOX_GETTERS=Object.freeze(['getMediaBox','getCropBox','getBleedBox','getTrimBox','getArtBox']);
  const CATALOG_GUARDS=Object.freeze([
    'AcroForm','Perms','DSS','Outlines','Names','AF','Collection','StructTreeRoot',
    'MarkInfo','OpenAction','AA','OCProperties','PageLabels','Metadata'
  ]);
  const PAGE_GUARDS=Object.freeze(['AA','Metadata','StructParents','B','PresSteps']);

  function aborted(){const error=new Error('사용자가 작업을 취소했습니다. 결과 PDF를 제공하지 않습니다.');error.name='AbortError';return error;}
  function checkCancel(opts){if(opts?.signal?.aborted||opts?.cancelled?.())throw aborted();}
  const finite=(n)=>typeof n==='number'&&Number.isFinite(n);
  function checkNumber(value,min,max,label){
    if(value===null||value===undefined||String(value).trim()==='') throw Error(label+'을(를) 입력해 주세요.');
    const n=Number(value);
    if(!finite(n)||n<min||n>max)throw Error(`${label}은(는) ${min}~${max} 범위여야 합니다.`);
    return n;
  }
  function close(a,b){return Math.abs(a-b)<=0.01;}
  function sameBox(a,b){return ['x','y','width','height'].every(k=>close(a[k],b[k]));}
  function snapshot(page){
    const boxes={};
    for(const getter of BOX_GETTERS){
      const b=page[getter]();
      if(!['x','y','width','height'].every(k=>finite(b[k]))||
        b.width<=0||b.height<=0||b.width>MAX_DIM_PT||b.height>MAX_DIM_PT)
        throw Error('페이지 박스의 좌표나 크기가 올바르지 않습니다.');
      boxes[getter]={x:b.x,y:b.y,width:b.width,height:b.height};
    }
    const angle=((page.getRotation().angle%360)+360)%360;
    if(![0,90,180,270].includes(angle))throw Error('지원하지 않는 페이지 회전각입니다.');
    return {rotation:angle,boxes};
  }
  function ensureFiles(file){
    if(!file||typeof file.name!=='string'||file.name.length>MAX_NAME||
      !/\.pdf$/i.test(file.name)||!Number.isSafeInteger(file.size)||file.size<1||
      typeof file.arrayBuffer!=='function')
      throw Error('정상적인 PDF 파일 한 개를 선택해 주세요.');
  }
  function normalizeOptions(raw){
    const opt=raw||{};
    const mode=opt.mode||'crop';
    if(!['crop','resize'].includes(mode))throw Error('페이지 자르기 또는 크기 변경을 선택해 주세요.');
    const pages=String(opt.pages??'all').trim().toLowerCase();
    if(!pages||pages.length>160||!(pages==='all'||/^[0-9,\-\s]+$/.test(pages)))
      throw Error('페이지 범위는 전체 또는 1-3,5와 같이 입력해 주세요.');
    if(mode==='crop'){
      const rawMargins=opt.margins||{};
      const margins={};
      for(const side of ['left','right','top','bottom'])
        margins[side]=checkNumber(rawMargins[side]??0,0,150,`${side} 잘라내기(mm)`);
      if(Object.values(margins).every(n=>n===0))throw Error('하나 이상의 자르기 여백을 0보다 크게 지정해 주세요.');
      return Object.freeze({mode,pages,margins:Object.freeze(margins)});
    }
    const preset=String(opt.preset||'a4').toLowerCase();
    if(!FORMATS[preset]&&preset!=='custom')throw Error('지원하지 않는 출력 용지 규격입니다.');
    const dims=preset==='custom'?
      [checkNumber(opt.widthMm,30,1500,'용지 너비(mm)'),checkNumber(opt.heightMm,30,1500,'용지 높이(mm)')]:FORMATS[preset].slice();
    const orientation=opt.orientation||'auto';
    if(!['auto','portrait','landscape'].includes(orientation))throw Error('용지 방향 설정이 올바르지 않습니다.');
    const marginMm=checkNumber(opt.marginMm??5,0,100,'용지 여백(mm)');
    const fitting=opt.fitting||'fit';
    if(!['fit','shrink'].includes(fitting))throw Error('크기 조정 방식을 확인해 주세요.');
    return Object.freeze({mode,pages,preset,widthMm:dims[0],heightMm:dims[1],orientation,marginMm,fitting});
  }
  function selectPages(text,count){
    if(!Number.isSafeInteger(count)||count<1||count>MAX_PAGES)throw Error(`1~${MAX_PAGES}쪽 PDF만 처리합니다.`);
    if(text==='all')return Array.from({length:count},(_,i)=>i);
    const indices=[],seen=new Set();
    for(const part of text.split(',')){
      const found=/^\s*(\d+)\s*(?:-\s*(\d+)\s*)?$/.exec(part);
      if(!found)throw Error('페이지 범위는 1-3,5와 같이 작성해 주세요.');
      const first=Number(found[1]),last=found[2]===undefined?first:Number(found[2]);
      if(!Number.isSafeInteger(first)||!Number.isSafeInteger(last)||first<1||last<first||last>count)
        throw Error(`페이지 ${part.trim()} 범위가 문서 페이지 수(${count})를 벗어났습니다.`);
      for(let i=first;i<=last;i++){
        if(!seen.has(i)){seen.add(i);indices.push(i-1);}
      }
    }
    return indices;
  }
  function matchesPdfName(bytes,name){
    const needle=Array.from('/'+name,x=>x.charCodeAt(0));
    const sep=(v)=>v===undefined||v===0||v===9||v===10||v===12||v===13||v===32||
      v===40||v===41||v===47||v===60||v===62||v===91||v===93;
    for(let i=0;i<=bytes.length-needle.length;i++){
      if(i>0&&!sep(bytes[i-1]))continue;
      let equal=true;
      for(let j=0;j<needle.length;j++){if(bytes[i+j]!==needle[j]){equal=false;break;}}
      if(equal&&sep(bytes[i+needle.length]))return true;
    }
    return false;
  }
  function checkProtected(pdf,lib,bytes){
    const n=lib.PDFName.of;
    if(pdf.context.trailerInfo?.Encrypt||pdf.catalog.get(n('Encrypt')))
      throw Error('암호화된 PDF는 처리하지 않습니다.');
    // pdf-lib does not preserve all PDF signing / XFA semantics on rewrite.
    if(matchesPdfName(bytes,'ByteRange')||matchesPdfName(bytes,'XFA'))
      throw Error('서명 또는 XFA 구조가 의심되어 처리를 중단합니다.');
    for(const key of CATALOG_GUARDS){
      if(pdf.catalog.get(n(key)))throw Error(`문서 구조(${key}) 보호를 위해 이 PDF는 처리하지 않습니다.`);
    }
    for(const [index,page] of pdf.getPages().entries()){
      for(const key of PAGE_GUARDS){
        if(page.node.get(n(key)))throw Error(`${index+1}쪽의 특수 구조(${key})를 보호하기 위해 중단합니다.`);
      }
      const annots=page.node.get(n('Annots'));
      if(annots){
        const arr=pdf.context.lookup(annots);
        if(!(arr instanceof lib.PDFArray)||arr.size()>0)
          throw Error(`${index+1}쪽에 주석·양식이 있어 페이지 위치 변경을 제한합니다.`);
      }
    }
  }
  function cropPlan(snap,mm){
    const c=snap.boxes.getCropBox,m=snap.boxes.getMediaBox;
    // Input distances describe the sides as shown after /Rotate is applied.
    const l=mm.left*MM_TO_PT,r=mm.right*MM_TO_PT;
    const t=mm.top*MM_TO_PT,b=mm.bottom*MM_TO_PT;
    let left,right,bottom,top;
    switch(snap.rotation){
      case 0: [left,right,bottom,top]=[l,r,b,t];break;
      case 90: [left,right,bottom,top]=[t,b,l,r];break;
      case 180:[left,right,bottom,top]=[r,l,t,b];break;
      case 270:[left,right,bottom,top]=[b,t,r,l];break;
      default: throw Error('회전각을 처리하지 못했습니다.');
    }
    const next={x:c.x+left,y:c.y+bottom,width:c.width-left-right,height:c.height-bottom-top};
    if(next.width<36||next.height<36)throw Error('자른 뒤 페이지 크기가 너무 작습니다. 여백을 줄여 주세요.');
    if(next.x<m.x-.01||next.y<m.y-.01||
      next.x+next.width>m.x+m.width+.01||next.y+next.height>m.y+m.height+.01)
      throw Error('자르기 영역이 실제 PDF 페이지 밖에 있어 중단합니다.');
    return next;
  }
  function resizePlan(snap,opt){
    const m=snap.boxes.getMediaBox,c=snap.boxes.getCropBox;
    // Conservative safeguard: do not silently misalign translated/rotated
    // content, nested page boxes or annotations during vector transforms.
    if(snap.rotation!==0||!close(m.x,0)||!close(m.y,0)||!sameBox(m,c)||
      ['getBleedBox','getTrimBox','getArtBox'].some(k=>!sameBox(m,snap.boxes[k])))
      throw Error('크기 변경은 현재 회전 0°·페이지 원점 0·동일 페이지 박스 구조만 지원합니다. 원본 정규화 후 다시 시도하세요.');
    let [w,h]=[opt.widthMm*MM_TO_PT,opt.heightMm*MM_TO_PT];
    const orient=opt.orientation==='auto'?(m.width>m.height?'landscape':'portrait'):opt.orientation;
    if((orient==='portrait'&&w>h)||(orient==='landscape'&&w<h))[w,h]=[h,w];
    if(w>MAX_DIM_PT||h>MAX_DIM_PT)throw Error('출력 PDF 페이지 크기가 허용 범위를 벗어났습니다.');
    const pad=opt.marginMm*MM_TO_PT;
    if(w-2*pad<36||h-2*pad<36)throw Error('용지보다 여백이 커서 내용이 들어갈 수 없습니다.');
    const factor=Math.min((w-2*pad)/m.width,(h-2*pad)/m.height);
    const scale=opt.fitting==='shrink'?Math.min(1,factor):factor;
    if(!finite(scale)||scale<=0)throw Error('페이지 확대·축소 비율을 계산하지 못했습니다.');
    const dx=(w-m.width*scale)/2,dy=(h-m.height*scale)/2;
    return {width:w,height:h,scale,dx,dy};
  }
  function verifySnapshots(expected,actual){
    if(expected.length!==actual.length)throw Error('재열기 결과 페이지 수가 다릅니다.');
    for(let i=0;i<expected.length;i++){
      const a=expected[i],b=snapshot(actual[i]);
      if(a.rotation!==b.rotation)throw Error(`${i+1}쪽의 저장 후 회전값이 달라졌습니다.`);
      for(const key of BOX_GETTERS){
        if(!sameBox(a.boxes[key],b.boxes[key]))throw Error(`${i+1}쪽의 ${key} 박스가 저장 후 변경되었습니다.`);
      }
    }
  }
  async function readBytes(file,opts){
    const raw=typeof opts?.readFile==='function'?await opts.readFile(file):await file.arrayBuffer();
    const bytes=raw instanceof ArrayBuffer?new Uint8Array(raw):
      ArrayBuffer.isView(raw)&&raw.BYTES_PER_ELEMENT===1?new Uint8Array(raw.buffer,raw.byteOffset,raw.byteLength):null;
    if(!bytes||bytes.byteLength!==file.size||!bytes.length)
      throw Error('입력 PDF의 바이트 수를 확인할 수 없습니다.');
    return bytes;
  }
  async function create(file,rawOptions,opts){
    ensureFiles(file);
    const settings=normalizeOptions(rawOptions);
    if(!opts?.PDFLib?.PDFDocument?.load||!opts.PDFLib.PDFName||!opts.PDFLib.PDFArray)
      throw Error('현재 편집기의 pdf-lib 엔진을 불러오지 못했습니다.');
    checkCancel(opts);
    const bytes=await readBytes(file,opts);
    checkCancel(opts);
    const lib=opts.PDFLib,pdf=await lib.PDFDocument.load(bytes,{updateMetadata:false});
    checkProtected(pdf,lib,bytes);
    const pages=pdf.getPages(),selected=selectPages(settings.pages,pages.length);
    if(selected.length<1)throw Error('변경할 페이지가 선택되지 않았습니다.');
    // Snapshot all pages so selected and untouched geometry is verified.
    const expected=pages.map(snapshot);
    const resultInfo=[];
    for(let i=0;i<selected.length;i++){
      checkCancel(opts);
      const index=selected[i],page=pages[index],before=expected[index];
      if(settings.mode==='crop'){
        const p=cropPlan(before,settings.margins);
        page.setCropBox(p.x,p.y,p.width,p.height);
      } else {
        const p=resizePlan(before,settings);
        page.scaleContent(p.scale,p.scale);
        page.translateContent(p.dx,p.dy);
        page.setSize(p.width,p.height);
        // Complete page-box synchronization; do not accidentally inherit
        // offsets or stale clipping regions from the old page.
        page.setMediaBox(0,0,p.width,p.height);
        page.setCropBox(0,0,p.width,p.height);
        page.setBleedBox(0,0,p.width,p.height);
        page.setTrimBox(0,0,p.width,p.height);
        page.setArtBox(0,0,p.width,p.height);
      }
      expected[index]=snapshot(page);
      resultInfo.push({page:index+1,original:before.boxes.getCropBox,output:expected[index].boxes.getCropBox});
      opts.onProgress?.({done:i+1,total:selected.length,page:index+1,phase:'writing'});
      // Let a browser process Cancel clicks between pages without parallel PDF writes.
      if(i%5===4) await new Promise(resolve=>setTimeout(resolve,0));
    }
    checkCancel(opts);
    opts.onProgress?.({done:selected.length,total:selected.length,phase:'saving'});
    const output=await pdf.save({updateFieldAppearances:false});
    checkCancel(opts);
    if(!ArrayBuffer.isView(output)||output.BYTES_PER_ELEMENT!==1||!output.byteLength)
      throw Error('출력 PDF 저장 결과가 올바르지 않습니다.');
    const verified=await lib.PDFDocument.load(output,{updateMetadata:false});
    verifySnapshots(expected,verified.getPages());
    checkCancel(opts);
    return {bytes:output,mode:settings.mode,pageCount:pages.length,changedPages:selected.length,
      details:resultInfo,filename:file.name.replace(/\.pdf$/i,'')+(settings.mode==='crop'?'_cropped.pdf':'_resized.pdf'),
      warning:settings.mode==='crop'?
        '페이지 표시영역만 변경합니다. 가려진 원본 콘텐츠는 PDF 내부에 남아 있으며 보안 삭제 기능이 아닙니다.':
        '간단한 벡터 페이지의 위치·크기를 변경합니다. 실물 인쇄, 글꼴·도면 축척 등은 별도로 확인해야 합니다.'};
  }
  return {create,normalizeOptions,selectPages,cropPlan,resizePlan,MM_TO_PT,MAX_PAGES};
});
