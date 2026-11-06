// Local PDF review CSV. Deliberately independent of the document/UI lifecycle.
(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.SunriseCommentReport=api;
})(typeof globalThis!=='undefined'?globalThis:undefined,function(){
  'use strict';
  const MAX_ITEMS=5000, MAX_TEXT=2000;
  function cell(value){
    let text=String(value??'').slice(0,MAX_TEXT).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g,' ');
    // Prevent spreadsheet formula injection from PDF-provided annotation contents.
    if(/^[\s\u200b-\u200d\ufeff]*[=+\-@]/u.test(text))text="'"+text;
    return '"'+text.replaceAll('"','""')+'"';
  }
  function createCsv(overlays, native){
    if(!Array.isArray(overlays)||!Array.isArray(native)||
       overlays.length+native.length>MAX_ITEMS)throw new Error('검토 의견 항목이 너무 많습니다.');
    const rows=[['페이지','유형','내용','X좌표','Y좌표','출처']];
    for(const item of overlays){
      if(!Number.isSafeInteger(item.pageIndex)||item.pageIndex<0)throw new Error('삽입 항목 페이지가 올바르지 않습니다.');
      rows.push([item.pageIndex+1,String(item.type||'').slice(0,80),
        String(item.text||''),Number.isFinite(item.x)?item.x:'',Number.isFinite(item.y)?item.y:'','Sunrise 삽입']);
    }
    for(const item of native){
      if(!Number.isSafeInteger(item.pageIndex)||item.pageIndex<0||
        !['Text','Highlight','Underline','StrikeOut','Squiggly','Square','Circle'].includes(item.subtype))throw new Error('원본 PDF 주석 정보가 올바르지 않습니다.');
      rows.push([item.pageIndex+1,'원본 '+({Text:'메모',Highlight:'형광펜',Underline:'밑줄',StrikeOut:'취소선',Squiggly:'물결선',Square:'사각형',Circle:'원형'}[item.subtype]||item.subtype),
        String(item.text||''),'','','원본 PDF']);
    }
    return '\uFEFF'+rows.map(row=>row.map(cell).join(',')).join('\r\n')+'\r\n';
  }
  return {createCsv,cell};
});
