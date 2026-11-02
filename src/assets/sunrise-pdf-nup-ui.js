/* Sunrise PDF Editor Web — LOCAL-10 N-up controls.
 * Uses Sunrise's existing modal, pdf-lib, file reader and download entry points.
 * All document bytes stay in the browser. Never sends source files to a server.
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
  function el(tag,text,className) {
    const node = document.createElement(tag);
    if (text !== undefined) node.textContent = text;
    if (className) node.className = className;
    return node;
  }
  function warn(text) {
    if (typeof root.showToast === 'function') root.showToast(text,'fa-circle-exclamation');
    else root.console?.warn('[Sunrise N-up]',text);
  }
  function installStyle() {
    if (byId('sunNupStyles')) return;
    const style = el('style');
    style.id = 'sunNupStyles';
    style.textContent = `
      .sun-nup-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:9px 12px;margin:12px 0}
      .sun-nup-grid label{display:block;font-size:12px;font-weight:650;margin:0 0 5px}
      .sun-nup-grid select,.sun-nup-grid input{width:100%;min-height:43px;border:1px solid var(--border,#c7d1da);border-radius:8px;padding:8px 10px;background:var(--surface,#fff);color:var(--text,#263746);font-size:14px}
      .sun-nup-grid input[type=checkbox]{width:18px;height:18px;min-height:18px;vertical-align:middle;margin-right:7px}
      .sun-nup-check{display:flex;align-items:center;min-height:43px}
      .sun-nup-message{margin:10px 0;border:1px solid var(--border-soft,#dce3e9);background:var(--surface-soft,#f7f9fb);border-radius:8px;padding:10px;font-size:12px;line-height:1.6}
      .sun-nup-status{padding:10px;min-height:45px;border-radius:8px;background:var(--primary-soft,#dceaf5);margin:10px 0;overflow-wrap:anywhere}
      .sun-nup-status progress{width:100%;height:9px;margin-top:7px;display:block}
      .sun-nup-preview-row{display:flex;align-items:center;gap:15px;flex-wrap:wrap;margin:10px 0}
      .sun-nup-sheet{display:grid;gap:3px;background:var(--surface,#fff);border:1px solid var(--border,#c7d1da);padding:8px;box-shadow:0 2px 5px rgba(0,0,0,.07);height:160px;width:115px;flex:0 0 auto}
      .sun-nup-slot{background:var(--primary-soft,#dceaf5);border:1px solid var(--primary,#1f6f9f);display:grid;place-items:center;font-weight:700;font-size:11px;min-width:0;min-height:0}
      .sun-nup-note{flex:1 1 190px;font-size:12px;color:var(--text-muted,#647687);line-height:1.6}
      .sun-nup-result button{width:100%;min-height:45px;padding:11px}
      @media(max-width:570px){.sun-nup-grid{grid-template-columns:1fr}}
    `;
    document.head.append(style);
  }
  function launch() {
    const engine = root.SunrisePdfNup;
    if (!engine?.create || !engine?.normalizeOptions ||
      !root.PDFLib?.PDFDocument || typeof root.openModal !== 'function' ||
      typeof root.closeModal !== 'function' || typeof root.downloadBytes !== 'function') {
      warn('Sunrise 모아찍기 엔진 또는 편집기 UI가 연결되지 않았습니다.');
      return;
    }
    installStyle();
    root.openModal({
      title:'PDF 모아찍기 · 여러 페이지를 한 장에', icon:'fa-table-cells',width:'760px',
      bodyHtml:`
        <p>여러 PDF의 페이지를 출력 용지 한 장에 2·4·6·9·16쪽 배치합니다. 처리한 PDF는 <strong>서버로 업로드하지 않고</strong> 새 파일로 받습니다.</p>
        <label for="sunNupFiles">PDF 선택 (1~5개, 최대 250쪽 / 합계 120MB)</label>
        <input id="sunNupFiles" type="file" multiple accept=".pdf,application/pdf" style="display:block;width:100%;min-height:43px;margin:7px 0">
        <p class="sun-nup-message">여러 파일을 선택하면 <strong>선택된 파일 순서대로</strong> 합쳐 배치합니다. 페이지 범위는 전체 파일을 이어 붙인 페이지 번호를 기준으로 합니다.</p>
        <div class="sun-nup-grid">
          <div><label for="sunNupCount">한 장당 페이지 수</label><select id="sunNupCount"><option value="2">2쪽</option><option value="4" selected>4쪽</option><option value="6">6쪽</option><option value="9">9쪽</option><option value="16">16쪽</option></select></div>
          <div><label for="sunNupPaper">출력 용지</label><select id="sunNupPaper"><option value="a4">A4</option><option value="a3">A3</option><option value="letter">Letter</option><option value="legal">Legal</option></select></div>
          <div><label for="sunNupDirection">용지 방향</label><select id="sunNupDirection"><option value="auto">자동 (배치 효율)</option><option value="portrait">세로</option><option value="landscape">가로</option></select></div>
          <div><label for="sunNupOrder">페이지 채우는 순서</label><select id="sunNupOrder"><option value="across">왼쪽 → 오른쪽, 아래로</option><option value="down">위 → 아래, 오른쪽으로</option></select></div>
          <div><label for="sunNupPages">페이지 범위</label><input id="sunNupPages" type="text" value="all" maxlength="200" placeholder="all / odd / even / 1-3,5,8-" autocomplete="off"></div>
          <div><label for="sunNupFitting">페이지 크기 조절</label><select id="sunNupFitting"><option value="fit">칸에 맞게 확대·축소</option><option value="shrink">큰 페이지만 축소</option></select></div>
          <div><label for="sunNupMargin">바깥 여백 (mm)</label><input id="sunNupMargin" type="number" min="0" max="35" step="0.5" value="7"></div>
          <div><label for="sunNupGap">페이지 사이 간격 (mm)</label><input id="sunNupGap" type="number" min="0" max="20" step="0.5" value="3"></div>
          <div><label for="sunNupBorder">테두리</label><div class="sun-nup-check"><input id="sunNupBorder" type="checkbox"><span>각 페이지에 테두리 표시</span></div></div>
          <div><label for="sunNupBorderColor">테두리 색상</label><input id="sunNupBorderColor" type="color" value="#8793a1" disabled></div>
          <div><label for="sunNupBorderWidth">테두리 굵기 (mm)</label><input id="sunNupBorderWidth" type="number" min="0.1" max="2" step="0.1" value="0.2" disabled></div>
          <div><label for="sunNupReverse">페이지 역순</label><div class="sun-nup-check"><input id="sunNupReverse" type="checkbox"><span>선택한 페이지 순서 뒤집기</span></div></div>
        </div>
        <div class="sun-nup-preview-row"><div id="sunNupSheetPreview" class="sun-nup-sheet" role="img" aria-label="모아찍기 칸 배치 미리보기"></div>
          <p class="sun-nup-note">이 그림은 칸의 배치 순서만 보여줍니다. <strong>실제 PDF 페이지 미리보기는 아닙니다.</strong><span id="sunNupPreviewText"></span></p></div>
        <div class="sun-nup-status" role="status" aria-live="polite"><span id="sunNupStatusText">파일과 출력 방식을 선택해 주세요.</span><progress id="sunNupProgress" max="1" value="0" hidden></progress></div>
        <div id="sunNupResult" class="sun-nup-result"></div>
        <p class="sun-nup-message"><strong>중요:</strong> 인쇄용 페이지 외형을 새 PDF에 배치하는 기능입니다. 서명·양식·주석·북마크·첨부·접근성 구조가 있는 PDF는 안전하게 차단합니다. 0도 회전·정규화된 PDF만 지원하며, 도면 축척은 사용자가 확인해야 합니다.</p>`,
      footerHtml:'<div></div><div class="modal-footer-right"><button id="sunNupRun" type="button" class="dialog-btn primary">모아찍기 PDF 만들기</button><button id="sunNupClose" type="button" class="dialog-btn">닫기</button></div>',
      onMount:() => {
        const files = byId('sunNupFiles'), run = byId('sunNupRun'), close = byId('sunNupClose');
        const status = byId('sunNupStatusText'), progress = byId('sunNupProgress');
        const resultHost = byId('sunNupResult');
        const values = {
          nup:byId('sunNupCount'),paper:byId('sunNupPaper'),orientation:byId('sunNupDirection'),
          order:byId('sunNupOrder'),pages:byId('sunNupPages'),fitting:byId('sunNupFitting'),
          marginMm:byId('sunNupMargin'),gapMm:byId('sunNupGap'),border:byId('sunNupBorder'),
          borderColor:byId('sunNupBorderColor'),borderWidthMm:byId('sunNupBorderWidth'),
          reverse:byId('sunNupReverse')
        };
        const controls = [files,...Object.values(values)];
        let busy = false, stopped = false, generation = 0;
        const visible = () => document.contains(run);
        const clearOutput = () => {generation++;resultHost.replaceChildren();};
        const updateBorder = () => {
          values.borderColor.disabled = busy || !values.border.checked;
          values.borderWidthMm.disabled = busy || !values.border.checked;
        };
        function options() {
          return engine.normalizeOptions({
            nup:values.nup.value,paper:values.paper.value,
            orientation:values.orientation.value,order:values.order.value,
            pages:values.pages.value,fitting:values.fitting.value,
            marginMm:values.marginMm.value,gapMm:values.gapMm.value,
            border:values.border.checked,borderColor:values.borderColor.value,
            borderWidthMm:values.borderWidthMm.value,reverse:values.reverse.checked
          });
        }
        function preview() {
          const canvas = byId('sunNupSheetPreview'), caption = byId('sunNupPreviewText');
          canvas.replaceChildren();
          const n = Number(values.nup.value);
          let cols = n===2?2:n===6?3:Math.sqrt(n);
          let rows = n/cols;
          const wide = values.orientation.value === 'landscape' || values.orientation.value === 'auto' && n===2;
          if (!wide && (n===2 || n===6)) [cols,rows] = [rows,cols];
          canvas.style.gridTemplateColumns = `repeat(${cols},minmax(0,1fr))`;
          canvas.style.gridTemplateRows = `repeat(${rows},minmax(0,1fr))`;
          canvas.style.width = wide ? '160px' : '115px';
          canvas.style.height = wide ? '115px' : '160px';
          for (let i = 0; i < n; i++) {
            const col = values.order.value === 'down' ? Math.floor(i / rows) : i % cols;
            const row = values.order.value === 'down' ? i % rows : Math.floor(i / cols);
            const cell = el('span',String(i+1),'sun-nup-slot');
            cell.style.gridColumn = String(col+1);cell.style.gridRow = String(row+1);
            canvas.append(cell);
          }
          caption.textContent = ` ${n}쪽 배치 / ${cols}열 × ${rows}행 (자동 방향은 실제 첫 용지에서 결정)`;
        }
        controls.forEach(input => input.addEventListener('change',() => {
          if (!busy) { clearOutput();status.textContent='설정이 변경되었습니다. 새 PDF 만들기를 눌러 주세요.';updateBorder();preview(); }
        }));
        preview();
        close.addEventListener('click',() => {
          if (!busy) {root.closeModal();return;}
          stopped = true;close.disabled=true;
          status.textContent = '취소 요청을 받았습니다. 현재 PDF 처리 단계 이후 중단합니다.';
        });
        run.addEventListener('click',async() => {
          if (busy) return;
          let settings;
          try {settings = options();} catch (e) {status.textContent = e.message;return;}
          const inputFiles = Array.from(files.files || []);
          if (!inputFiles.length) {status.textContent='PDF 파일을 먼저 선택해 주세요.';return;}
          const myGeneration = ++generation;
          resultHost.replaceChildren();
          busy=true;stopped=false;
          controls.forEach(n=>n.disabled=true);
          run.disabled=true;close.textContent='작업 취소';
          progress.hidden=false;progress.max=1;progress.value=0;
          status.textContent='입력 PDF 구조를 확인하는 중입니다.';
          try {
            const output = await runTracked('local_nup', () => engine.create(inputFiles,settings,{
              PDFLib:root.PDFLib,
              readFile:typeof root.readPdfInputFile==='function'?root.readPdfInputFile:undefined,
              cancelled:() => stopped || !visible() || generation!==myGeneration,
              onProgress:(step) => {
                if (!visible() || stopped) return;
                progress.max = Math.max(1,step.total||1);
                progress.value = Math.min(step.done||0,progress.max);
                if (step.phase==='loading') status.textContent=`PDF 읽기 ${step.done}/${step.total} · ${step.file||''}`;
                else if (step.phase==='placing') status.textContent=`인쇄용지 배치 ${step.done}/${step.total}장 · ${step.sourcePages}쪽 처리`;
                else status.textContent='새 PDF 저장과 페이지 구조 확인 중입니다.';
              }
            }), () => stopped || !visible() || generation!==myGeneration);
            if (stopped || !visible() || generation!==myGeneration) return;
            const btn = el('button',`${output.filename} 다운로드`,'dialog-btn primary');
            btn.type='button';
            btn.addEventListener('click',()=>downloadLocal(output.bytes,output.filename));
            resultHost.append(btn);
            status.textContent = `${output.selectedPages}쪽 → ${output.outputSheets}장 · ${output.nup}쪽 모아찍기. 원본은 변경하지 않았습니다.`;
          } catch (error) {
            if (visible()) status.textContent = error?.name === 'AbortError' ?
              '작업이 취소되었습니다. 부분 PDF는 제공하지 않습니다.' :
              (error?.message || 'PDF 모아찍기 처리에 실패했습니다.');
          } finally {
            busy = false;
            if (visible()) {
              controls.forEach(n=>n.disabled=false);
              updateBorder();
              run.disabled=false;close.disabled=false;close.textContent='닫기';
              progress.hidden=true;
            }
          }
        });
      }
    });
  }
  function mount() {
    installStyle();
    const anchor = byId('quickOpenBtn') || byId('workspaceCommandBar');
    if (anchor && !byId('sunNupQuick')) {
      const button = el('button',undefined,'quick-icon-btn');
      button.id = 'sunNupQuick';button.type = 'button';button.title = 'PDF 모아찍기';
      button.setAttribute('aria-label','PDF 모아찍기');
      const icon = el('i',undefined,'fa-solid fa-table-cells');
      icon.setAttribute('aria-hidden','true');button.append(icon);
      button.addEventListener('click',launch);
      if (anchor.id === 'workspaceCommandBar') anchor.append(button);
      else anchor.insertAdjacentElement('afterend',button);
    }
    const mobile = byId('mobFileBtn');
    if (mobile) mobile.addEventListener('click',()=>root.queueMicrotask?.(()=>{
      const item = byId('mobileFileMerge');
      if (!item || byId('sunNupMobile')) return;
      const button = el('button','PDF 모아찍기','dialog-btn');
      button.id='sunNupMobile';button.type='button';
      button.addEventListener('click',()=>{root.closeModal?.();launch();});
      item.insertAdjacentElement('afterend',button);
    }));
    const selected = new URLSearchParams(root.location?.search||'').get('sunriseTool');
    if (selected === 'nup-pdf') {
      if (document.readyState==='complete') root.setTimeout(launch,0);
      else root.addEventListener('load',launch,{once:true});
    }
  }
  root.SunrisePdfNupLaunch = launch;
  if (document.readyState==='loading') document.addEventListener('DOMContentLoaded',mount,{once:true});
  else mount();
})(typeof window !== 'undefined' ? window : undefined);
