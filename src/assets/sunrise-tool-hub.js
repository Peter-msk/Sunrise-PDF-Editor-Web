/* Sunrise PDF Editor — searchable tool directory inspired by task-first PDF UX.
 * Original Sunrise UI and logic, independent of third-party PDF24 scripts.
 * Stores only selected tool IDs locally; never stores PDF content or filenames.
 */
(function(root){
  'use strict';
  const FAVORITES='sunrise.pdf.tools.favorite.v1';
  const RECENT='sunrise.pdf.tools.recent.v1';
  const CATEGORY=[
    ['all','전체'],['frequent','자주 사용'],['create','만들기·변환'],
    ['edit','편집·꾸미기'],['organize','페이지 정리'],['optimize','최적화·확인']
  ];
  const TOOLS=Object.freeze([
    {id:'open',label:'PDF 열기',description:'PDF 파일을 선택해 편집기에서 열기',category:'frequent',icon:'fa-folder-open',action:'openPdf',keywords:'업로드 불러오기 문서'},
    {id:'merge',label:'PDF 병합',description:'여러 PDF를 한 파일로 합치기',category:'frequent',icon:'fa-object-group',action:'mergePdf',keywords:'합치기 결합'},
    {id:'split',label:'PDF 일괄 분할',description:'쪽 범위에 따라 PDF를 나누기',category:'organize',icon:'fa-scissors',global:'openBatchPagesModal',keywords:'나누기 추출 batch'},
    {id:'organize',label:'페이지 자유 구성',description:'여러 문서의 쪽을 섞고 회전·복제하기',category:'organize',icon:'fa-layer-group',global:'SunrisePageComposerLaunch',keywords:'순서 교체 재배열 빈페이지'},
    {id:'lossless-compress',label:'무손실 PDF 압축',description:'그림·도면의 해상도·색상을 바꾸지 않고 스트림 재압축',category:'optimize',icon:'fa-box-archive',action:'compressPdfLossless',keywords:'무손실 qpdf 도면 압축'},
    {id:'compress',label:'PDF 압축',description:'저장 옵션으로 용량 최적화하기',category:'optimize',icon:'fa-compress',action:'compressPdf',keywords:'줄이기 용량'},
    {id:'save',label:'다른 이름으로 저장',description:'원본을 보존하고 새 PDF로 저장',category:'frequent',icon:'fa-floppy-disk',action:'saveAs',keywords:'다운로드 보관'},
    {id:'form',label:'별도 PDF 양식 일괄 변경',description:'현재 열린 문서와 분리된 PDF 파일의 필드를 일괄 수정하기',category:'edit',icon:'fa-list-check',global:'SunrisePdfFormToolsLaunch',keywords:'입력 체크박스 드롭다운 필드'},
    {id:'number',label:'페이지 번호 삽입',description:'쪽 번호와 전체 페이지 수 표시',category:'edit',icon:'fa-list-ol',global:'SunrisePdfStampLaunch',arg:'number',keywords:'번호 머리글 바닥글'},
    {id:'watermark',label:'워터마크 삽입',description:'문서에 보이는 문구를 일괄 표시',category:'edit',icon:'fa-stamp',global:'SunrisePdfStampLaunch',arg:'watermark',keywords:'초안 대외비 DRAFT'},
    {id:'metadata',label:'문서 속성 편집',description:'제목·작성자·주제·키워드를 수정',category:'edit',icon:'fa-file-circle-info',global:'SunrisePdfMetadataLaunch',keywords:'정보 메타데이터 키워드'},
    {id:'image',label:'PDF 이미지 추출',description:'PDF에 포함된 이미지 내려받기',category:'create',icon:'fa-image',action:'extractEmbeddedImages',keywords:'그림 PNG'},
    {id:'source-unicode',label:'한글 원문 수정',description:'원문 위치를 선택하고 길이가 다른 문구로 수정',category:'edit',icon:'fa-language',action:'directUnicodeText',keywords:'한글 CID 글꼴 수정'},
    {id:'source-vector',label:'원본 선·곡선 수정',description:'원본 경로 좌표와 해당 도형의 선색·채움·두께 변경',category:'edit',icon:'fa-bezier-curve',action:'editSourceVectorPath',keywords:'벡터 도형 곡선 테두리'},
    {id:'source-rect',label:'원본 사각형 수정',description:'원본 사각형·표 테두리의 로컬 좌표 변경',category:'edit',icon:'fa-vector-square',action:'editSourceRectangle',keywords:'표 도형 벡터 사각형'},
    {id:'word-grid',label:'PDF 표 → Word',description:'명확한 선으로 된 표·병합 셀을 편집 가능하게 복원',category:'create',icon:'fa-table',action:'exportWordGrids',keywords:'병합 셀 docx 표'},
    {id:'word-visual',label:'PDF 모양 → Word',description:'페이지 이미지를 넣어 그림·도형·글꼴 모양 유지',category:'create',icon:'fa-file-image',action:'exportWordVisual',keywords:'이미지 모양 유지 docx'},
    {id:'excel-grid',label:'PDF 표 → Excel',description:'표 선으로 병합 셀을 복원해 페이지별 시트 생성',category:'create',icon:'fa-table-cells',action:'exportExcelGrids',keywords:'병합 셀 xlsx 표'},
    {id:'verify-signature',label:'서명 무결성 검사',description:'RSA CMS 서명과 최종 파일 ByteRange 검사',category:'optimize',icon:'fa-shield-halved',action:'verifyCertificateSignature',keywords:'서명 무결성 검증 CMS'},
    {id:'word',label:'PDF 텍스트 → Word',description:'텍스트 레이어를 DOCX로 내보내기',category:'create',icon:'fa-file-word',action:'exportWordText',keywords:'문서 docx'},
    {id:'excel',label:'PDF 텍스트 → Excel',description:'텍스트 레이어를 XLSX로 내보내기',category:'create',icon:'fa-file-excel',action:'exportExcelText',keywords:'스프레드시트 xlsx'},
    {id:'blank',label:'빈 PDF 만들기',description:'빈 문서를 만들고 편집 시작',category:'create',icon:'fa-file-circle-plus',action:'newBlankDoc',keywords:'생성 새문서'},
    {id:'print',label:'PDF 인쇄',description:'열린 PDF의 인쇄 작업 실행',category:'optimize',icon:'fa-print',action:'printPdf',keywords:'출력 프린터'},
    {id:'visual-sign',label:'시각 서명 표시',description:'인증서가 아닌 서명 표시 삽입',category:'edit',icon:'fa-signature',action:'insertVisualSignature',keywords:'전자서명 아님 이미지 표시'},
    {id:'certificate-sign',label:'인증서 전자서명 (실험)',description:'PEM 또는 P12/PFX RSA 인증서로 CMS 서명 PDF 출력',category:'edit',icon:'fa-file-signature',action:'signWithCertificatePem',keywords:'PKCS8 X509 디지털서명 PEM P12 PFX'},
    {id:'pdf-protect-aes256',label:'PDF 열기 암호 설정 (AES-256 · 실험)',description:'브라우저 QPDF WASM으로 암호 보호 PDF를 별도로 생성',category:'optimize',icon:'fa-lock',action:'protectPdfAes256',keywords:'암호 비밀번호 보호 encryption AES256 잠금'},
    {id:'pdf-unlock',label:'PDF 암호 해제 (실험)',description:'암호를 아는 PDF를 선택해 새 무암호 PDF 파일로 저장',category:'optimize',icon:'fa-lock-open',action:'unlockPdfPassword',keywords:'암호 해제 unlock 복호화 비밀번호'},
    {id:'batch-preflight',label:'PDF 일괄 품질검사',description:'여러 PDF의 제출 전 확인 결과를 CSV로 정리',category:'optimize',icon:'fa-clipboard-check',global:'SunriseBatchPreflightLaunch',keywords:'품질 구조 검사 보고서'},
    {id:'images-to-pdf',label:'이미지를 PDF로',description:'사진·그림을 정렬해 PDF 만들기',category:'create',icon:'fa-images',global:'SunriseImagesToPdfLaunch',keywords:'jpg png webp 사진 변환'},
    {id:'pdf-to-images',label:'PDF를 이미지로',description:'PDF 페이지를 PNG·JPG로 변환',category:'create',icon:'fa-file-image',global:'SunrisePdfToImagesLaunch',keywords:'PNG JPG DPI ZIP 이미지 추출'},
    {id:'crop-pdf',label:'PDF 페이지 자르기',description:'상하좌우 재단 영역 지정',category:'organize',icon:'fa-crop-simple',global:'SunrisePdfPageCropLaunch',keywords:'자르기 재단 CropBox'},
    {id:'resize-pdf',label:'PDF 페이지 크기',description:'A3·A4·사용자 크기로 페이지 규격 조절',category:'organize',icon:'fa-maximize',global:'SunrisePdfPageResizeLaunch',keywords:'크기 여백 용지 변경'},
    {id:'pdf-nup',label:'PDF 모아찍기',description:'여러 페이지를 한 장에 배치',category:'organize',icon:'fa-table-cells',global:'SunrisePdfNupLaunch',keywords:'n-up 모아찍기 2 4 6 9 16'},
    {id:'overlay-pdf',label:'PDF 겹치기',description:'PDF를 전경·배경에 겹쳐 배치',category:'edit',icon:'fa-layer-group',global:'SunrisePdfOverlayLaunch',keywords:'오버레이 편지지 배경'},
    {id:'pdf-visual-compare',label:'PDF 시각적 비교',description:'두 PDF의 페이지 차이 이미지·보고서',category:'optimize',icon:'fa-code-compare',global:'SunrisePdfVisualCompareLaunch',keywords:'차이 비교 문서 픽셀 도면'}
  ]);
  const byId=Object.fromEntries(TOOLS.map(x=>[x.id,x]));
  const $=id=>document.getElementById(id);
  const el=(tag,cls,content)=>{
    const node=document.createElement(tag);
    if(cls)node.className=cls;
    if(content!==undefined)node.textContent=content;
    return node;
  };
  function storageRead(key){
    try{
      const entries=JSON.parse(root.localStorage.getItem(key)||'[]');
      return Array.isArray(entries)?entries.filter(x=>typeof x==='string'&&byId[x]).slice(0,24):[];
    }catch{return [];}
  }
  function storageWrite(key,items){
    try{root.localStorage.setItem(key,JSON.stringify(items));}catch{/* private mode */}
  }
  function activate(item){
    try{
      // Preserve user gesture for native mobile file chooser.
      let call;
      if(item.global)call=root[item.global];
      else if(item.action)call=()=>root.executeCommand(item.action);
      if(typeof call!=='function')throw new Error('이 기능은 아직 현재 편집기에 연결되지 않았습니다.');
      if(typeof root.closeModal==='function')root.closeModal();
      // Execute synchronously under the user's click, even if action is async.
      const response=call(item.arg);
      if(response?.catch)response.catch(error=>notify(error?.message||'도구 실행에 실패했습니다.'));
      const recent=[item.id,...storageRead(RECENT).filter(id=>id!==item.id)].slice(0,8);
      storageWrite(RECENT,recent);
    }catch(error){notify(error.message||'기능을 실행할 수 없습니다.');}
  }
  function notify(message){
    if(typeof root.showToast==='function')root.showToast(message,'fa-circle-exclamation');
    else if(root.console)root.console.warn('[Sunrise PDF Tools]',message);
  }
  function stylesheet(){
    if($('sunriseToolHubStyle'))return;
    const style=el('style');style.id='sunriseToolHubStyle';
    style.textContent=`
      .sunrise-tool-toolbar { display:flex; gap:8px; align-items:center; flex-wrap:wrap; margin:12px 0; }
      .sunrise-tool-search { flex:1 1 220px; min-width:0; min-height:44px; padding:9px 12px; border:1px solid var(--border,#ccd4dc); border-radius:9px; background:var(--surface,#fff); color:var(--text,#263746); font-size:16px; }
      .sunrise-tool-categories { display:flex; flex-wrap:wrap; gap:6px; padding-bottom:10px; }
      .sunrise-tool-categories button { border:1px solid var(--border,#ccd4dc); color:var(--text,#263746); background:var(--surface,#fff); padding:7px 10px; border-radius:999px; min-height:40px; cursor:pointer; }
      .sunrise-tool-categories button[aria-pressed=true] { border-color:var(--primary,#147d73); color:var(--primary,#147d73); background:var(--primary-soft,#eaf6f4); font-weight:700; }
      .sunrise-tools-grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(min(100%,180px),1fr)); gap:10px; }
      .sunrise-tool-card { position:relative; min-height:112px; border:1px solid var(--border,#cbd5dd); border-radius:12px; background:var(--surface,#fff); padding:12px 12px 10px; display:flex; flex-direction:column; gap:5px; }
      .sunrise-tool-card button.sunrise-tool-launch { display:flex; align-items:flex-start; gap:10px; width:100%; border:0; background:transparent; color:var(--text,#263746); text-align:left; cursor:pointer; padding:0 28px 0 0; min-height:54px; }
      .sunrise-tool-card i { font-size:18px; color:var(--primary,#147d73); flex-shrink:0; margin-top:3px; }
      .sunrise-tool-title { font-weight:700; font-size:13px; }
      .sunrise-tool-description { font-size:11px; line-height:1.55; color:var(--text-muted,#687b8b); }
      .sunrise-tool-star { position:absolute; top:9px; right:7px; border:0; background:transparent; color:var(--text-muted,#687b8b); font-size:17px; width:38px; height:38px; cursor:pointer; }
      .sunrise-tool-star[aria-pressed=true] { color:#b78c18; }
      .sunrise-tool-card:focus-within { outline:2px solid var(--primary,#147d73); outline-offset:1px; }
      .sunrise-tool-count { font-size:12px; color:var(--text-muted,#687b8b); margin:8px 0; }
      @media(max-width:600px){.sunrise-tools-grid { grid-template-columns:repeat(2,minmax(0,1fr)); gap:8px; } .sunrise-tool-card { padding:10px; min-height:120px; } .sunrise-tool-title { font-size:12px; } }
      @media(max-width:345px){.sunrise-tools-grid { grid-template-columns:1fr; }}
    `;
    document.head.append(style);
  }
  function buildDirectory(host,{modal=false}={}){
    stylesheet();
    host.replaceChildren();
    const toolbar=el('div','sunrise-tool-toolbar');
    const search=el('input','sunrise-tool-search');search.type='search';search.placeholder='예: 병합, 분할, 워터마크';
    search.setAttribute('aria-label','PDF 도구 검색');
    const filterFav=el('button','dialog-btn','★ 즐겨찾기');
    filterFav.type='button';filterFav.setAttribute('aria-pressed','false');
    const filterRecent=el('button','dialog-btn','최근 사용');
    filterRecent.type='button';filterRecent.setAttribute('aria-pressed','false');
    toolbar.append(search,filterFav,filterRecent);
    const categoryHost=el('div','sunrise-tool-categories');
    categoryHost.setAttribute('role','group');categoryHost.setAttribute('aria-label','도구 분류');
    const count=el('p','sunrise-tool-count');
    const grid=el('div','sunrise-tools-grid');
    const empty=el('p','sunrise-tool-count');
    const state={category:'all',favorites:false,recent:false};
    const buttons=new Map();
    function draw(){
      grid.replaceChildren();
      const q=search.value.trim().toLocaleLowerCase();
      const favoriteIds=storageRead(FAVORITES),recentIds=storageRead(RECENT);
      let tools=TOOLS.filter(t=>{
        if(state.favorites&&!favoriteIds.includes(t.id))return false;
        if(state.recent&&!recentIds.includes(t.id))return false;
        if(state.category==='frequent'&&!(t.category==='frequent'||favoriteIds.includes(t.id)))return false;
        if(state.category!=='all'&&state.category!=='frequent'&&t.category!==state.category)return false;
        return !q||`${t.label} ${t.description} ${t.keywords}`.toLocaleLowerCase().includes(q);
      });
      if(state.recent)tools=tools.sort((a,b)=>recentIds.indexOf(a.id)-recentIds.indexOf(b.id));
      count.textContent=`${tools.length}개 도구 · 검색/즐겨찾기 설정만 이 기기에 저장`;empty.textContent='검색 조건에 맞는 도구가 없습니다.';
      empty.hidden=tools.length!==0;
      for(const tool of tools){
        const card=el('div','sunrise-tool-card');
        const launch=el('button','sunrise-tool-launch');launch.type='button';
        const icon=el('i',`fa-solid ${tool.icon}`);icon.setAttribute('aria-hidden','true');
        const descriptions=el('span');
        descriptions.append(el('span','sunrise-tool-title',tool.label),el('div','sunrise-tool-description',tool.description));
        launch.append(icon,descriptions);launch.addEventListener('click',()=>{
          if(modal||typeof root.executeCommand==='function')activate(tool);
          else root.location.href=`/editor/?sunriseTool=${encodeURIComponent(tool.id)}`;
        });
        const star=el('button','sunrise-tool-star',favoriteIds.includes(tool.id)?'★':'☆');
        star.type='button';star.setAttribute('aria-label',`${tool.label} 즐겨찾기`);
        star.setAttribute('aria-pressed',String(favoriteIds.includes(tool.id)));
        star.addEventListener('click',()=>{
          const ids=storageRead(FAVORITES);
          storageWrite(FAVORITES,ids.includes(tool.id)?ids.filter(x=>x!==tool.id):[...ids,tool.id]);
          draw();
        });
        card.append(launch,star);grid.append(card);
      }
    }
    for(const [id,label] of CATEGORY){
      const button=el('button','',label);button.type='button';
      button.setAttribute('aria-pressed',String(state.category===id));
      button.addEventListener('click',()=>{
        state.category=id;
        for(const [kind,btn] of buttons)btn.setAttribute('aria-pressed',String(kind===id));
        draw();
      });
      buttons.set(id,button);categoryHost.append(button);
    }
    search.addEventListener('input',draw);
    filterFav.addEventListener('click',()=>{
      state.favorites=!state.favorites;state.recent=false;
      filterFav.setAttribute('aria-pressed',String(state.favorites));
      filterRecent.setAttribute('aria-pressed','false');draw();
    });
    filterRecent.addEventListener('click',()=>{
      state.recent=!state.recent;state.favorites=false;
      filterFav.setAttribute('aria-pressed','false');
      filterRecent.setAttribute('aria-pressed',String(state.recent));draw();
    });
    host.append(toolbar,categoryHost,count,grid,empty);
    draw();return {focus:()=>search.focus()};
  }
  function launch(){
    if(typeof root.openModal!=='function')return;
    root.openModal({title:'Sunrise PDF 모든 도구',icon:'fa-grip',width:'960px',
      bodyHtml:'<p>원하는 PDF 작업을 찾거나 즐겨찾기할 수 있습니다. 파일 내용은 저장하지 않습니다.</p><div id="sunriseToolDirectory"></div>',
      footerHtml:'<div></div><div class="modal-footer-right"><button id="sunriseToolHubClose" class="dialog-btn" type="button">닫기</button></div>',
      onMount:()=>{
        buildDirectory($('sunriseToolDirectory'),{modal:true});
        $('sunriseToolHubClose')?.addEventListener('click',root.closeModal);
      }
    });
  }
  function mount(){
    stylesheet();
    const save=$('quickOpenBtn');
    if(save&&!$('sunriseToolHubQuick')){
      const button=el('button','quick-icon-btn');button.id='sunriseToolHubQuick';button.type='button';
      button.title='모든 PDF 도구';button.setAttribute('aria-label','모든 PDF 도구');
      const icon=el('i','fa-solid fa-grip');icon.setAttribute('aria-hidden','true');button.append(icon);
      button.addEventListener('click',launch);save.insertAdjacentElement('afterend',button);
    }
    const mobile=$('mobFileBtn');
    if(mobile){mobile.addEventListener('click',()=>root.queueMicrotask?.(()=>{
      const menu=$('mobileFileMerge');if(!menu||$('sunriseToolHubMobile'))return;
      const button=el('button','dialog-btn','모든 PDF 도구');button.id='sunriseToolHubMobile';button.type='button';
      button.addEventListener('click',()=>{root.closeModal?.();launch();});
      menu.insertAdjacentElement('afterend',button);
    }));}
    const landing=$('sunriseToolDirectoryLanding');
    if(landing)buildDirectory(landing);
    const selected=new URLSearchParams(root.location?.search||'').get('sunriseTool');
    if(selected&&byId[selected]&&typeof root.executeCommand==='function'){
      if (document.readyState === 'complete') root.setTimeout(()=>activate(byId[selected]),0);
      else root.addEventListener?.('load',()=>root.setTimeout(()=>activate(byId[selected]),0),{once:true});
    }
  }
  root.SunriseToolHub={launch,renderDirectory:buildDirectory,getCatalog:()=>TOOLS.slice()};
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',mount,{once:true});
  else mount();
})(typeof window!=='undefined'?window:globalThis);
