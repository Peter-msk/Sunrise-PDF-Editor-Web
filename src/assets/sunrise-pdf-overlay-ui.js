/* Sunrise PDF Editor Web — LOCAL-11 page overlay controls.
 * UI only. Source PDF bytes never leave the local browser.
 */
(function(root) {
  'use strict';
  // B09: shared download validation / MIME handling; old bridge still works if absent.
  const downloadLocal = (...args) => typeof root.SunriseLocalUI?.download === 'function'
    ? root.SunriseLocalUI.download(...args) : root.downloadBytes(...args);
  // Optional telemetry: local PDF work still runs without the telemetry script.
  const runTracked = typeof root.SunriseLocalMetrics?.track === 'function'
    ? root.SunriseLocalMetrics.track
    : (_feature, operation) => Promise.resolve().then(operation);
  if (!root?.document) return;
  const document = root.document;
  const byId = id => document.getElementById(id);
  const create = (tag, text, cls) => {
    const node = document.createElement(tag);
    if (text !== undefined) node.textContent = text;
    if (cls) node.className = cls;
    return node;
  };
  function notify(message) {
    if (typeof root.showToast === 'function') root.showToast(message,'fa-circle-exclamation');
    else root.console?.warn('[Sunrise Overlay]',message);
  }
  function installStyle() {
    if (byId('sunOverlayStyle')) return;
    const style = create('style');
    style.id = 'sunOverlayStyle';
    style.textContent = `
      .sun-ov-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;margin:14px 0}
      .sun-ov-grid label,.sun-ov-files label{display:block;font-size:12px;font-weight:650;margin:0 0 5px}
      .sun-ov-grid input,.sun-ov-grid select,.sun-ov-files input{width:100%;border:1px solid var(--border,#c7d1da);border-radius:8px;padding:9px 10px;min-height:43px;background:var(--surface,#fff);color:var(--text,#263746);font-size:14px}
      .sun-ov-files{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin:12px 0}
      .sun-ov-note{border:1px solid var(--border-soft,#dce3e9);border-radius:8px;padding:11px;background:var(--surface-soft,#f7f9fb);margin:11px 0;font-size:12px;line-height:1.65}
      .sun-ov-status{padding:11px;min-height:48px;border-radius:8px;background:var(--primary-soft,#dceaf5);overflow-wrap:anywhere;margin:12px 0}
      .sun-ov-status progress{display:block;width:100%;height:10px;margin-top:8px}
      .sun-ov-result button{min-height:44px;width:100%;margin-top:8px}
      .sun-ov-example{display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin:10px 0}
      .sun-ov-pages{position:relative;height:94px;width:72px;border:1px solid var(--border,#c7d1da);background:var(--surface,#fff);flex:0 0 auto}
      .sun-ov-page{position:absolute;inset:9px;background:var(--surface-soft,#f7f9fb);border:1px solid var(--text-muted,#647687);display:grid;place-items:center;font-size:10px;font-weight:700}
      .sun-ov-page.overlay{inset:21px 13px;background:var(--brand-soft,#fff2df);border:1px dashed var(--brand,#e58a18)}
      .sun-ov-page.front{z-index:2}.sun-ov-page.back{z-index:0}.sun-ov-page.main{z-index:1}
      @media(max-width:580px){.sun-ov-grid,.sun-ov-files{grid-template-columns:1fr}}
    `;
    document.head.append(style);
  }
  function launch() {
    const engine = root.SunrisePdfOverlay;
    if (!engine?.create || !engine?.normalizeOptions || !root.PDFLib?.PDFDocument ||
      typeof root.openModal !== 'function' || typeof root.closeModal !== 'function' ||
      typeof root.downloadBytes !== 'function') {
      notify('Sunrise PDF 겹치기 엔진 또는 기존 편집기 연결을 확인해 주세요.');
      return;
    }
    installStyle();
    root.openModal({
      title:'PDF 오버레이 · 페이지 겹치기',icon:'fa-layer-group',width:'760px',
      bodyHtml:`
        <p>기준 PDF에 다른 PDF의 페이지를 겹쳐 <strong>새 PDF</strong>를 만듭니다. 원본 파일은 수정하거나 서버로 업로드하지 않습니다.</p>
        <div class="sun-ov-files">
          <div><label for="sunOverlayBase">기준 PDF (최대 250쪽)</label><input id="sunOverlayBase" type="file" accept=".pdf,application/pdf"></div>
          <div><label for="sunOverlayLayer">겹칠 PDF (최대 250쪽)</label><input id="sunOverlayLayer" type="file" accept=".pdf,application/pdf"></div>
        </div>
        <p class="sun-ov-note">PDF 두 파일의 합계 크기는 최대 120MB입니다. 페이지의 내용과 도면은 벡터 외형을 사용합니다. PDF24의 전경/배경 겹치기 흐름을 참고한 Sunrise 자체 코드입니다.</p>
        <div class="sun-ov-grid">
          <div><label for="sunOverlayPosition">배치 순서</label><select id="sunOverlayPosition"><option value="front">전경 · 기준 페이지 위</option><option value="back">배경 · 기준 페이지 아래</option></select></div>
          <div><label for="sunOverlayMapping">겹칠 페이지 대응</label><select id="sunOverlayMapping"><option value="repeat-last">같은 순번 · 모자라면 마지막 페이지 반복</option><option value="first">첫 페이지를 모든 대상 쪽에 적용</option><option value="sequence">같은 순번 (쪽수 부족 시 중단)</option><option value="cycle">처음부터 순환 반복</option></select></div>
          <div><label for="sunOverlayPages">적용할 기준 페이지</label><input id="sunOverlayPages" type="text" value="all" maxlength="200" placeholder="all / odd / even / 1-3,5,8-" autocomplete="off"></div>
          <div><label for="sunOverlayAnchor">배치 위치</label><select id="sunOverlayAnchor"><option value="center">가운데</option><option value="top-left">왼쪽 위</option><option value="top-right">오른쪽 위</option><option value="bottom-left">왼쪽 아래</option><option value="bottom-right">오른쪽 아래</option></select></div>
          <div><label for="sunOverlaySize">크기 맞춤</label><select id="sunOverlaySize"><option value="contain">비율 유지 · 페이지 안에 맞춤</option><option value="stretch">페이지 크기에 맞춰 늘림</option></select></div>
          <div><label for="sunOverlayScale">배치 크기 (%)</label><input id="sunOverlayScale" type="number" value="100" min="25" max="200" step="5"></div>
          <div><label for="sunOverlayOpacity">겹칠 페이지 불투명도 (%)</label><input id="sunOverlayOpacity" type="number" value="100" min="5" max="100" step="5"></div>
          <div><label for="sunOverlayX">좌우 이동 (mm · 양수=오른쪽)</label><input id="sunOverlayX" type="number" value="0" min="-100" max="100" step="1"></div>
          <div><label for="sunOverlayY">상하 이동 (mm · 양수=위쪽)</label><input id="sunOverlayY" type="number" value="0" min="-100" max="100" step="1"></div>
        </div>
        <div class="sun-ov-example"><div class="sun-ov-pages" role="img" aria-label="전경 배경 배치 순서의 개념도"><span class="sun-ov-page main" id="sunOvBasePreview">기준</span><span class="sun-ov-page overlay front" id="sunOvOverlayPreview">겹침</span></div>
          <p id="sunOvPreviewCaption" class="sun-ov-note" style="flex:1 1 170px;margin:0">전경: 기준 PDF 위에 겹칩니다. 이 그림은 레이어 순서만 보여주는 개념도이며 실제 PDF 미리보기가 아닙니다.</p></div>
        <div class="sun-ov-status" role="status" aria-live="polite"><span id="sunOvStatusText">기준 PDF와 겹칠 PDF를 선택해 주세요.</span><progress id="sunOvProgress" max="1" value="0" hidden></progress></div>
        <div id="sunOvResult" class="sun-ov-result"></div>
        <p class="sun-ov-note"><strong>주의:</strong> 외형을 새 PDF로 재구성하므로 서명·양식·주석·링크·책갈피·첨부·접근성 구조 등은 보존되지 않습니다. 해당 문서는 차단합니다. 0° 회전·정규화 페이지만 지원합니다. 겹치기는 <strong>민감정보 삭제 기능이 아닙니다.</strong> 배경 PDF는 기준 페이지의 흰색 콘텐츠에 가려질 수 있습니다.</p>`,
      footerHtml:'<div></div><div class="modal-footer-right"><button id="sunOvStart" type="button" class="dialog-btn primary">겹친 PDF 만들기</button><button id="sunOvClose" type="button" class="dialog-btn">닫기</button></div>',
      onMount:() => {
        const base = byId('sunOverlayBase'), overlay = byId('sunOverlayLayer');
        const run = byId('sunOvStart'), close = byId('sunOvClose');
        const status = byId('sunOvStatusText'), progress = byId('sunOvProgress');
        const resultHost = byId('sunOvResult');
        const inputs = {
          position:byId('sunOverlayPosition'), mapping:byId('sunOverlayMapping'),
          pages:byId('sunOverlayPages'),anchor:byId('sunOverlayAnchor'),
          size:byId('sunOverlaySize'),scale:byId('sunOverlayScale'),
          opacity:byId('sunOverlayOpacity'),xMm:byId('sunOverlayX'),yMm:byId('sunOverlayY')
        };
        const controls = [base,overlay,...Object.values(inputs)];
        let busy = false, cancelled = false, generation = 0;
        const visible = () => document.contains(run);
        function options() {
          // create() normalizes the raw percentage values itself. A second normalization
          // would reject already-normalized opacity (1 instead of 100 percent).
          const raw=Object.fromEntries(
            Object.entries(inputs).map(([key,node]) => [key,node.value])
          );
          engine.normalizeOptions(raw); // validate before entering busy state
          return raw;
        }
        function refreshPreview() {
          const underlay = inputs.position.value === 'back';
          byId('sunOvOverlayPreview').className = 'sun-ov-page overlay ' + (underlay ? 'back' : 'front');
          byId('sunOvPreviewCaption').textContent = underlay ?
            '배경: 기준 PDF 아래쪽에 겹칩니다. 불투명한 흰색 배경 콘텐츠가 있으면 가려질 수 있습니다. 실제 출력 미리보기는 아닙니다.' :
            '전경: 기준 PDF 위에 겹칩니다. 위치·크기·투명도는 출력 생성 시 적용됩니다. 실제 출력 미리보기는 아닙니다.';
        }
        for (const control of controls) control.addEventListener('change', () => {
          if (busy) return;
          generation++;
          resultHost.replaceChildren();
          status.textContent='설정이 변경되었습니다. 새 PDF를 만들려면 실행 버튼을 눌러 주세요.';
          refreshPreview();
        });
        refreshPreview();
        close.addEventListener('click',() => {
          if (!busy) { generation++; root.closeModal(); return; }
          cancelled=true;
          close.disabled=true;
          status.textContent='작업을 안전하게 취소하고 있습니다.';
        });
        run.addEventListener('click',async() => {
          if (busy) return;
          let settings;
          try { settings = options(); }
          catch (error) { status.textContent=error?.message||'설정값이 올바르지 않습니다.';return; }
          const baseFile=base.files?.[0], overlayFile=overlay.files?.[0];
          if (!baseFile || !overlayFile) {
            status.textContent='기준 PDF와 겹칠 PDF를 각각 하나씩 선택해 주세요.';
            return;
          }
          busy=true;cancelled=false;
          const current=++generation;
          resultHost.replaceChildren();
          controls.forEach(n=>n.disabled=true);
          run.disabled=true;close.textContent='작업 취소';
          progress.hidden=false;progress.value=0;progress.max=2;
          status.textContent='PDF 파일의 구조를 확인하는 중입니다.';
          try {
            const output=await runTracked('local_pdf_overlay', () => engine.create(baseFile,overlayFile,settings,{
              PDFLib:root.PDFLib,
              readFile:typeof root.readPdfInputFile==='function'?root.readPdfInputFile:undefined,
              cancelled:() => cancelled || !visible() || current!==generation,
              onProgress:step => {
                if (!visible() || cancelled || current!==generation) return;
                progress.max=Math.max(1,step.total||1);
                progress.value=Math.min(step.done||0,progress.max);
                if (step.phase==='loading') status.textContent=`PDF 읽기 ${step.done}/${step.total}개`;
                else if (step.phase==='drawing') status.textContent=`페이지 겹치기 ${step.done}/${step.total}쪽`;
                else status.textContent='새 PDF 저장 및 페이지 구조 확인 중입니다.';
              }
            }), () => cancelled || !visible() || current!==generation);
            if (!visible() || cancelled || current!==generation) return;
            const button=create('button',`${output.filename} 다운로드`,'dialog-btn primary');
            button.type='button';
            button.addEventListener('click',()=>downloadLocal(output.bytes,output.filename));
            resultHost.append(button);
            status.textContent=`전체 ${output.pages}쪽 중 ${output.applied}쪽에 겹침 적용. 결과는 새 PDF로 다운로드합니다.`;
          } catch (error) {
            if (visible()) status.textContent=error?.name==='AbortError' ?
              '작업이 취소되었습니다. 부분 PDF는 제공하지 않습니다.' :
              (error?.message||'PDF 겹치기를 완료하지 못했습니다.');
          } finally {
            busy=false;
            if (visible()) {
              controls.forEach(n=>n.disabled=false);
              run.disabled=false;close.disabled=false;close.textContent='닫기';
              progress.hidden=true;
            }
          }
        });
      }
    });
  }
  function mount() {
    const anchor=byId('quickOpenBtn') || byId('workspaceCommandBar');
    if (anchor && !byId('sunOvQuick')) {
      const button=create('button',undefined,'quick-icon-btn');
      button.id='sunOvQuick';button.type='button';button.title='PDF 페이지 겹치기';
      button.setAttribute('aria-label','PDF 페이지 겹치기');
      const icon=create('i',undefined,'fa-solid fa-layer-group');
      icon.setAttribute('aria-hidden','true');button.append(icon);
      button.addEventListener('click',launch);
      if (anchor.id==='workspaceCommandBar') anchor.append(button);
      else anchor.insertAdjacentElement('afterend',button);
    }
    const mobile=byId('mobFileBtn');
    if (mobile) mobile.addEventListener('click',()=>root.queueMicrotask?.(()=>{
      const item=byId('mobileFileMerge');
      if (!item || byId('sunOvMobile')) return;
      const button=create('button','PDF 겹치기','dialog-btn');
      button.id='sunOvMobile';button.type='button';
      button.addEventListener('click',()=>{root.closeModal?.();launch();});
      item.insertAdjacentElement('afterend',button);
    }));
    // The v3 tool hub already owns sunriseTool query routing, if it is installed.
    // Avoid opening a second modal when both extensions are present.
    if (!root.SunriseToolHub &&
      new URLSearchParams(root.location?.search||'').get('sunriseTool')==='overlay-pdf') {
      if (document.readyState==='complete') root.setTimeout(launch,0);
      else root.addEventListener('load',launch,{once:true});
    }
  }
  root.SunrisePdfOverlayLaunch=launch;
  if (document.readyState==='loading') document.addEventListener('DOMContentLoaded',mount,{once:true});
  else mount();
})(typeof window !== 'undefined' ? window : undefined);
