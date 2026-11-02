/* Sunrise PDF Editor (Web) — LOCAL-09 crop / page size UI.
 * Uses existing Sunrise modal and browser-local pdf-lib. No server I/O.
 */
(function(root){
  'use strict';
  // B09: shared download validation / MIME handling; old bridge still works if absent.
  const downloadLocal = (...args) => typeof root.SunriseLocalUI?.download === 'function'
    ? root.SunriseLocalUI.download(...args) : root.downloadBytes(...args);
  // Optional telemetry: local PDF work still runs without the telemetry script.
  const runTracked = typeof root.SunriseLocalMetrics?.track === 'function'
    ? root.SunriseLocalMetrics.track
    : (_feature, operation) => Promise.resolve().then(operation);
  if(!root?.document)return;
  const document=root.document;
  const $=id=>document.getElementById(id);
  const el=(tag,text,cls)=>{
    const n=document.createElement(tag);
    if(text!==undefined)n.textContent=text;
    if(cls)n.className=cls;
    return n;
  };
  function warn(message){
    if(typeof root.showToast==='function')root.showToast(message,'fa-circle-exclamation');
    else root.console?.warn('[Sunrise Geometry]',message);
  }
  function injectStyle(){
    if($('sunrisePageGeometryStyle'))return;
    const style=el('style');style.id='sunrisePageGeometryStyle';
    style.textContent=`
      .sun-geo-grid { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:10px; margin:12px 0; }
      .sun-geo-grid label { display:block; font-weight:600; font-size:12px; margin-bottom:5px; }
      .sun-geo-grid input,.sun-geo-grid select { width:100%; min-height:43px; border:1px solid var(--border,#c7d1da); border-radius:8px; padding:8px; background:var(--surface,#fff); color:var(--text,#263746); font-size:14px; }
      .sun-geo-alert { border:1px solid var(--border,#c7d1da); background:var(--surface-soft,#f7f9fb); border-radius:8px; padding:11px; margin:12px 0; line-height:1.6; font-size:12px; color:var(--text-muted,#647687); }
      .sun-geo-status { background:var(--primary-soft,#dceaf5); padding:10px; border-radius:8px; line-height:1.5; min-height:42px; overflow-wrap:anywhere; margin:10px 0; }
      .sun-geo-status progress { display:block; margin-top:7px; width:100%; }
      .sun-geo-download button { padding:12px 15px; width:100%; min-height:45px; }
      @media(max-width:530px){.sun-geo-grid{grid-template-columns:1fr;}}
    `;
    document.head.append(style);
  }
  function launch(mode='crop'){
    const core=root.SunrisePdfPageGeometry;
    if(!core?.create||!root.PDFLib?.PDFDocument||
      typeof root.openModal!=='function'||typeof root.closeModal!=='function'||
      typeof root.downloadBytes!=='function'){
      warn('페이지 자르기/크기 변경 엔진 또는 편집기 UI 연결이 필요합니다.');return;
    }
    const startMode=mode==='resize'?'resize':'crop';
    injectStyle();
    root.openModal({
      title:'PDF 자르기 · 페이지 크기 변경',icon:'fa-crop-simple',width:'750px',
      bodyHtml:`
        <p>PDF 페이지 표시 영역을 자르거나 페이지 크기를 통일합니다. <strong>파일 내용은 서버로 전송하지 않습니다.</strong></p>
        <label for="sunGeoFile">작업할 PDF (1개, 최대 200쪽)</label>
        <input id="sunGeoFile" type="file" accept=".pdf,application/pdf" style="display:block;width:100%;min-height:42px;margin:8px 0">
        <div class="sun-geo-grid">
          <div><label for="sunGeoMode">작업 방식</label>
            <select id="sunGeoMode"><option value="crop">페이지 여백 자르기</option><option value="resize">페이지 크기 변경</option></select></div>
          <div><label for="sunGeoPages">적용 페이지 (전체 또는 1-3,5)</label><input id="sunGeoPages" type="text" value="all" maxlength="160" autocomplete="off"></div>
        </div>
        <div id="sunGeoCropFields">
          <p class="sun-geo-alert">화면에서 보이는 페이지의 가장자리 기준으로 자릅니다. 실제 콘텐츠는 PDF 내부에 남습니다. <strong>민감정보를 지우는 기능이 아닙니다.</strong></p>
          <div class="sun-geo-grid">
            <div><label for="sunGeoTop">위쪽 제거 (mm)</label><input id="sunGeoTop" type="number" min="0" max="150" step="0.1" value="5"></div>
            <div><label for="sunGeoBottom">아래쪽 제거 (mm)</label><input id="sunGeoBottom" type="number" min="0" max="150" step="0.1" value="5"></div>
            <div><label for="sunGeoLeft">왼쪽 제거 (mm)</label><input id="sunGeoLeft" type="number" min="0" max="150" step="0.1" value="5"></div>
            <div><label for="sunGeoRight">오른쪽 제거 (mm)</label><input id="sunGeoRight" type="number" min="0" max="150" step="0.1" value="5"></div>
          </div>
        </div>
        <div id="sunGeoResizeFields" hidden>
          <p class="sun-geo-alert">A3/A4 등 혼합 페이지 크기를 통일합니다. 원본이 회전하지 않은 단순 페이지에서만 벡터 콘텐츠 크기·위치를 변경합니다. 복잡한 PDF는 보호를 위해 거부합니다.</p>
          <div class="sun-geo-grid">
            <div><label for="sunGeoPreset">페이지 크기</label><select id="sunGeoPreset"><option value="a4">A4</option><option value="a3">A3</option><option value="letter">Letter</option><option value="legal">Legal</option><option value="custom">사용자 지정</option></select></div>
            <div><label for="sunGeoOrientation">페이지 방향</label><select id="sunGeoOrientation"><option value="auto">원본 방향에 맞춤</option><option value="portrait">세로</option><option value="landscape">가로</option></select></div>
            <div><label for="sunGeoWidth">사용자 너비 (mm)</label><input id="sunGeoWidth" type="number" min="30" max="1500" step="0.1" value="210" disabled></div>
            <div><label for="sunGeoHeight">사용자 높이 (mm)</label><input id="sunGeoHeight" type="number" min="30" max="1500" step="0.1" value="297" disabled></div>
            <div><label for="sunGeoMargin">용지 여백 (mm)</label><input id="sunGeoMargin" type="number" min="0" max="100" step="0.5" value="5"></div>
            <div><label for="sunGeoFit">원본 배치</label><select id="sunGeoFit"><option value="fit">용지에 맞추기(확대 허용)</option><option value="shrink">큰 페이지만 축소</option></select></div>
          </div>
        </div>
        <div id="sunGeoStatus" class="sun-geo-status" role="status" aria-live="polite">PDF를 선택하고 설정해 주세요.<progress id="sunGeoProgress" value="0" max="1" hidden></progress></div>
        <div id="sunGeoOutput" class="sun-geo-download"></div>
        <p class="sun-geo-alert">기존 PDF의 서명·양식·주석·목차·첨부·복잡한 페이지 구조를 무리하게 변경하지 않습니다. 선택한 PDF는 원본 그대로 남고, 결과 PDF를 새 이름으로 다운로드합니다.</p>`,
      footerHtml:`<div></div><div class="modal-footer-right"><button id="sunGeoRun" type="button" class="dialog-btn primary">새 PDF 만들기</button><button id="sunGeoClose" type="button" class="dialog-btn">닫기</button></div>`,
      onMount:()=>{
        const file=$('sunGeoFile'),modeSelect=$('sunGeoMode'),pages=$('sunGeoPages');
        const crop=$('sunGeoCropFields'),resize=$('sunGeoResizeFields'),preset=$('sunGeoPreset');
        const customW=$('sunGeoWidth'),customH=$('sunGeoHeight');
        const run=$('sunGeoRun'),close=$('sunGeoClose');
        const status=$('sunGeoStatus'),progress=$('sunGeoProgress'),output=$('sunGeoOutput');
        const controls=[file,modeSelect,pages,preset,customW,customH,
          $('sunGeoTop'),$('sunGeoBottom'),$('sunGeoLeft'),$('sunGeoRight'),
          $('sunGeoOrientation'),$('sunGeoMargin'),$('sunGeoFit')];
        let busy=false,stop=false,generation=0;
        const visible=()=>document.contains(run);
        const tell=s=>{const node=status.firstChild;if(node?.nodeType===3)node.textContent=s;else status.insertBefore(document.createTextNode(s),progress);};
        const invalidate=()=>{generation++;output.replaceChildren();tell('설정이 변경되었습니다. 새 PDF 만들기를 눌러 주세요.');};
        const updateMode=()=>{
          crop.hidden=modeSelect.value!=='crop';resize.hidden=modeSelect.value!=='resize';
          const custom=preset.value==='custom';customW.disabled=busy||!custom;customH.disabled=busy||!custom;
        };
        modeSelect.value=startMode;updateMode();
        controls.forEach(n=>{
          n.addEventListener('change',()=>{if(!busy){updateMode();invalidate();}});
        });
        close.addEventListener('click',()=>{
          if(!busy){root.closeModal();return;}
          stop=true;close.disabled=true;tell('취소 요청을 받았습니다. 현재 페이지 처리가 끝나면 중단합니다.');
        });
        run.addEventListener('click',async()=>{
          if(busy)return;
          if(!file.files?.[0]){tell('PDF 파일을 선택해 주세요.');return;}
          const settings=modeSelect.value==='crop'?{
            mode:'crop',pages:pages.value,
            margins:{top:$('sunGeoTop').value,bottom:$('sunGeoBottom').value,
              left:$('sunGeoLeft').value,right:$('sunGeoRight').value}
          }:{mode:'resize',pages:pages.value,preset:preset.value,
            widthMm:customW.value,heightMm:customH.value,orientation:$('sunGeoOrientation').value,
            marginMm:$('sunGeoMargin').value,fitting:$('sunGeoFit').value};
          try{core.normalizeOptions(settings);}catch(e){tell(e.message);return;}
          const runGeneration=++generation;
          busy=true;stop=false;controls.forEach(n=>n.disabled=true);
          run.disabled=true;close.textContent='취소';progress.hidden=false;progress.value=0;
          output.replaceChildren();tell('PDF 페이지 구조를 확인하고 있습니다.');
          try{
            const result=await runTracked((settings.mode==='crop'?'local_page_crop':'local_page_resize'), () => core.create(file.files[0],settings,{
              PDFLib:root.PDFLib,readFile:typeof root.readPdfInputFile==='function'?root.readPdfInputFile:undefined,
              cancelled:()=>stop||!visible()||generation!==runGeneration,
              onProgress:(v)=>{
                if(!visible()||stop)return;
                progress.max=Math.max(v.total,1);progress.value=v.done;
                tell(v.phase==='saving'?'PDF를 별도 저장하고 페이지 크기를 재확인합니다.':
                  `${v.done}/${v.total}쪽 작업 중 · ${v.page}쪽`);
              }
            }), () => stop || !visible() || generation!==runGeneration);
            if(stop||!visible()||generation!==runGeneration)return;
            const button=el('button',`${result.filename} · ${result.changedPages}쪽 다운로드`,'dialog-btn primary');
            button.type='button';
            button.addEventListener('click',()=>downloadLocal(result.bytes,result.filename));
            output.append(button);
            tell(`소스 코드 처리 완료: ${result.changedPages}쪽 · 새 파일 다운로드 가능. ${result.warning}`);
          }catch(e){
            if(visible())tell(e?.name==='AbortError'?'작업을 취소했습니다. 부분 PDF는 제공하지 않습니다.':
              (e?.message||'PDF 페이지 작업에 실패했습니다.'));
          }finally{
            busy=false;
            if(visible()){
              controls.forEach(n=>n.disabled=false);updateMode();
              run.disabled=false;close.disabled=false;close.textContent='닫기';progress.hidden=true;
            }
          }
        });
      }
    });
  }
  function mount(){
    injectStyle();
    const anchor=$('quickOpenBtn')||$('workspaceCommandBar');
    if(anchor&&!$('sunriseGeoQuick')){
      const button=el('button',undefined,'quick-icon-btn');
      button.id='sunriseGeoQuick';button.type='button';button.title='PDF 페이지 자르기·크기 변경';
      button.setAttribute('aria-label','PDF 페이지 자르기 및 크기 변경');
      const icon=el('i',undefined,'fa-solid fa-crop-simple');icon.setAttribute('aria-hidden','true');
      button.append(icon);button.addEventListener('click',()=>launch('crop'));
      if(anchor.id==='workspaceCommandBar')anchor.append(button);
      else anchor.insertAdjacentElement('afterend',button);
    }
    const mobile=$('mobFileBtn');
    if(mobile)mobile.addEventListener('click',()=>root.queueMicrotask?.(()=>{
      const menu=$('mobileFileMerge');
      if(!menu||$('sunriseGeoMobile'))return;
      const button=el('button','PDF 자르기·크기 변경','dialog-btn');
      button.id='sunriseGeoMobile';button.type='button';
      button.addEventListener('click',()=>{root.closeModal?.();launch('crop');});
      menu.insertAdjacentElement('afterend',button);
    }));
    const chosen=new URLSearchParams(root.location?.search||'').get('sunriseTool');
    if(!root.SunriseToolHub && (chosen==='crop-pdf'||chosen==='resize-pdf')){
      const once=()=>launch(chosen==='resize-pdf'?'resize':'crop');
      if(document.readyState==='complete')root.setTimeout(once,0);
      else root.addEventListener('load',once,{once:true});
    }
  }
  root.SunrisePdfPageCropLaunch=()=>launch('crop');
  root.SunrisePdfPageResizeLaunch=()=>launch('resize');
  root.SunrisePdfPageGeometryLaunch=launch;
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',mount,{once:true});
  else mount();
})(typeof window!=='undefined'?window:undefined);
