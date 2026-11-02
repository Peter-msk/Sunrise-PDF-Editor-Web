/* Sunrise PDF Editor: multi-source PDF page composer. No OCR or server I/O.
 * Browser-compatible UMD module. Copy source pages; never mutate inputs.
 * Source inspection and structural safety policy belong to SunriseBatchPages.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.SunrisePageComposer = api;
})(typeof globalThis !== 'undefined' ? globalThis : undefined, function () {
  'use strict';

  const MAX_FILES = 5;
  const MAX_TOTAL_PAGES = 250;
  const COPY_GROUP = 8;
  const LINE_RE = /^(\d+)\s*:\s*(\*|\d+(?:\s*-\s*\d+)?)(?:\s*@\s*([+-]?(?:0|90|180|270)))?$/;
  const BLANK_RE = /^blank\s*:\s*(A4|LETTER|([0-9]+(?:\.[0-9]+)?)\s*[xX]\s*([0-9]+(?:\.[0-9]+)?))$/i;
  const BOX_METHODS = ['getMediaBox', 'getCropBox', 'getBleedBox', 'getTrimBox', 'getArtBox'];

  function positiveInteger(value) {
    return Number.isSafeInteger(value) && value > 0;
  }
  function assertPageCounts(pageCounts) {
    if (!Array.isArray(pageCounts) || pageCounts.length < 1 || pageCounts.length > MAX_FILES ||
        !pageCounts.every(n => positiveInteger(n) && n <= MAX_TOTAL_PAGES)) {
      throw new Error('페이지 구성을 시작하려면 1~5개 PDF의 올바른 페이지 수가 필요합니다.');
    }
  }
  function normalRotation(angle) {
    if (!Number.isFinite(angle)) throw new Error('PDF 페이지 회전값을 확인할 수 없습니다.');
    const normalized = ((angle % 360) + 360) % 360;
    if (![0, 90, 180, 270].includes(normalized)) {
      throw new Error('90도 단위가 아닌 페이지 회전은 보존할 수 없습니다.');
    }
    return normalized;
  }
  function snapshot(page, rotationDelta = 0) {
    const boxes = {};
    for (const name of BOX_METHODS) {
      const box = page[name]();
      if (!['x', 'y', 'width', 'height'].every(key => Number.isFinite(box[key])) ||
          box.width <= 0 || box.height <= 0) {
        throw new Error('페이지 좌표 또는 크기가 유효하지 않습니다.');
      }
      boxes[name] = { x: box.x, y: box.y, width: box.width, height: box.height };
    }
    return { rotation: normalRotation(page.getRotation().angle + rotationDelta), boxes };
  }
  function compareSnapshots(expected, actual, position) {
    if (expected.rotation !== actual.rotation) {
      throw new Error(`결과 ${position}쪽의 회전각이 달라졌습니다.`);
    }
    for (const name of BOX_METHODS) {
      const a = expected.boxes[name], b = actual.boxes[name];
      if (!a || !b || !['x', 'y', 'width', 'height'].every(k =>
          Number.isFinite(a[k]) && Number.isFinite(b[k]) && Math.abs(a[k] - b[k]) < 0.01)) {
        throw new Error(`결과 ${position}쪽의 ${name} 영역이 달라졌습니다.`);
      }
    }
  }
  /**
   * Grammar: FILE:PAGE | FILE:START-END | FILE:* ; optional @+90/@-90.
   * `blank:A4`, `blank:LETTER`, and `blank:WIDTHxHEIGHT` add blank pages.
   * Comma, semicolon and newlines separate commands. Reversed ranges and
   * duplicate selections are deliberate and supported.
   * File and page numbers in user input are 1-based.
   */
  function parsePlan(planText, pageCounts) {
    assertPageCounts(pageCounts);
    if (typeof planText !== 'string' || planText.length > 15000 || !planText.trim()) {
      throw new Error('구성 순서를 입력해 주세요. 예: 1:1-3, 2:5-2@90, 1:4');
    }
    const tokens = planText.split(/[,;\n]+/).map(x => x.trim());
    if (tokens.some(t => !t)) throw new Error('페이지 구성 목록에 빈 항목이 있습니다.');
    const steps = [];
    for (const token of tokens) {
      const blank = BLANK_RE.exec(token);
      if (blank) {
        if (steps.length + 1 > MAX_TOTAL_PAGES) {
          throw new Error(`하나의 결과는 최대 ${MAX_TOTAL_PAGES}쪽까지 구성할 수 있습니다.`);
        }
        const dims = blank[1].toUpperCase() === 'A4' ? [595.28, 841.89] :
          blank[1].toUpperCase() === 'LETTER' ? [612, 792] : [Number(blank[2]), Number(blank[3])];
        if (!dims.every(n => Number.isFinite(n) && n >= 72 && n <= 14400)) {
          throw new Error('빈 페이지 크기는 가로·세로 각각 72~14400pt로 입력해 주세요.');
        }
        steps.push({ blank: true, width: dims[0], height: dims[1] });
        continue;
      }
      const match = LINE_RE.exec(token);
      if (!match) throw new Error(`구성 문법을 확인해 주세요: ${token.slice(0, 60)}`);
      const fileIndex = Number(match[1]) - 1;
      if (!Number.isSafeInteger(fileIndex) || fileIndex < 0 || fileIndex >= pageCounts.length) {
        throw new Error(`존재하지 않는 PDF 번호입니다: ${match[1]}`);
      }
      const count = pageCounts[fileIndex];
      const [first, last] = match[2] === '*' ? [1, count] :
        match[2].split('-').map(v => Number(v.trim()));
      const end = last === undefined ? first : last;
      if (!positiveInteger(first) || !positiveInteger(end) || first > count || end > count) {
        throw new Error(`${fileIndex + 1}번 PDF는 ${count}쪽입니다. 범위를 확인해 주세요: ${token}`);
      }
      const delta = match[3] === undefined ? 0 : Number(match[3]);
      if (![0, 90, -90, 180, -180, 270, -270].includes(delta)) {
        throw new Error(`지원하지 않는 회전각입니다: ${token}`);
      }
      const length = Math.abs(end - first) + 1;
      if (steps.length + length > MAX_TOTAL_PAGES) {
        throw new Error(`하나의 결과는 최대 ${MAX_TOTAL_PAGES}쪽까지 구성할 수 있습니다.`);
      }
      const direction = first <= end ? 1 : -1;
      for (let n = first; ; n += direction) {
        steps.push({ fileIndex, pageIndex: n - 1, delta });
        if (n === end) break;
      }
    }
    if (!steps.length) throw new Error('추출할 페이지를 하나 이상 선택해 주세요.');
    return steps;
  }
  async function yieldToBrowser() {
    await new Promise(resolve => setTimeout(resolve, 0));
  }
  function checkCancelled(cancelled) {
    if (cancelled?.()) {
      const e = new Error('페이지 구성 작업을 취소했습니다. 결과 파일은 생성하지 않았습니다.');
      e.name = 'AbortError';
      throw e;
    }
  }
  /**
   * Compose a new document from user-provided local File objects.
   * `readFile` resolves to Uint8Array; `checkSource` is the existing strict
   * PDF safety validator from SunriseBatchPages (mandatory).
   * A result is returned only after save/reopen and geometry verification.
   */
  async function compose(files, planText, options) {
    if (!Array.isArray(files) || files.length < 1 || files.length > MAX_FILES ||
        !files.every(f => positiveInteger(f?.size) && typeof f?.name === 'string')) {
      throw new Error('비어 있지 않은 PDF 1~5개를 선택해 주세요.');
    }
    const lib = options?.PDFLib;
    if (!lib?.PDFDocument || typeof lib.degrees !== 'function' ||
        typeof options?.readFile !== 'function' || typeof options?.checkSource !== 'function') {
      throw new Error('PDF 처리 엔진 또는 안전 검사 기능이 준비되지 않았습니다.');
    }
    const cancelled = options.cancelled;
    const sources = [];
    const pageCounts = [];
    for (let index = 0; index < files.length; index++) {
      checkCancelled(cancelled);
      const bytes = await options.readFile(files[index]);
      if (!ArrayBuffer.isView(bytes) || bytes.BYTES_PER_ELEMENT !== 1 ||
          bytes.byteLength !== files[index].size) {
        throw new Error(`${files[index].name}: 읽은 PDF의 크기가 원본과 다릅니다.`);
      }
      const pdf = await lib.PDFDocument.load(bytes, { updateMetadata: false });
      // Same conservative policy as the already-existing batch processor:
      // unsupported forms, outlines, signatures and native annotations fail
      // before copying, rather than silently disappearing from output.
      const pages = options.checkSource(pdf, lib, MAX_TOTAL_PAGES);
      sources.push({ pdf, pages });
      pageCounts.push(pages.length);
      options.onRead?.({ index: index + 1, total: files.length, name: files[index].name, pages: pages.length });
      await yieldToBrowser();
    }
    const plan = parsePlan(planText, pageCounts);
    checkCancelled(cancelled);
    const output = await lib.PDFDocument.create();
    output.setTitle('Sunrise PDF Editor - Custom Page Composition');
    output.setCreator('Sunrise PDF Editor');
    const expected = [];
    // Bounded contiguous groups preserve order while keeping the Cancel button
    // responsive. Repeated source pages are placed in separate groups so a
    // PDFPage object cannot be inserted twice into the result's page tree.
    for (let at = 0; at < plan.length;) {
      checkCancelled(cancelled);
      const first = plan[at];
      if (first.blank) {
        const blankPage = output.addPage([first.width, first.height]);
        expected.push(snapshot(blankPage));
        at++;
        options.onProgress?.({ done: at, total: plan.length, name: '빈 페이지' });
        await yieldToBrowser();
        continue;
      }
      const source = sources[first.fileIndex];
      const group = [first];
      const visited = new Set([first.pageIndex]);
      let cursor = at + 1;
      while (cursor < plan.length && group.length < COPY_GROUP &&
             plan[cursor].fileIndex === first.fileIndex && !visited.has(plan[cursor].pageIndex)) {
        group.push(plan[cursor]);
        visited.add(plan[cursor].pageIndex);
        cursor++;
      }
      const copied = await output.copyPages(source.pdf, group.map(item => item.pageIndex));
      for (let i = 0; i < copied.length; i++) {
        const item = group[i];
        const expectedPage = snapshot(source.pages[item.pageIndex], item.delta);
        copied[i].setRotation(lib.degrees(expectedPage.rotation));
        output.addPage(copied[i]);
        expected.push(expectedPage);
      }
      at = cursor;
      options.onProgress?.({ done: at, total: plan.length, name: files[first.fileIndex].name });
      await yieldToBrowser();
    }
    checkCancelled(cancelled);
    const bytes = await output.save({ updateFieldAppearances: false });
    checkCancelled(cancelled);
    if (!ArrayBuffer.isView(bytes) || bytes.BYTES_PER_ELEMENT !== 1 || !bytes.byteLength) {
      throw new Error('저장 결과를 확인할 수 없습니다.');
    }
    const restored = await lib.PDFDocument.load(bytes, { updateMetadata: false });
    const actual = options.checkSource(restored, lib, MAX_TOTAL_PAGES);
    if (actual.length !== expected.length) throw new Error('구성 결과의 페이지 수가 일치하지 않습니다.');
    for (let i = 0; i < actual.length; i++) {
      compareSnapshots(expected[i], snapshot(actual[i]), i + 1);
    }
    checkCancelled(cancelled);
    return { bytes, pageCount: actual.length, fileCount: files.length };
  }
  function defaultPlan(pageCounts) {
    assertPageCounts(pageCounts);
    return pageCounts.map((_, index) => `${index + 1}:*`).join(', ');
  }
  return { parsePlan, compose, defaultPlan, snapshot, MAX_FILES, MAX_TOTAL_PAGES };
});
