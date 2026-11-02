/* Sunrise PDF Editor — Forms and Page Markings panels.
 * Adds non-destructive local PDF tools without changing existing editor state.
 * Requires sunrise-pdf-form-tools.js and sunrise-pdf-stamper.js.
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
  const $ = id => document.getElementById(id);
  const h = (tag, text, attrs = {}) => {
    const element = document.createElement(tag);
    if (text !== undefined) element.textContent = text;
    for (const [key, value] of Object.entries(attrs)) element.setAttribute(key, value);
    return element;
  };
  const selectedFont = async input => {
    const file = input?.files?.[0];
    return file ? new Uint8Array(await file.arrayBuffer()) : undefined;
  };
  const getFontkit = () => root.fontkit || root.Fontkit || root.PDFLib?.fontkit;
  const readFile = file => root.readPdfInputFile(file);
  const activeDialog = start => $('modalBackdrop')?.classList.contains('open') &&
    document.contains(start);
  function errorText(error) {
    return error?.name === 'AbortError' ? '작업이 취소되었습니다. 부분 출력은 제공하지 않습니다.' :
      `작업을 완료하지 못했습니다: ${error?.message || '알 수 없는 오류'}`;
  }
  function downloadResult(result, fileName, destination, status, label) {
    destination.replaceChildren();
    const button = h('button', `${label} (${result.pageCount}쪽)`, { type: 'button', class: 'dialog-btn primary' });
    button.addEventListener('click', () => downloadLocal(result.bytes, fileName));
    destination.append(button);
    status.textContent = '새 PDF 작성이 완료됐습니다. 아래 버튼을 눌러 별도 파일로 다운로드하세요.';
  }
  function getFieldKindDisplay(type) {
    return ({ text: '텍스트', checkbox: '체크박스', dropdown: '선택 목록',
      radio: '라디오', optionlist: '복수 선택', signature: '전자서명', other: '기타' })[type] || type;
  }
  function formButton(label, onClick, variant = '') {
    const button = h('button', label, { type: 'button', class: `dialog-btn ${variant}`.trim() });
    button.addEventListener('click', onClick);
    return button;
  }
  function launchFormTools() {
    const core = root.SunrisePdfFormTools;
    if (!core?.apply || !root.PDFLib || !root.openModal || !root.readPdfInputFile) return;
    root.openModal({
      title: '별도 PDF 양식 필드 일괄 변경', icon: 'fa-list-check', width: '770px',
      bodyHtml: `<p><strong>역할 구분:</strong> 편집기에서 열린 문서의 일반 양식 편집은 Sunrise 본체에서 진행하세요. 이 도구는 아래에서 별도로 선택한 PDF 파일의 양식 필드를 일괄 변경하고 새 파일로 저장하는 보조 기능입니다. 현재 열린 문서에는 적용되지 않습니다. 원본은 덮어쓰지 않으며 서명·XFA 양식은 제외합니다.</p>
        <label for="sunFormInput">PDF 파일</label>
        <input type="file" id="sunFormInput" accept=".pdf,application/pdf" style="display:block;width:100%;margin:8px 0">
        <button type="button" id="sunFormInspect" class="dialog-btn">현재 양식 불러오기</button>
        <p id="sunFormSummary" role="status" aria-live="polite">먼저 PDF 파일을 선택해 주세요.</p>
        <div id="sunFormExisting"></div>
        <fieldset style="border:1px solid var(--border);padding:10px;min-width:0;margin:12px 0">
          <legend>새 양식 필드 추가</legend>
          <div class="dialog-form-grid">
            <label for="sunFormKind">필드 종류</label>
            <select id="sunFormKind" class="dialog-select"><option value="text">텍스트</option><option value="checkbox">체크박스</option><option value="dropdown">선택 목록</option></select>
            <label for="sunFormName">필드 이름</label><input class="dialog-input" id="sunFormName" placeholder="예: applicant.name">
            <label for="sunFormPage">쪽 번호</label><input class="dialog-input" id="sunFormPage" type="number" min="1" value="1">
            <label for="sunFormX">X (pt)</label><input class="dialog-input" id="sunFormX" type="number" value="60">
            <label for="sunFormY">Y (pt, 아래 기준)</label><input class="dialog-input" id="sunFormY" type="number" value="600">
            <label for="sunFormWidth">가로 (pt)</label><input class="dialog-input" id="sunFormWidth" type="number" value="180">
            <label for="sunFormHeight">세로 (pt)</label><input class="dialog-input" id="sunFormHeight" type="number" value="26">
            <label for="sunFormValue">초기 값</label><input class="dialog-input" id="sunFormValue" placeholder="텍스트 또는 선택값">
            <label for="sunFormOptions">선택 목록 항목</label><textarea id="sunFormOptions" class="dialog-textarea" rows="2" placeholder="한 줄에 한 항목"></textarea>
          </div>
          <label><input id="sunFormMultiline" type="checkbox"> 텍스트 여러 줄</label>
          <label style="margin-left:10px"><input id="sunFormReadOnly" type="checkbox"> 읽기 전용</label>
          <div style="margin-top:10px"><button type="button" class="dialog-btn" id="sunFormQueueAdd">필드 추가 예약</button></div>
        </fieldset>
        <label for="sunFormFont">유니코드 표시용 선택 글꼴(TTF/OTF, 선택)</label>
        <input type="file" id="sunFormFont" accept=".ttf,.otf,font/ttf,font/otf" style="display:block;width:100%">
        <p>한글 등 유니코드 양식 표시에는 선택한 글꼴과 편집기의 fontkit이 모두 필요합니다. 지원이 없으면 한글 값 저장을 차단합니다.</p>
        <strong>예약한 수정 작업</strong><div id="sunFormQueue"></div>
        <p id="sunFormStatus" role="status" aria-live="polite"></p><div id="sunFormOutput"></div>`,
      footerHtml: `<div></div><div class="modal-footer-right">
        <button id="sunFormApply" type="button" class="dialog-btn primary">새 양식 PDF 저장 준비</button>
        <button id="sunFormCancel" type="button" class="dialog-btn">닫기</button></div>`,
      onMount: () => {
        const input = $('sunFormInput'), summary = $('sunFormSummary'), status = $('sunFormStatus');
        const queueHost = $('sunFormQueue'), existingHost = $('sunFormExisting');
        const start = $('sunFormApply'), cancel = $('sunFormCancel');
        let sourceInfo = null, inspectedFile = null, queue = [], running = false, cancelled = false;
        function updateQueue() {
          queueHost.replaceChildren();
          if (!queue.length) queueHost.append(h('p', '현재 예약된 수정 작업이 없습니다.'));
          queue.forEach((op, index) => {
            const row = h('div', undefined, { style: 'display:flex;gap:8px;align-items:center;margin:6px 0' });
            row.append(h('span', `${index + 1}. ${op.name} — ${op.action === 'add' ? '추가' : op.action === 'set' ? '값 변경' : op.action === 'delete' ? '제거' : '읽기 전용 설정'}`));
            row.append(formButton('제외', () => { queue.splice(index, 1); updateQueue(); }));
            queueHost.append(row);
          });
        }
        function appendChange(change) {
          if (queue.length >= core.MAX_OPERATIONS) { status.textContent = '수정 작업은 최대 150개까지 예약할 수 있습니다.'; return; }
          queue.push(change); updateQueue();
        }
        function showFields(fields) {
          existingHost.replaceChildren();
          existingHost.append(h('strong', `기존 필드 ${fields.length}개`));
          for (const field of fields) {
            const row = h('div', undefined, { style: 'display:flex;flex-wrap:wrap;gap:6px;align-items:center;padding:6px;border-bottom:1px solid var(--border-soft)' });
            row.append(h('span', `${field.name} (${getFieldKindDisplay(field.type)}${field.readOnly ? ' · 읽기 전용' : ''})`));
            const supported = core.SUPPORTED_FIELD_TYPES.includes(field.type);
            if (supported) {
              let edit;
              if (field.type === 'checkbox') {
                edit = h('input', undefined, { type: 'checkbox', 'aria-label': `${field.name} 값` });
                edit.checked = Boolean(field.value);
              } else if (field.type === 'dropdown') {
                edit = h('select', undefined, { 'aria-label': `${field.name} 값` });
                for (const value of field.options || []) {
                  const option = h('option', value, { value });
                  edit.append(option);
                }
                edit.value = field.value?.[0] ?? '';
              } else {
                edit = h('input', undefined, { type: 'text', class: 'dialog-input', 'aria-label': `${field.name} 값` });
                edit.value = field.value ?? '';
              }
              row.append(edit);
              const setButton = formButton('값 변경 예약', () => appendChange({
                action: 'set', name: field.name, value: field.type === 'checkbox' ? edit.checked : edit.value
              }));
              setButton.disabled = field.readOnly;
              row.append(setButton);
              row.append(formButton('삭제 예약', () => appendChange({ action: 'delete', name: field.name })));
              row.append(formButton(field.readOnly ? '잠금 해제 예약' : '읽기 전용 예약', () =>
                appendChange({ action: 'readonly', name: field.name, value: !field.readOnly })));
            } else {
              row.append(h('span', '보호된 유형 · 수정 불가'));
            }
            existingHost.append(row);
          }
        }
        input.addEventListener('change', () => {
          sourceInfo = null; inspectedFile = null; queue = [];
          existingHost.replaceChildren(); updateQueue();
          summary.textContent = '다른 파일을 선택했습니다. 현재 양식을 다시 불러와 주세요.';
          $('sunFormOutput').replaceChildren();
        });
        $('sunFormInspect').addEventListener('click', async () => {
          if (running || !input.files?.[0]) { status.textContent = 'PDF 파일을 선택해 주세요.'; return; }
          running = true;
          try {
            const chosenFile = input.files[0];
            const result = await core.inspect(chosenFile, { PDFLib: root.PDFLib, readFile });
            if (!activeDialog(start) || input.files[0] !== chosenFile) return;
            sourceInfo = result; inspectedFile = chosenFile;
            $('sunFormPage').max = String(result.pageCount);
            summary.textContent = `${result.pageCount}쪽 · 기존 양식 ${result.fields.length}개`;
            showFields(result.fields);
          } catch (error) { status.textContent = errorText(error); }
          finally { running = false; }
        });
        $('sunFormQueueAdd').addEventListener('click', () => {
          if (!sourceInfo) { status.textContent = '현재 양식을 먼저 불러와 주세요.'; return; }
          const kind = $('sunFormKind').value;
          const op = {
            action: 'add', type: kind, name: $('sunFormName').value.trim(),
            page: Number($('sunFormPage').value), x: Number($('sunFormX').value),
            y: Number($('sunFormY').value), width: Number($('sunFormWidth').value),
            height: Number($('sunFormHeight').value),
            readOnly: $('sunFormReadOnly').checked, multiline: $('sunFormMultiline').checked
          };
          if (kind === 'checkbox') op.value = $('sunFormValue').value.trim().toLowerCase() === 'true';
          else op.value = $('sunFormValue').value;
          if (kind === 'dropdown') op.options = $('sunFormOptions').value.split(/\r?\n/).map(x => x.trim()).filter(Boolean);
          appendChange(op);
        });
        cancel.addEventListener('click', () => {
          if (!running) root.closeModal();
          else { cancelled = true; cancel.disabled = true; status.textContent = '안전한 시점에 취소 중입니다.'; }
        });
        start.addEventListener('click', async () => {
          if (running || !sourceInfo || !queue.length) { status.textContent = '원본을 불러온 뒤 수정 작업을 예약해 주세요.'; return; }
          const source = input.files[0];
          if (!source || source !== inspectedFile) {
            status.textContent = '검사한 파일과 현재 선택한 파일이 다릅니다. 양식을 다시 불러와 주세요.';
            return;
          }
          running = true; cancelled = false; start.disabled = true;
          cancel.textContent = '작업 취소'; $('sunFormOutput').replaceChildren();
          try {
            const fontBytes = await selectedFont($('sunFormFont'));
            const result = await runTracked('local_form_edit', () => core.apply(source, queue, {
              PDFLib: root.PDFLib, readFile, fontBytes, fontkit: getFontkit(),
              cancelled: () => cancelled || !activeDialog(start),
              onProgress: ({ done, total }) => {
                if (activeDialog(start)) status.textContent = `양식 수정 중 ${done}/${total}`;
              }
            }), () => cancelled || !activeDialog(start));
            if (!cancelled && activeDialog(start)) {
              downloadResult(result, source.name.replace(/\.pdf$/i, '') + '_forms.pdf',
                $('sunFormOutput'), status, `양식 PDF 다운로드 · ${result.fieldCount}개 필드`);
            }
          } catch (error) { if (activeDialog(start)) status.textContent = errorText(error); }
          finally {
            running = false; start.disabled = false; cancel.disabled = false;
            cancel.textContent = '닫기';
          }
        });
        updateQueue();
      }
    });
  }
  function launchPdfStamper(mode = 'number') {
    const core = root.SunrisePdfStamper;
    if (!core?.apply || !root.PDFLib || !root.openModal || !root.readPdfInputFile) return;
    root.openModal({
      title: '페이지 번호·워터마크', icon: 'fa-stamp', width: '640px',
      bodyHtml: `<p>선택한 PDF에 페이지 번호와 워터마크를 새 레이어로 삽입한 별도 파일을 만듭니다. 원본 PDF는 변경하지 않습니다.</p>
        <label for="sunStampFile">PDF 선택</label>
        <input type="file" id="sunStampFile" accept=".pdf,application/pdf" style="display:block;width:100%;margin:6px 0">
        <label for="sunStampRange">적용할 페이지 (전체: * 또는 예: 1-3,5)</label>
        <input id="sunStampRange" class="dialog-input" value="*">
        <fieldset style="border:1px solid var(--border);padding:10px;margin:10px 0">
          <legend><label><input type="checkbox" id="sunStampNumberOn" checked> 페이지 번호</label></legend>
          <div class="dialog-form-grid">
            <label for="sunStampTemplate">번호 표시 형식</label><input id="sunStampTemplate" class="dialog-input" value="{page} / {total}">
            <label for="sunStampNumberStart">시작 번호</label><input id="sunStampNumberStart" class="dialog-input" type="number" min="0" value="1">
            <label for="sunStampPosition">표시 위치</label><select id="sunStampPosition" class="dialog-select">
              <option value="bottom-center">아래 가운데</option><option value="bottom-left">아래 왼쪽</option>
              <option value="bottom-right">아래 오른쪽</option><option value="top-center">위 가운데</option>
              <option value="top-left">위 왼쪽</option><option value="top-right">위 오른쪽</option></select>
            <label for="sunStampMargin">여백 pt</label><input id="sunStampMargin" class="dialog-input" type="number" min="0" value="24">
            <label for="sunStampNumberSize">글자 크기 pt</label><input id="sunStampNumberSize" class="dialog-input" type="number" min="6" value="11">
          </div>
        </fieldset>
        <fieldset style="border:1px solid var(--border);padding:10px;margin:10px 0">
          <legend><label><input id="sunStampMarkOn" type="checkbox"> 워터마크</label></legend>
          <div class="dialog-form-grid">
            <label for="sunStampText">문구</label><input id="sunStampText" class="dialog-input" value="DRAFT">
            <label for="sunStampSize">글자 크기 pt</label><input id="sunStampSize" class="dialog-input" type="number" min="8" value="65">
            <label for="sunStampOpacity">불투명도 (0.03~0.65)</label><input id="sunStampOpacity" class="dialog-input" type="number" min="0.03" max="0.65" step="0.01" value="0.15">
            <label for="sunStampAngle">기울기 (-65~65도)</label><input id="sunStampAngle" class="dialog-input" type="number" min="-65" max="65" value="-30">
          </div>
        </fieldset>
        <label for="sunStampFont">유니코드용 글꼴 TTF/OTF (선택, fontkit 필요)</label>
        <input type="file" id="sunStampFont" accept=".ttf,.otf,font/ttf,font/otf" style="display:block;width:100%">
        <p id="sunStampStatus" role="status" aria-live="polite">PDF와 표시 옵션을 선택해 주세요.</p>
        <div id="sunStampOutput"></div>`,
      footerHtml: `<div></div><div class="modal-footer-right">
        <button id="sunStampApply" type="button" class="dialog-btn primary">새 PDF 작성</button>
        <button id="sunStampCancel" type="button" class="dialog-btn">닫기</button></div>`,
      onMount: () => {
        const input = $('sunStampFile'), status = $('sunStampStatus');
        const start = $('sunStampApply'), cancel = $('sunStampCancel');
        let running = false, cancelled = false;
        if (mode === 'watermark') {
          $('sunStampNumberOn').checked = false;
          $('sunStampMarkOn').checked = true;
        }
        input.addEventListener('change', () => $('sunStampOutput').replaceChildren());
        cancel.addEventListener('click', () => {
          if (!running) root.closeModal();
          else { cancelled = true; cancel.disabled = true; status.textContent = '현재 페이지 처리가 끝나면 취소합니다.'; }
        });
        start.addEventListener('click', async () => {
          if (running || !input.files?.[0]) { status.textContent = '원본 PDF 파일을 선택해 주세요.'; return; }
          const file = input.files[0];
          running = true; cancelled = false; start.disabled = true; cancel.textContent = '작업 취소';
          $('sunStampOutput').replaceChildren();
          const settings = {
            pages: $('sunStampRange').value.trim(),
            number: {
              enabled: $('sunStampNumberOn').checked, template: $('sunStampTemplate').value,
              startAt: Number($('sunStampNumberStart').value), position: $('sunStampPosition').value,
              fontSize: Number($('sunStampNumberSize').value), margin: Number($('sunStampMargin').value)
            },
            watermark: {
              enabled: $('sunStampMarkOn').checked, text: $('sunStampText').value,
              fontSize: Number($('sunStampSize').value), opacity: Number($('sunStampOpacity').value),
              angle: Number($('sunStampAngle').value)
            }
          };
          try {
            const fontBytes = await selectedFont($('sunStampFont'));
            const result = await runTracked('local_stamp', () => core.apply(file, settings, {
              PDFLib: root.PDFLib, readFile, fontBytes, fontkit: getFontkit(),
              cancelled: () => cancelled || !activeDialog(start),
              onProgress: ({ done, total }) => {
                if (activeDialog(start)) status.textContent = `페이지 표시 중 ${done}/${total}`;
              }
            }), () => cancelled || !activeDialog(start));
            if (!cancelled && activeDialog(start)) {
              downloadResult(result, file.name.replace(/\.pdf$/i, '') + '_marked.pdf',
                $('sunStampOutput'), status, `꾸민 PDF 다운로드 · ${result.affectedPages}쪽 적용`);
            }
          } catch (error) { if (activeDialog(start)) status.textContent = errorText(error); }
          finally { running = false; start.disabled = false; cancel.disabled = false; cancel.textContent = '닫기'; }
        });
      }
    });
  }
  function makeQuickButton(id, icon, title, handler) {
    const button = h('button', undefined, { id, type: 'button', class: 'quick-icon-btn', title, 'aria-label': title });
    button.append(h('i', undefined, { class: `fa-solid ${icon}` }));
    button.addEventListener('click', handler);
    return button;
  }
  function injectMobileTools() {
    const menu = $('mobileFileMerge');
    if (!menu || $('sunMobileFormAction')) return;
    const form = formButton('PDF 양식 편집', () => { root.closeModal(); launchFormTools(); });
    form.id = 'sunMobileFormAction';
    const stamp = formButton('페이지 번호·워터마크', () => { root.closeModal(); launchPdfStamper(); });
    stamp.id = 'sunMobileStampAction';
    menu.insertAdjacentElement('afterend', form);
    form.insertAdjacentElement('afterend', stamp);
  }
  function mount() {
    const top = $('quickSaveBtn');
    if (top && !$('sunFormQuickBtn')) {
      const form = makeQuickButton('sunFormQuickBtn', 'fa-list-check', 'PDF 양식 만들기·수정', launchFormTools);
      const stamp = makeQuickButton('sunStampQuickBtn', 'fa-stamp', '페이지 번호·워터마크', launchPdfStamper);
      top.insertAdjacentElement('afterend', stamp);
      top.insertAdjacentElement('afterend', form);
    }
    const mobileFiles = $('mobFileBtn');
    if (mobileFiles) mobileFiles.addEventListener('click', () => queueMicrotask(injectMobileTools));
  }
  root.SunrisePdfFormToolsLaunch = launchFormTools;
  root.SunrisePdfStampLaunch = launchPdfStamper;
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount, { once: true });
  else mount();
})(typeof window !== 'undefined' ? window : globalThis);
