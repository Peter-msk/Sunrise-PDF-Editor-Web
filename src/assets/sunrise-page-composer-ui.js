/* Sunrise PDF Editor page composition UI.
 * Plug-in-free addition to the existing global-script editor. Requires only
 * a script include after sunrise-page-composer.js in src/editor/index.html.
 */
(function (root) {
  'use strict';
  // B09: shared download validation / MIME handling; old bridge still works if absent.
  const downloadLocal = (...args) => typeof root.SunriseLocalUI?.download === 'function'
    ? root.SunriseLocalUI.download(...args) : root.downloadBytes(...args);
  // Optional telemetry: local PDF work still runs without the telemetry script.
  const runTracked = typeof root.SunriseLocalMetrics?.track === 'function'
    ? root.SunriseLocalMetrics.track
    : (_feature, operation) => Promise.resolve().then(operation);

  function launchPageComposer() {
    const core = root.SunrisePageComposer;
    if (!core?.compose || !root.PDFLib || !root.SunriseBatchPages?.checkSource) {
      root.showToast?.('페이지 구성에 필요한 PDF 엔진을 불러오지 못했습니다.', 'fa-circle-exclamation');
      return;
    }
    root.openModal({
      title: 'PDF 페이지 자유 구성',
      icon: 'fa-layer-group',
      width: '680px',
      bodyHtml: `
        <p>PDF 최대 5개에서 필요한 페이지만 골라 순서를 바꾸고, 역순 배치·중복 삽입·90도 단위 회전·빈 페이지 추가로 새 PDF를 만듭니다. 원본은 수정되지 않으며 파일은 서버로 전송하지 않습니다.</p>
        <label for="pageComposeFiles">원본 PDF 파일 (위에서부터 1번, 2번…)</label>
        <input type="file" id="pageComposeFiles" accept=".pdf,application/pdf" multiple style="display:block;width:100%;margin:8px 0 12px">
        <label for="pageComposePlan">출력 페이지 순서</label>
        <textarea id="pageComposePlan" class="dialog-textarea" rows="5" style="width:100%;resize:vertical;font:inherit" spellcheck="false">1:*</textarea>
        <p style="margin:8px 0">예: <code>1:1-3, 2:5-2, 1:4@90, 1:4</code><br>
        <code>1:*</code>는 해당 문서의 전체 쪽, <code>2:5-2</code>는 2번 문서의 5→2쪽 역순, <code>@90</code>은 원본 회전에 90도 추가를 뜻합니다. 같은 쪽을 여러 번 넣을 수 있습니다. <code>blank:A4</code>, <code>blank:LETTER</code> 또는 <code>blank:420x595</code>는 빈 페이지를 추가합니다.</p>
        <p>결과 최대 250쪽. 원본 북마크·양식·서명·주석 등 구조가 손실될 수 있는 파일은 자동 차단합니다.</p>
        <p id="pageComposeStatus" role="status" aria-live="polite">파일을 선택하고 순서를 입력해 주세요.</p>
        <div id="pageComposeResult"></div>`,
      footerHtml: `<div></div><div class="modal-footer-right">
        <button type="button" class="dialog-btn primary" id="pageComposeStart">새 PDF 구성</button>
        <button type="button" class="dialog-btn" id="pageComposeCancel">닫기</button>
      </div>`,
      onMount: () => {
        const $ = id => document.getElementById(id);
        const filesInput = $('pageComposeFiles');
        const planInput = $('pageComposePlan');
        const start = $('pageComposeStart');
        const cancel = $('pageComposeCancel');
        const status = $('pageComposeStatus');
        const result = $('pageComposeResult');
        let running = false;
        let cancelled = false;
        let planEdited = false;
        const stillOpen = () => $('modalBackdrop')?.classList.contains('open') &&
          $('pageComposeStart') === start;
        planInput.addEventListener('input', () => { planEdited = true; });
        filesInput.addEventListener('change', () => {
          const selected = Array.from(filesInput.files || []);
          if (!planEdited && selected.length >= 1 && selected.length <= 5) {
            planInput.value = selected.map((_, i) => `${i + 1}:*`).join(', ');
          }
          status.textContent = `${selected.length}개 PDF 선택. 출력 순서를 확인해 주세요.`;
        });
        cancel.addEventListener('click', () => {
          if (running) {
            cancelled = true;
            cancel.disabled = true;
            status.textContent = '현재 페이지 묶음 처리 후 안전하게 취소합니다.';
          } else {
            root.closeModal();
          }
        });
        start.addEventListener('click', async () => {
          if (running) return;
          const selected = Array.from(filesInput.files || []);
          if (!selected.length || selected.length > core.MAX_FILES) {
            status.textContent = 'PDF 파일 1~5개를 선택해 주세요.';
            return;
          }
          if (!planInput.value.trim()) {
            status.textContent = '페이지 순서를 입력해 주세요.';
            return;
          }
          running = true;
          cancelled = false;
          start.disabled = true;
          filesInput.disabled = true;
          planInput.disabled = true;
          cancel.textContent = '작업 취소';
          result.replaceChildren();
          try {
            const composed = await runTracked('local_page_compose', () => core.compose(selected, planInput.value, {
              PDFLib: root.PDFLib,
              checkSource: root.SunriseBatchPages.checkSource,
              readFile: file => root.readPdfInputFile(file),
              cancelled: () => cancelled || !stillOpen(),
              onRead: ({ index, total, name }) => {
                if (stillOpen()) status.textContent = `원본 확인 ${index}/${total}: ${name}`;
              },
              onProgress: ({ done, total }) => {
                if (stillOpen()) status.textContent = `새 PDF 작성 중 · ${done}/${total}쪽`;
              }
            }), () => cancelled || !stillOpen());
            if (cancelled || !stillOpen()) return;
            const filename = 'Sunrise_composed_pages.pdf';
            const download = document.createElement('button');
            download.type = 'button';
            download.className = 'dialog-btn primary';
            download.textContent = `${composed.pageCount}쪽 PDF 다운로드`;
            download.addEventListener('click', () => downloadLocal(composed.bytes, filename));
            result.append(download);
            status.textContent = `${composed.fileCount}개 원본에서 ${composed.pageCount}쪽 구성을 완료했습니다. 다운로드 버튼을 눌러 저장하세요.`;
          } catch (error) {
            if (!stillOpen()) return;
            status.textContent = (error?.name === 'AbortError' || cancelled) ?
              '작업이 취소되었습니다. 부분 PDF는 제공하지 않습니다.' :
              `페이지 구성을 완료하지 못했습니다: ${error?.message || 'PDF 오류'}`;
          } finally {
            running = false;
            if (stillOpen()) {
              start.disabled = false;
              filesInput.disabled = false;
              planInput.disabled = false;
              cancel.disabled = false;
              cancel.textContent = '닫기';
            }
          }
        });
      }
    });
  }

  function makeButton(id, icon, text, classes) {
    const button = document.createElement('button');
    button.type = 'button';
    button.id = id;
    button.className = classes;
    button.title = 'PDF 페이지 자유 구성';
    button.setAttribute('aria-label', 'PDF 페이지 자유 구성');
    const glyph = document.createElement('i');
    glyph.className = `fa-solid ${icon}`;
    button.append(glyph);
    if (text) {
      const label = document.createElement('span');
      label.textContent = text;
      button.append(label);
    }
    button.addEventListener('click', launchPageComposer);
    return button;
  }
  function mount() {
    const save = document.getElementById('quickSaveBtn');
    if (save && !document.getElementById('quickComposePagesBtn')) {
      save.insertAdjacentElement('afterend',
        makeButton('quickComposePagesBtn', 'fa-layer-group', '', 'quick-icon-btn'));
    }
    const mobileRight = document.getElementById('mobRightPaneBtn');
    if (mobileRight && !document.getElementById('mobComposePagesBtn')) {
      mobileRight.insertAdjacentElement('beforebegin',
        makeButton('mobComposePagesBtn', 'fa-layer-group', '쪽 구성', 'mobile-nav-btn'));
    }
  }
  root.SunrisePageComposerLaunch = launchPageComposer;
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mount, { once: true });
  } else {
    mount();
  }
})(typeof window !== 'undefined' ? window : globalThis);
