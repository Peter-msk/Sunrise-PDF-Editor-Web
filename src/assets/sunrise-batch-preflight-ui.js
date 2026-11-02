/* Sunrise PDF Editor — LOCAL-06 browser UI.
 * Requires the existing modal, PDF input reader, PDFLib and quality report.
 * No files or results are uploaded, and no network calls are issued.
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
  if (!root?.document) return;
  const doc = root.document;
  const $ = id => doc.getElementById(id);
  const node = (tag, value, className) => {
    const result = doc.createElement(tag);
    if (value !== undefined) result.textContent = value;
    if (className) result.className = className;
    return result;
  };

  function ready() {
    return root.SunriseBatchPreflight?.inspectBatch && root.SunrisePdfQuality?.inspect &&
      root.SunrisePdfQualityReport?.csvCell && root.PDFLib?.PDFDocument &&
      typeof root.openModal === 'function' && typeof root.closeModal === 'function' &&
      typeof root.readPdfInputFile === 'function' && typeof root.downloadBytes === 'function';
  }

  function style() {
    if ($('sunriseBatchPreflightStyle')) return;
    const css = node('style');
    css.id = 'sunriseBatchPreflightStyle';
    css.textContent = `
      .sunrise-batch-progress { margin:9px 0; padding:9px; background:var(--surface-soft,#f4f7fa); border:1px solid var(--border,#ccd5df); border-radius:8px; line-height:1.5; }
      .sunrise-batch-result-scroll { max-height:265px; overflow:auto; border:1px solid var(--border,#ccd5df); border-radius:8px; margin-top:10px; }
      .sunrise-batch-table { width:100%; border-collapse:collapse; font-size:12px; white-space:normal; }
      .sunrise-batch-table th,.sunrise-batch-table td { padding:8px 7px; text-align:left; border-bottom:1px solid var(--border,#ccd5df); vertical-align:top; }
      .sunrise-batch-table th { position:sticky; top:0; background:var(--surface,#fff); }
      .sunrise-batch-name { overflow-wrap:anywhere; min-width:100px; max-width:245px; }
      .sunrise-batch-warning { margin:9px 0; color:var(--text-muted,#647687); font-size:12px; line-height:1.6; }
      #sunriseBatchPreflightQuick { min-width:38px; min-height:38px; }
      @media(max-width:570px){.sunrise-batch-table{font-size:11px}.sunrise-batch-table th,.sunrise-batch-table td{padding:6px 4px;}}
    `;
    doc.head.append(css);
  }

  function appendSummary(host, batch) {
    host.replaceChildren();
    const s = batch.summary;
    host.append(node('p', `검사 완료 ${s.total}개 · 확인 항목 없음 ${s.checked}개 · 확인 필요 ${s.review}개 · 구조 오류 ${s.error}개 · 검사 실패 ${s.failed}개`));
    const scroll = node('div', undefined, 'sunrise-batch-result-scroll');
    const table = node('table', undefined, 'sunrise-batch-table');
    const thead = node('thead'), trHead = node('tr');
    for (const title of ['순서', '파일', '결과', '전체 쪽', '내용 검사', '오류 / 검토']) {
      trHead.append(node('th', title));
    }
    thead.append(trHead);
    const tbody = node('tbody');
    const statusName = { checked:'범위 내 확인 항목 없음', review:'확인 필요', error:'구조 오류', failed:'검사 실패' };
    for (const item of batch.entries) {
      const tr = node('tr');
      for (const [i, value] of [item.index, item.name, statusName[item.status],
        item.pageCount ?? '-', item.scannedPages, `${item.errors} / ${item.reviews}`].entries()) {
        const td = node('td', String(value));
        if (i === 1) { td.className = 'sunrise-batch-name'; td.title = item.name; }
        tr.append(td);
      }
      tbody.append(tr);
    }
    table.append(thead, tbody);
    scroll.append(table);
    host.append(scroll, node('p', batch.limitations, 'sunrise-batch-warning'));
    if (batch.entries.some(x => x.status === 'failed')) {
      host.append(node('p', '일부 파일 검사가 실패했습니다. 실패한 파일의 상세 원인은 CSV 결과에서 확인하세요.', 'sunrise-batch-warning'));
    }
  }

  function launch() {
    if (!ready()) {
      if (typeof root.showToast === 'function') root.showToast('일괄검사 모듈 연결을 확인해 주세요.', 'fa-circle-exclamation');
      return;
    }
    style();
    root.openModal({
      title: 'PDF 일괄 제출 전 검사', icon: 'fa-clipboard-check', width: '780px',
      bodyHtml: `<p>최대 20개 PDF를 순서대로 검사합니다. 파일은 서버로 전송하지 않고, 검사 결과만 CSV로 내려받을 수 있습니다.</p>
        <label for="sunrisePreflightFiles">검사할 PDF 파일</label>
        <input id="sunrisePreflightFiles" type="file" accept=".pdf,application/pdf" multiple style="display:block;width:100%;margin:9px 0;min-height:42px">
        <div id="sunrisePreflightProgress" class="sunrise-batch-progress" role="status" aria-live="polite">파일을 선택해 주세요.</div>
        <div id="sunrisePreflightResult"></div>
        <p class="sunrise-batch-warning">검사는 PDF의 제한된 구조와 일부 페이지 표시 명령을 점검하는 사전 확인입니다. 법정 제출 적합성, 글꼴 시각 품질, PDF/A, 전자서명을 인증하지 않습니다.</p>`,
      footerHtml: `<div></div><div class="modal-footer-right">
        <button id="sunrisePreflightRun" class="dialog-btn primary" type="button">일괄검사 실행</button>
        <button id="sunrisePreflightCsv" class="dialog-btn" type="button" disabled>CSV 보고서 다운로드</button>
        <button id="sunrisePreflightCancel" class="dialog-btn" type="button">닫기</button>
      </div>`,
      onMount: () => {
        const input = $('sunrisePreflightFiles');
        const progress = $('sunrisePreflightProgress');
        const output = $('sunrisePreflightResult');
        const run = $('sunrisePreflightRun');
        const csv = $('sunrisePreflightCsv');
        const cancel = $('sunrisePreflightCancel');
        let running = false, stopped = false, finalReport = null;
        const visible = () => doc.contains(run);
        const clearReport = () => {
          if (!running) { finalReport = null; csv.disabled = true; output.replaceChildren(); }
        };
        input.addEventListener('change', () => {
          clearReport();
          progress.textContent = `${input.files?.length ?? 0}개 파일이 선택되었습니다.`;
        });
        cancel.addEventListener('click', () => {
          if (!running) { root.closeModal(); return; }
          stopped = true;
          cancel.disabled = true;
          progress.textContent = '취소 요청됨. 현재 파일 작업이 끝나는 대로 중단합니다.';
        });
        run.addEventListener('click', async () => {
          if (running) return;
          running = true;
          stopped = false;
          finalReport = null;
          run.disabled = true;
          csv.disabled = true;
          input.disabled = true;
          cancel.textContent = '작업 취소';
          output.replaceChildren();
          try {
            const report = await runTracked('local_batch_preflight', () => root.SunriseBatchPreflight.inspectBatch(input.files, {
              PDFLib: root.PDFLib,
              pdfjsLib: root.pdfjsLib,
              readFile: root.readPdfInputFile,
              quality: root.SunrisePdfQuality,
              cancelled: () => stopped || !visible(),
              onProgress: ({ index, total, name, phase, pageDone, pageTotal, completed }) => {
                if (!visible() || stopped) return;
                const title = { reading:'읽기', inspecting:'구조 검사', scanning:'페이지 내용 검사', done:'완료' }[phase] || phase;
                progress.textContent = `${index}/${total} · ${name} · ${title}${pageTotal ? ` ${pageDone}/${pageTotal}쪽` : ''} · 완료 ${completed}개`;
              }
            }), () => stopped || !visible());
            if (!visible() || stopped) return;
            finalReport = report;
            appendSummary(output, report);
            csv.disabled = false;
            progress.textContent = '일괄검사가 종료되었습니다. 결과 내용을 확인한 후 CSV로 저장하세요.';
          } catch (error) {
            if (visible()) {
              progress.textContent = error?.name === 'AbortError'
                ? '사용자가 취소했습니다. 부분 검사 결과는 제공하지 않습니다.'
                : error?.message || '일괄 PDF 검사를 실행하지 못했습니다.';
            }
          } finally {
            running = false;
            if (visible()) {
              run.disabled = false;
              input.disabled = false;
              cancel.disabled = false;
              cancel.textContent = '닫기';
            }
          }
        });
        csv.addEventListener('click', () => {
          if (!finalReport || running) return;
          try {
            const text = root.SunriseBatchPreflight.csvExport(finalReport, root.SunrisePdfQualityReport);
            const bytes = new TextEncoder().encode(text);
            const stamp = new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10); // KST
            downloadLocal(bytes, `sunrise_pdf_preflight_${stamp}.csv`);
          } catch (error) {
            progress.textContent = error?.message || 'CSV 보고서를 생성하지 못했습니다.';
          }
        });
      }
    });
  }

  function mount() {
    style();
    const anchor = $('quickOpenBtn') || $('workspaceCommandBar');
    if (anchor && !$('sunriseBatchPreflightQuick')) {
      const button = node('button', undefined, 'quick-icon-btn');
      button.id = 'sunriseBatchPreflightQuick';
      button.type = 'button';
      button.title = 'PDF 일괄 제출 전 검사';
      button.setAttribute('aria-label', 'PDF 일괄 제출 전 검사');
      const icon = node('i', undefined, 'fa-solid fa-clipboard-check');
      icon.setAttribute('aria-hidden', 'true');
      button.append(icon);
      button.addEventListener('click', launch);
      if (anchor.id === 'workspaceCommandBar') anchor.append(button);
      else anchor.insertAdjacentElement('afterend', button);
    }
    const mobile = $('mobFileBtn');
    if (mobile) mobile.addEventListener('click', () => root.queueMicrotask?.(() => {
      const menu = $('mobileFileMerge');
      if (!menu || $('sunriseBatchPreflightMobile')) return;
      const button = node('button', 'PDF 일괄 제출 전 검사', 'dialog-btn');
      button.type = 'button';
      button.id = 'sunriseBatchPreflightMobile';
      button.addEventListener('click', () => { root.closeModal(); launch(); });
      menu.insertAdjacentElement('afterend', button);
    }));
  }

  root.SunriseBatchPreflightLaunch = launch;
  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', mount, { once: true });
  else mount();
})(typeof window !== 'undefined' ? window : undefined);
