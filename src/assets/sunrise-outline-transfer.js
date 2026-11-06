// USR-01/02: conservative transfer of standard PDF outline destinations.
// Works only with direct page targets; never silently drop unsupported actions.
(function(root,factory){
 const api=factory();
 if(typeof module==='object'&&module.exports)module.exports=api;
 if(root)root.SunriseOutlineTransfer=api;
})(typeof globalThis!=='undefined'?globalThis:undefined,function(){
 'use strict';
 const MAX=2000,MAX_DEPTH=32;
 function read(pdf,lib){
  const {PDFName,PDFRef,PDFDict,PDFArray,PDFNumber,PDFString,PDFHexString}=lib;
  const n=PDFName.of,ctx=pdf.context,rootRef=pdf.catalog.get(n('Outlines'));
  if(!rootRef)return [];
  if(!(rootRef instanceof PDFRef))throw Error('원본 PDF 북마크 루트 참조를 지원하지 않습니다.');
  const root=ctx.lookup(rootRef);
  if(!(root instanceof PDFDict))throw Error('원본 PDF 북마크 루트 구조가 올바르지 않습니다.');
  const pageRefs=new Map(pdf.getPages().map((page,index)=>[page.ref.toString(),index]));
  const visited=new Set(),items=[];
  const loadRef=ref=>{
   if(!(ref instanceof PDFRef))throw Error('원본 북마크 참조가 올바르지 않습니다.');
   const obj=ctx.lookup(ref);
   if(!(obj instanceof PDFDict))throw Error('원본 북마크 객체가 올바르지 않습니다.');
   return obj;
  };
  const destination=dict=>{
   const action=dict.get(n('A')),direct=dict.get(n('Dest'));
   if(action&&direct)throw Error('모호한 북마크 목적지를 가진 문서는 지원하지 않습니다.');
   let value=direct;
   if(action){
    const d=ctx.lookup(action);
    if(!(d instanceof PDFDict)||d.get(n('S'))?.toString()!=='/GoTo'||d.has(n('Next')))
     throw Error('외부 링크·스크립트 등 지원하지 않는 북마크 동작이 있습니다.');
    value=d.get(n('D'));
   }
   if(!value)throw Error('목적지가 없는 북마크는 자동 이식할 수 없습니다.');
   let dest=ctx.lookup(value);
   if(dest instanceof PDFName||dest instanceof PDFString||dest instanceof PDFHexString){
    const key=dest.decodeText?.()||dest.toString().slice(1);
    const legacy=ctx.lookup(pdf.catalog.get(n('Dests')));
    let named=legacy instanceof PDFDict?legacy.get(n(key)):null;
    const names=ctx.lookup(pdf.catalog.get(n('Names'))),tree=names instanceof PDFDict?names.get(n('Dests')):null;
    const seen=new Set();
    const visitNames=(raw,depth)=>{
     if(!raw||depth>20||seen.size>4000)throw Error('이름 목적지 트리가 너무 깊거나 큽니다.');
     const node=ctx.lookup(raw);if(!(node instanceof PDFDict)||seen.has(node))throw Error('이름 목적지 트리에 순환 또는 오류가 있습니다.');seen.add(node);
     const pairs=ctx.lookup(node.get(n('Names'))),kids=ctx.lookup(node.get(n('Kids')));
     if(pairs){
      if(!(pairs instanceof PDFArray)||pairs.size()%2||pairs.size()>8000)throw Error('이름 목적지 목록이 올바르지 않습니다.');
      for(let i=0;i<pairs.size();i+=2){const label=ctx.lookup(pairs.get(i));if(!(label instanceof PDFString||label instanceof PDFHexString))throw Error('이름 목적지 키를 읽지 못했습니다.');if(label.decodeText()===key){if(named)throw Error('중복된 이름 목적지가 있습니다.');named=pairs.get(i+1);}}
     }
     if(kids){if(!(kids instanceof PDFArray)||kids.size()>4000)throw Error('이름 목적지 하위 트리가 올바르지 않습니다.');for(let i=0;i<kids.size();i++)visitNames(kids.get(i),depth+1);}
    };
    if(tree)visitNames(tree,0);
    if(!named)throw Error('북마크의 이름 목적지를 찾지 못했습니다.');
    dest=ctx.lookup(named);if(dest instanceof PDFDict)dest=ctx.lookup(dest.get(n('D')));
   }
   if(!(dest instanceof PDFArray)||dest.size()<2)
    throw Error('이름 기반 또는 특수 목적지의 북마크를 자동 이식할 수 없습니다.');
   const mode=dest.get(1)?.toString(),counts={'/XYZ':5,'/Fit':2,'/FitH':3,'/FitV':3,'/FitR':6,'/FitB':2,'/FitBH':3,'/FitBV':3};
   if(!counts[mode]||dest.size()!==counts[mode])throw Error('지원하지 않는 북마크 보기 목적지입니다.');
   const view=[mode.slice(1)];
   for(let i=2;i<dest.size();i++){
    const item=ctx.lookup(dest.get(i));
    if(item instanceof PDFNumber&&Number.isFinite(item.asNumber()))view.push(item.asNumber());
    else if(item?.toString()==='null'&&mode!=='/FitR')view.push(null);
    else throw Error('북마크 보기 좌표가 올바르지 않습니다.');
   }
   const target=page=>({page,...(mode!=='/Fit'?{destinationView:view}:{})});
   const first=dest.get(0);
   if(first instanceof PDFRef){
    const page=pageRefs.get(first.toString());
    if(page===undefined)throw Error('존재하지 않는 페이지를 가리키는 북마크가 있습니다.');
    return target(page);
   }
   if(first instanceof PDFNumber){
    const page=first.asNumber();
    if(Number.isSafeInteger(page)&&page>=0&&page<pdf.getPageCount())return target(page);
   }
   throw Error('북마크의 페이지 참조가 올바르지 않습니다.');
  };
  const visit=(first,last,parentRef,level)=>{
   if(!first&&!last)return;
   if(!first||!last||level>=MAX_DEPTH)throw Error('북마크 계층 또는 깊이를 지원하지 않습니다.');
   let ref=first,previous=null,lastSeen=null;
   while(ref){
    const key=ref.toString();
    if(visited.has(key)||visited.size>=MAX)throw Error('순환 또는 과다한 북마크를 지원하지 않습니다.');
    visited.add(key);
    const dict=loadRef(ref);
    if(dict.get(n('Parent'))?.toString()!==parentRef.toString())
     throw Error('북마크 상위 참조가 올바르지 않습니다.');
    if((dict.get(n('Prev'))?.toString()||null)!==(previous?.toString()||null))
     throw Error('북마크 형제 참조가 올바르지 않습니다.');
    const title=ctx.lookup(dict.get(n('Title')));
    if(!(title instanceof PDFString||title instanceof PDFHexString))
     throw Error('북마크 제목을 읽을 수 없습니다.');
    const label=title.decodeText();
    if(!label.trim()||label.length>500)throw Error('북마크 제목 길이를 지원하지 않습니다.');
    const target=destination(dict);
    items.push({title:label,...target,level});
    visit(dict.get(n('First')),dict.get(n('Last')),ref,level+1);
    previous=ref;lastSeen=ref;ref=dict.get(n('Next'));
   }
   if(lastSeen?.toString()!==last.toString())throw Error('북마크 마지막 참조가 올바르지 않습니다.');
  };
  visit(root.get(n('First')),root.get(n('Last')),rootRef,0);
  return items;
 }
 function subset(items,sourceIndices,offset=0){
  if(!Array.isArray(items)||!Array.isArray(sourceIndices)||!Number.isSafeInteger(offset)||offset<0)
   throw Error('북마크 페이지 매핑이 올바르지 않습니다.');
  const map=new Map();
  sourceIndices.forEach((page,index)=>{
   if(!Number.isSafeInteger(page)||page<0||map.has(page))
    throw Error('중복되거나 잘못된 추출 페이지가 있습니다.');
   map.set(page,index+offset);
  });
  const result=[];
  for(const item of items){
   if(!map.has(item.page))continue;
   const level=Math.min(item.level,result.length?result[result.length-1].level+1:0);
   result.push({...item,title:item.title,page:map.get(item.page),level});
  }
  return result;
 }
 return {read,subset};
});
