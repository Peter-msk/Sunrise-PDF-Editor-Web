/* Sunrise PDF Editor — LOCAL-12 visual comparison dialog.
 * All source bytes stay in the browser; output is downloaded by user gesture.
 */
(function(root) {
  'use strict';
  // Optional telemetry: local PDF work still runs without the telemetry script.
  const runTracked = typeof root.SunriseLocalMetrics?.track === 'function'
    ? root.SunriseLocalMetrics.track
    : (_feature, operation) => Promise.resolve().then(operation);
  if (!root?.document) return;
  const doc=root.document, $=id=>doc.getElementById(id);
  const make=(tag,text,cls)=>{
    const node=doc.createElement(tag);
    if (text!==undefined) node.textContent=text;
    if (cls) node.className=cls;
    return node;
  };
  function notify(message) {
    if (typeof root.showToast==='function') root.showToast(message,'fa-circle-exclamation');
    else root.console?.warn('[Sunrise PDF compare]',message);
  }
  function installStyle() {
    if ($('sunCompareStyle')) return;
    const style=make('style');style.id='sunCompareStyle';
    style.textContent=`
      .sun-cmp-files,.sun-cmp-options{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;margin:12px 0}
      .sun-cmp-files label,.sun-cmp-options label{display:block;font-size:12px;font-weight:650;margin:0 0 5px}
      .sun-cmp-files input,.sun-cmp-options input,.sun-cmp-options select{width:100%;border:1px solid var(--border,#c7d1da);border-radius:8px;padding:9px;min-height:42px;background:var(--surface,#fff);color:var(--text,#263746);font-size:14px}
      .sun-cmp-options input[type=checkbox]{min-height:0;width:auto;vertical-align:middle;margin-right:5px}
      .sun-cmp-note{font-size:12px;line-height:1.65;padding:10px;background:var(--surface-soft,#f7f9fb);border:1px solid var(--border-soft,#dce3e9);border-radius:8px;margin:8px 0}
      .sun-cmp-status{border-radius:8px;background:var(--primary-soft,#dceaf5);padding:10px;margin:12px 0;overflow-wrap:anywhere}
      .sun-cmp-status progress{width:100%;height:11px;display:block;margin-top:8px}
      .sun-cmp-results{max-height:255px;overflow:auto;border:1px solid var(--border-soft,#dce3e9);margin-top:10px;border-radius:8px}
      .sun-cmp-results table{width:100%;border-collapse:collapse;font-size:12px}
      .sun-cmp-results th,.sun-cmp-results td{padding:7px;border-bottom:1px solid var(--border-soft,#dce3e9);text-align:left;white-space:nowrap}
      .sun-cmp-results thead{position:sticky;top:0;background:var(--surface,#fff)}
      .sun-cmp-download{display:block;width:100%;margin-top:10px;min-height:44px}
      @media(max-width:600px){.sun-cmp-files,.sun-cmp-options{grid-template-columns:1fr}}
    `;
    doc.head.append(style);
  }
  function saveBlob(blob, filename) {
    const url=root.URL.createObjectURL(blob);
    const link=make('a');link.href=url;link.download=filename;
    doc.body.append(link);link.click();link.remove();
    root.setTimeout(()=>root.URL.revokeObjectURL(url),60_000);
  }
  function ready() {
    return Boolean(root.SunrisePdfVisualCompare?.convert && root.SunrisePdfToImages?.packEntries &&
      root.pdfjsLib?.getDocument && typeof root.openModal==='function' &&
      typeof root.closeModal==='function');
  }
  function showTable(host, report) {
    host.replaceChildren();
    const wrap=make('div',undefined,'sun-cmp-results'),table=make('table');
    const head=make('thead'),header=make('tr');
    for (const label of ['페이지','판정','차이 비율','설명']) header.append(make('th',label));
    head.append(header);table.append(head);
    const body=make('tbody');
    const label={same:'시각적 일치',different:'변경 감지',geometry:'크기 다름',missing:'페이지 없음'};
    for (const row of report.rows) {
      const tr=make('tr');
      tr.append(make('td',String(row.page)),make('td',label[row.status]||row.status),
        make('td',row.percent===null?'—':row.percent.toFixed(3)+'%'),make('td',row.note||''));
      body.append(tr);
    }
    table.append(body);wrap.append(table);host.append(wrap);
  }
  function launch() {
    if (!ready()) {
      notify('PDF.js 렌더러, PDF 비교 엔진 또는 LOCAL-08 ZIP 기능을 먼저 불러와 주세요.');
      return;
    }
    installStyle();
    root.openModal({title:'PDF 시각적 비교',icon:'fa-code-compare',width:'800px',
      bodyHtml:`<p>기준 PDF와 비교 PDF를 페이지 단위로 화면 렌더링하여 차이를 찾습니다. 서버 업로드 없이 브라우저에서 비교합니다.</p>
        <div class="sun-cmp-files">
          <div><label for="sunCmpSource">기준 PDF</label><input id="sunCmpSource" type="file" accept=".pdf,application/pdf"></div>
          <div><label for="sunCmpTarget">비교할 PDF</label><input id="sunCmpTarget" type="file" accept=".pdf,application/pdf"></div>
        </div>
        <div class="sun-cmp-options">
          <div><label for="sunCmpPages">비교 페이지</label><input id="sunCmpPages" type="text" value="all" maxlength="200" autocomplete="off" placeholder="all 또는 1-3,5"></div>
          <div><label for="sunCmpDpi">렌더링 해상도</label><select id="sunCmpDpi"><option value="72">72 DPI (빠르게)</option><option value="96" selected>96 DPI (권장)</option><option value="144">144 DPI (정밀)</option><option value="200">200 DPI (고해상도)</option></select></div>
          <div><label for="sunCmpTolerance">색상 오차 허용 (RGB 0~96)</label><input id="sunCmpTolerance" type="number" min="0" max="96" step="1" value="28"></div>
          <div><label for="sunCmpImages">보고서 이미지</label><label style="font-size:13px;font-weight:400"><input id="sunCmpImages" type="checkbox" checked>변경 페이지 차이 강조 PNG 생성</label></div>
        </div>
        <p class="sun-cmp-note">두 PDF 합산 최대 120MiB, 한 번에 최대 60쪽. 선택한 DPI에서 페이지당 800만 픽셀까지 지원합니다. PNG에서는 차이 픽셀이 빨간색으로 표시됩니다. 페이지 크기가 다르면 그 차이를 보고하되 픽셀 정렬 비교는 건너뜁니다.</p>
        <div class="sun-cmp-status" role="status" aria-live="polite"><span id="sunCmpStatus">두 PDF를 선택해 주세요.</span><progress id="sunCmpProgress" value="0" max="1" hidden></progress></div>
        <div id="sunCmpResults"></div><div id="sunCmpDownload"></div>
        <p class="sun-cmp-note">출력 ZIP에는 JSON·CSV 보고서와 변경 페이지의 PNG가 포함됩니다. PDF 렌더링 결과의 시각적 비교이며 OCR이나 원문 텍스트·메타데이터·서명 차이 검증은 아닙니다. 글꼴·안티앨리어싱 차이도 결과에 영향을 줄 수 있습니다.</p>`,
      footerHtml:'<div></div><div class="modal-footer-right"><button id="sunCmpRun" type="button" class="dialog-btn primary">PDF 비교 시작</button><button id="sunCmpClose" type="button" class="dialog-btn">닫기</button></div>',
      onMount:()=>{
        const source=$('sunCmpSource'),target=$('sunCmpTarget'),pages=$('sunCmpPages'),dpi=$('sunCmpDpi');
        const tolerance=$('sunCmpTolerance'),images=$('sunCmpImages'),run=$('sunCmpRun'),close=$('sunCmpClose');
        const status=$('sunCmpStatus'),progress=$('sunCmpProgress'),results=$('sunCmpResults'),download=$('sunCmpDownload');
        const controls=[source,target,pages,dpi,tolerance,images];
        let busy=false, controller=null, generation=0;
        const visible=()=>doc.contains(run);
        const invalidate=()=>{if(busy)return;generation++;results.replaceChildren();download.replaceChildren();
          status.textContent='설정 변경됨. 새 비교를 실행해 주세요.';};
        for (const control of controls) control.addEventListener('change',invalidate);
        close.addEventListener('click',()=>{
          if (!busy) {generation++;root.closeModal();return;}
          controller?.abort();close.disabled=true;
          status.textContent='작업을 취소하고 있습니다. 부분 보고서는 제공하지 않습니다.';
        });
        run.addEventListener('click',async()=>{
          if (busy) return;
          const fileA=source.files?.[0],fileB=target.files?.[0];
          if (!fileA || !fileB) {status.textContent='두 PDF 파일을 각각 선택해 주세요.';return;}
          let settings;
          try {settings=root.SunrisePdfVisualCompare.normalizeSettings({
            pages:pages.value,dpi:dpi.value,tolerance:tolerance.value,createImages:images.checked});}
          catch (error) {status.textContent=error.message||'설정을 확인해 주세요.';return;}
          busy=true;const runId=++generation;
          controller=new AbortController();
          run.disabled=true;close.textContent='비교 취소';close.disabled=false;
          controls.forEach(node=>node.disabled=true);
          results.replaceChildren();download.replaceChildren();progress.hidden=false;progress.value=0;
          status.textContent='PDF 렌더링을 준비하고 있습니다.';
          try {
            const result=await runTracked('local_visual_compare', () => root.SunrisePdfVisualCompare.convert(fileA,fileB,settings,{
              pdfjsLib:root.pdfjsLib,
              readFile:typeof root.readPdfInputFile==='function'?root.readPdfInputFile:undefined,
              createCanvas:()=>doc.createElement('canvas'),
              createZip:entries=>root.SunrisePdfToImages.packEntries(entries),
              signal:controller.signal,cancelled:()=>!visible(),
              onProgress:info=>{
                if (!visible() || controller.signal.aborted) return;
                progress.max=Math.max(1,info.total||1);progress.value=info.done||0;
                status.textContent=info.stage==='packing'?'보고서·이미지 ZIP 묶는 중…':
                  `${info.page||'?'}쪽 처리 · ${info.done||0}/${info.total||'?'}쪽 완료`;
              }
            }), () => controller.signal.aborted || !visible() || generation!==runId);
            if (!visible() || controller.signal.aborted || generation!==runId) return;
            const count=result.report.summary;
            status.textContent=`비교 완료: 동일 ${count.same}쪽 · 차이 ${count.different}쪽 · 크기 다름 ${count.geometry}쪽 · 페이지 없음 ${count.missing}쪽`;
            showTable(results,result.report);
            const button=make('button',`비교 보고서 ZIP 다운로드 (PNG ${result.imageCount}개)`,
              'dialog-btn primary sun-cmp-download');
            button.type='button';button.addEventListener('click',()=>saveBlob(result.blob,result.fileName));
            download.append(button);
          } catch(error) {
            if (visible())status.textContent=error?.name==='AbortError'?'비교가 취소되었습니다. 결과물을 만들지 않았습니다.':
              error?.message||'PDF 비교 작업이 실패했습니다.';
          } finally {
            busy=false;controller=null;
            if (visible()) {
              controls.forEach(node=>node.disabled=false);
              run.disabled=false;close.disabled=false;close.textContent='닫기';progress.hidden=true;
            }
          }
        });
      }
    });
  }
  function mount() {
    const anchor=$('quickOpenBtn')||$('workspaceCommandBar');
    if(anchor&&!$('sunPdfVisualCompareQuick')) {
      const button=make('button',undefined,'quick-icon-btn');button.type='button';
      button.id='sunPdfVisualCompareQuick';button.title='두 PDF 시각적 비교';
      button.setAttribute('aria-label','PDF 시각적 비교');
      const icon=make('i',undefined,'fa-solid fa-code-compare');icon.setAttribute('aria-hidden','true');
      button.append(icon);button.addEventListener('click',launch);
      if(anchor.id==='workspaceCommandBar')anchor.append(button);
      else anchor.insertAdjacentElement('afterend',button);
    }
    const mobile=$('mobFileBtn');
    if(mobile) mobile.addEventListener('click',()=>root.queueMicrotask?.(()=>{
      const menu=$('mobileFileMerge');if(!menu||$('sunPdfVisualCompareMobile'))return;
      const button=make('button','PDF 비교','dialog-btn');button.type='button';
      button.id='sunPdfVisualCompareMobile';
      button.addEventListener('click',()=>{root.closeModal?.();launch();});
      menu.insertAdjacentElement('afterend',button);
    }));
    if(!root.SunriseToolHub && new URLSearchParams(root.location?.search||'').get('sunriseTool')==='pdf-visual-compare'){
      if(doc.readyState==='complete')root.setTimeout(launch,0);
      else root.addEventListener('load',()=>root.setTimeout(launch,0),{once:true});
    }
  }
  root.SunrisePdfVisualCompareLaunch=launch;
  if(doc.readyState==='loading')doc.addEventListener('DOMContentLoaded',mount,{once:true});
  else mount();
})(typeof window!=='undefined'?window:undefined);
