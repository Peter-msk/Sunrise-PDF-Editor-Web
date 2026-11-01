// Heuristic bookmarks using ONLY existing PDF text objects. No OCR or image recognition.
// All proposed destinations are the physical pages that contain the detected headings.
(function(root,make){
 const api=make();
 if(typeof module==='object'&&module.exports)module.exports=api;
 if(root)root.SunriseAutoBookmarks=api;
})(typeof globalThis!=='undefined'?globalThis:undefined,function(){
 'use strict';
 const numbered=/^(?:(?:제\s*\d+\s*[장절항편])|(?:\d+(?:\.\d+){0,3}[.)]?))\s*\S/;
 const nonTitle=/^(?:\d+|page\s*\d+|쪽\s*\d+|\d+\s*\/\s*\d+)$/i;
 const tidy=value=>String(value||'').replace(/\s+/g,' ').trim();
 function getLines(items){
  const rows=[];
  for(const item of Array.isArray(items)?items:[]){
   const raw=tidy(item?.str),t=item?.transform;
   if(!raw||!Array.isArray(t)||t.length<6||!Number.isFinite(t[5]))continue;
   const x=Number(t[4]),y=Number(t[5]);
   if(!Number.isFinite(x))continue;
   const size=Number(item.height)||Math.hypot(Number(t[2])||0,Number(t[3])||0);
   if(!Number.isFinite(size)||size<=0)continue;
   let line=rows.find(r=>Math.abs(r.y-y)<=Math.min(3,Math.max(1,size*.2)));
   if(!line){line={y,parts:[],size:0};rows.push(line)}
   line.parts.push({x,text:raw});line.size=Math.max(line.size,size);
  }
  return rows.map(r=>({text:tidy(r.parts.sort((a,b)=>a.x-b.x).map(p=>p.text).join(' ')),size:r.size,y:r.y}))
   .filter(r=>r.text).sort((a,b)=>b.y-a.y);
 }
 function headingCandidates(items){
  const lines=getLines(items);
  if(!lines.length)return [];
  const sizes=lines.map(x=>x.size).sort((a,b)=>a-b);
  const median=sizes[Math.floor(sizes.length/2)];
  const maxY=lines[0].y,minY=lines[lines.length-1].y;
  // Inspect upper 42% of the actual text region, not page footer/body.
  const limit=maxY-Math.max(30,(maxY-minY)*.42);
  const matches=[];
  for(const row of lines){
   if(row.y<limit)break;
   const title=row.text;
   if(title.length<4||title.length>100||nonTitle.test(title))continue;
   const strong=row.size>=Math.max(11,median*1.2);
   const numberedTitle=numbered.test(title)&&row.size>=median*.85;
   if(strong||numberedTitle){matches.push(title);if(matches.length>=4)break;}
  }
  return matches;
 }

 // Only explicit numbering establishes a hierarchy. Ambiguous/unnumbered titles
 // remain top-level; never infer a destination from a printed TOC page number.
 function inferLevel(title){
  const text=tidy(title);
  if(/^제\s*\d+\s*(?:편|장)(?:\s|$)/.test(text))return 0;
  if(/^제\s*\d+\s*절(?:\s|$)/.test(text))return 1;
  if(/^제\s*\d+\s*항(?:\s|$)/.test(text))return 2;
  if(/^제\s*\d+\s*목(?:\s|$)/.test(text))return 3;
  const numberedPath=text.match(/^(\d+(?:\.\d+){0,3})(?:\.\s+|\s+|\)\s*)\S/);
  if(numberedPath)return Math.min(3,numberedPath[1].split('.').length-1);
  return 0;
 }
 // An outline cannot start with a child, skip a parent level, or exceed level 3.
 // Normalize copied/reordered/deleted pending items deterministically.
 function normalizeLevels(bookmarks){
  if(!Array.isArray(bookmarks))throw Error('북마크 목록 형식이 올바르지 않습니다.');
  let previous=0;
  return bookmarks.map((item,index)=>{
   const requested=Number.isInteger(item?.level)?item.level:0;
   const level=Math.min(3,Math.max(0,Math.min(requested,index?previous+1:0)));
   previous=level;
   return {...item,level};
  });
 }
 function changeLevel(bookmarks,index,direction){
  if(!Number.isInteger(index)||index<0||index>=bookmarks.length||![-1,1].includes(direction))
   throw Error('북마크 들여쓰기 대상이 올바르지 않습니다.');
  const next=normalizeLevels(bookmarks);
  const old=next[index].level;
  const max=index?Math.min(3,next[index-1].level+1):0;
  const desired=old+direction;
  if(desired<0||desired>max)return null;
  next[index].level=desired;
  return normalizeLevels(next);
 }
 function chooseHeading(items){return headingCandidates(items)[0]||null;}
 function suggestBookmarks(pageRecords,maxItems=100){
  if(!Array.isArray(pageRecords))throw Error('페이지 배열이 올바르지 않습니다.');
  const limit=Math.max(1,Math.min(100,Number.isInteger(maxItems)?maxItems:100));
  const candidates=pageRecords.map((p,i)=>({titles:headingCandidates(p?.items),page:Number.isInteger(p?.pageIndex)?p.pageIndex:i}))
   .filter(x=>x.titles.length&&Number.isInteger(x.page)&&x.page>=0);
  const frequency=new Map();
  for(const x of candidates)for(const title of new Set(x.titles)){
   const key=title.toLocaleLowerCase();frequency.set(key,(frequency.get(key)||0)+1);
  }
  // If a repeated running header precedes the real section heading, skip
  // the repeated text and select the first unique heading on that page.
  return normalizeLevels(candidates.map(x=>({title:x.titles.find(t=>frequency.get(t.toLocaleLowerCase())===1),page:x.page}))
   .filter(x=>x.title).map(x=>({...x,level:inferLevel(x.title)})).slice(0,limit));
 }
 return {chooseHeading,suggestBookmarks,getLines,inferLevel,normalizeLevels,changeLevel};
});
