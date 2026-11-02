/* Sunrise PDF Editor — LOCAL-06, multi-file submission preflight.
 * Reuses the existing SunrisePdfQuality and SunrisePdfQualityReport contracts.
 * Browser-local only: does not upload, persist, or modify source PDF bytes.
 * Source-only development; integration, execution tests and release pending.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.SunriseBatchPreflight = api;
})(typeof globalThis !== 'undefined' ? globalThis : undefined, function () {
  'use strict';

  const MAX_FILES = 20;
  const MAX_FILE_NAME_LENGTH = 240;
  const VALID_STATES = new Set(['checked', 'review', 'error']);

  function createAbortError() {
    const err = new Error('사용자가 일괄 PDF 품질검사를 취소했습니다.');
    err.name = 'AbortError';
    return err;
  }

  function assertNotCancelled(options) {
    if (options.cancelled?.()) throw createAbortError();
  }

  function reportProgress(options, state) {
    options.onProgress?.(Object.freeze({ ...state }));
  }

  function normalizeFiles(inputs) {
    if (!inputs || typeof inputs[Symbol.iterator] !== 'function') {
      throw new Error('PDF 파일 목록을 선택해 주세요.');
    }
    const files = Array.from(inputs);
    if (files.length < 1 || files.length > MAX_FILES) {
      throw new Error(`한 번에 1~${MAX_FILES}개 PDF를 선택해 주세요.`);
    }
    let sum = 0;
    for (const [index, file] of files.entries()) {
      if (!file || !Number.isSafeInteger(file.size) || file.size < 1 ||
          typeof file.name !== 'string' || !file.name ||
          file.name.length > MAX_FILE_NAME_LENGTH) {
        throw new Error(`${index + 1}번째 파일의 이름 또는 크기가 올바르지 않습니다.`);
      }
      if (!/\.pdf$/i.test(file.name.trim()) && file.type !== 'application/pdf') {
        throw new Error(`${index + 1}번째 파일은 PDF 형식이 아닙니다.`);
      }
      if (!Number.isSafeInteger(sum + file.size)) {
        throw new Error('선택한 PDF의 총 바이트 수를 안전하게 계산할 수 없습니다.');
      }
      sum += file.size;
    }
    return files;
  }

  function normalizeOptions(options) {
    if (!options || !options.PDFLib?.PDFDocument?.load ||
        typeof options.readFile !== 'function' ||
        typeof options.quality?.inspect !== 'function') {
      throw new Error('Sunrise PDF 검사 엔진 또는 파일 읽기 기능이 연결되지 않았습니다.');
    }
    if (options.cancelled != null && typeof options.cancelled !== 'function') {
      throw new Error('취소 콜백이 올바르지 않습니다.');
    }
    if (options.onProgress != null && typeof options.onProgress !== 'function') {
      throw new Error('진행률 콜백이 올바르지 않습니다.');
    }
    return options;
  }

  // Give the browser a chance to handle the Cancel button between files.
  // Parsing a single large PDF and pdf-lib operations may not interrupt instantly.
  function yieldToBrowser() {
    return new Promise(resolve => setTimeout(resolve, 0));
  }

  function toFailedEntry(file, index, error) {
    return {
      index: index + 1,
      name: file.name,
      bytes: file.size,
      status: 'failed',
      pageCount: null,
      scannedPages: 0,
      errors: 0,
      reviews: 0,
      issues: [],
      message: String(error?.message || 'PDF 검사를 완료하지 못했습니다.').slice(0, 600),
      limitations: '검사 실행 실패: PDF 상태에 대한 판정이 아닙니다.'
    };
  }

  function toCompletedEntry(file, index, report) {
    if (!report || !VALID_STATES.has(report.status) ||
        !Number.isSafeInteger(report.pageCount) || report.pageCount < 1 ||
        !Number.isSafeInteger(report.errors) || report.errors < 0 ||
        !Number.isSafeInteger(report.reviews) || report.reviews < 0 ||
        !Array.isArray(report.issues)) {
      throw new Error('단일 PDF 검사 결과 형식이 올바르지 않습니다.');
    }
    return {
      index: index + 1,
      name: file.name,
      bytes: file.size,
      status: report.status,
      pageCount: report.pageCount,
      scannedPages: report.scannedPages ?? 0,
      errors: report.errors,
      reviews: report.reviews,
      issues: report.issues.map(issue => ({
        page: Number.isSafeInteger(issue.page) && issue.page > 0 ? issue.page : null,
        severity: issue.severity === 'error' ? 'error' : 'review',
        code: String(issue.code ?? '').slice(0, 100),
        message: String(issue.message ?? '').slice(0, 2000)
      })),
      message: '',
      limitations: String(report.limitations ?? '제출 적합성을 보증하지 않습니다.').slice(0, 1000)
    };
  }

  function createSummary(entries) {
    const summary = {
      total: entries.length, checked: 0, review: 0, error: 0, failed: 0,
      totalPages: 0, scannedPages: 0, issueErrors: 0, issueReviews: 0
    };
    for (const entry of entries) {
      summary[entry.status] += 1;
      if (entry.status !== 'failed') {
        summary.totalPages += entry.pageCount;
        summary.scannedPages += entry.scannedPages;
        summary.issueErrors += entry.errors;
        summary.issueReviews += entry.reviews;
      }
    }
    // 'checked' means no findings *within the limited inspection*, not safe/certified.
    return summary;
  }

  /**
   * @param {Iterable<File>} inputs Files to read sequentially; never rewritten.
   * @param {object} options Must provide PDFLib, readFile and quality.inspect.
   * @returns {Promise<{entries:object[],summary:object,limitations:string}>}
   * File-level parse failures are captured; user cancellation rejects atomically.
   */
  async function inspectBatch(inputs, options) {
    const files = normalizeFiles(inputs);
    const opts = normalizeOptions(options);
    const entries = [];
    for (let index = 0; index < files.length; index += 1) {
      assertNotCancelled(opts);
      await yieldToBrowser();
      assertNotCancelled(opts);
      const file = files[index];
      reportProgress(opts, { index: index + 1, total: files.length, name: file.name, phase: 'reading', completed: entries.length });
      try {
        let bytes = await opts.readFile(file);
        assertNotCancelled(opts);
        if (bytes instanceof ArrayBuffer) bytes = new Uint8Array(bytes);
        if (!(bytes instanceof Uint8Array) || bytes.byteLength !== file.size) {
          throw new Error('PDF 파일의 실제 바이트 수가 선택한 파일 크기와 다릅니다.');
        }
        reportProgress(opts, { index: index + 1, total: files.length, name: file.name, phase: 'inspecting', completed: entries.length });
        const result = await opts.quality.inspect(bytes, {
          PDFLib: opts.PDFLib,
          pdfjsLib: opts.pdfjsLib,
          maxPages: opts.maxPages,
          cancelled: () => Boolean(opts.cancelled?.()),
          onProgress: (done, total) => {
            reportProgress(opts, { index: index + 1, total: files.length, name: file.name,
              phase: 'scanning', pageDone: done, pageTotal: total, completed: entries.length });
          }
        });
        assertNotCancelled(opts);
        entries.push(toCompletedEntry(file, index, result));
      } catch (error) {
        // Never present a cancelled/partial batch as a completed result.
        if (opts.cancelled?.() || error?.name === 'AbortError') throw createAbortError();
        entries.push(toFailedEntry(file, index, error));
      }
      assertNotCancelled(opts);
      reportProgress(opts, { index: index + 1, total: files.length, name: file.name, phase: 'done', completed: entries.length });
      // Only small summaries are retained. PDF bytes are not stored or returned.
    }
    assertNotCancelled(opts);
    return {
      format: 'Sunrise PDF Batch Preflight v1',
      entries,
      summary: createSummary(entries),
      limitations: '검사 완료는 제출 적합성 인증이 아닙니다. OCR, 시각적 표시 품질, PDF/A 준수, 서명 유효성 및 전체 페이지 검사 여부는 별도 확인하세요.'
    };
  }

  function csvExport(batch, reportModule) {
    if (!batch || batch.format !== 'Sunrise PDF Batch Preflight v1' ||
        !Array.isArray(batch.entries) || !batch.summary ||
        typeof reportModule?.csvCell !== 'function') {
      throw new Error('일괄검사 결과 또는 CSV 내보내기 엔진이 올바르지 않습니다.');
    }
    const row = values => values.map(reportModule.csvCell).join(',');
    const lines = [row(['번호', '파일 이름', '파일 크기(바이트)', '검사 결과', '총 페이지', '내용 검사 페이지',
      '구조 오류', '검토 필요', '문제 페이지', '이슈 코드', '구체 내용'])];
    for (const item of batch.entries) {
      lines.push(row([item.index, item.name, item.bytes, item.status,
        item.pageCount ?? '', item.scannedPages, item.errors, item.reviews,
        '', item.status === 'failed' ? 'inspection-failed' : 'summary', item.message || item.limitations]));
      for (const issue of item.issues) {
        lines.push(row([item.index, item.name, '', issue.severity, '', '', '', '',
          issue.page ?? '', issue.code, issue.message]));
      }
    }
    lines.push(row(['전체', '', '', '합계', batch.summary.totalPages,
      batch.summary.scannedPages, batch.summary.issueErrors, batch.summary.issueReviews,
      '', 'limitations', batch.limitations]));
    return '\uFEFF' + lines.join('\r\n') + '\r\n';
  }

  return Object.freeze({ MAX_FILES, inspectBatch, csvExport, normalizeFiles });
});
