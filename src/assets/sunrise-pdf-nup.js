/* Sunrise PDF Editor Web — LOCAL-10 vector N-up (multiple PDF pages per sheet).
 * Authoring overlay only. Browser-local pdf-lib; no OCR, upload or source mutation.
 * Embedding pages creates printable appearance, NOT an editable/semantic copy:
 * document structure, annotations, form fields, accessibility tags and signatures
 * are not retained. Unsupported inputs are refused before any output is offered.
 */
(function(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.SunrisePdfNup = api;
})(typeof globalThis !== 'undefined' ? globalThis : undefined, function() {
  'use strict';

  const MM_TO_PT = 72 / 25.4;
  const MAX_FILES = 5;
  const MAX_PAGES = 250;
  const MAX_TOTAL_INPUT_BYTES = 120 * 1024 * 1024; // protect local device memory
  const MAX_OUTPUT_BYTES = 250 * 1024 * 1024;
  const MAX_PAGE_PT = 14400;
  const ALLOWED_NUP = Object.freeze([2, 4, 6, 9, 16]);
  const PAGE_SIZES_MM = Object.freeze({
    a4: Object.freeze([210, 297]),
    a3: Object.freeze([297, 420]),
    letter: Object.freeze([215.9, 279.4]),
    legal: Object.freeze([215.9, 355.6])
  });
  const CATALOG_GUARDS = Object.freeze([
    'AcroForm', 'Perms', 'DSS', 'Outlines', 'Names', 'AF', 'Collection',
    'StructTreeRoot', 'MarkInfo', 'OpenAction', 'AA', 'OCProperties',
    'PageLabels', 'Metadata'
  ]);
  const PAGE_GUARDS = Object.freeze(['AA', 'Metadata', 'StructParents', 'B', 'PresSteps']);

  function abortError() {
    const error = new Error('모아찍기를 취소했습니다. 부분 PDF를 제공하지 않습니다.');
    error.name = 'AbortError';
    return error;
  }
  function checkCancelled(opts) {
    if (opts?.signal?.aborted || opts?.cancelled?.()) throw abortError();
  }
  function numberWithin(value, min, max, label) {
    if (value === null || value === undefined || String(value).trim() === '')
      throw new Error(label + '을(를) 입력해 주세요.');
    const n = Number(value);
    if (!Number.isFinite(n) || n < min || n > max)
      throw new Error(`${label}은(는) ${min}~${max} 범위여야 합니다.`);
    return n;
  }
  function normalizeOptions(raw = {}) {
    const nup = numberWithin(raw.nup ?? 4, 2, 16, '한 장당 페이지 수');
    if (!ALLOWED_NUP.includes(nup)) throw new Error('2·4·6·9·16쪽 배치만 지원합니다.');
    const paper = String(raw.paper ?? 'a4').toLowerCase();
    if (!PAGE_SIZES_MM[paper]) throw new Error('출력 용지 크기는 A3·A4·Letter·Legal 중 선택해 주세요.');
    const orientation = String(raw.orientation ?? 'auto').toLowerCase();
    if (!['auto', 'portrait', 'landscape'].includes(orientation))
      throw new Error('용지 방향을 확인해 주세요.');
    const order = String(raw.order ?? 'across').toLowerCase();
    if (!['across', 'down'].includes(order)) throw new Error('페이지 배치 순서를 확인해 주세요.');
    const fitting = String(raw.fitting ?? 'fit').toLowerCase();
    if (!['fit', 'shrink'].includes(fitting)) throw new Error('페이지 확대·축소 방식을 확인해 주세요.');
    const marginMm = numberWithin(raw.marginMm ?? 7, 0, 35, '바깥 여백(mm)');
    const gapMm = numberWithin(raw.gapMm ?? 3, 0, 20, '칸 사이 간격(mm)');
    const border = raw.border === true || raw.border === 'true';
    const borderWidthMm = border ? numberWithin(raw.borderWidthMm ?? 0.2, 0.1, 2, '테두리 굵기(mm)') : 0;
    const borderColor = String(raw.borderColor ?? '#8793a1');
    if (!/^#[0-9a-f]{6}$/i.test(borderColor)) throw new Error('테두리 색상은 #RRGGBB 형식이어야 합니다.');
    const pages = String(raw.pages ?? 'all').trim().toLowerCase();
    if (!pages || pages.length > 200 ||
      !(pages === 'all' || pages === 'odd' || pages === 'even' || /^[\d,\-\s]+$/.test(pages)))
      throw new Error('페이지 선택은 전체·홀수·짝수 또는 1-3,5,8- 형식이어야 합니다.');
    return Object.freeze({
      nup, paper, orientation, order, fitting, marginMm, gapMm, border,
      borderWidthMm, borderColor, pages, reverse: raw.reverse === true
    });
  }
  function validateFiles(inputs) {
    const files = Array.from(inputs || []);
    if (!files.length || files.length > MAX_FILES) throw new Error('PDF 파일을 1~5개 선택해 주세요.');
    let totalSize = 0;
    for (const file of files) {
      if (typeof file?.name !== 'string' || file.name.length > 220 || !/\.pdf$/i.test(file.name) ||
        !Number.isSafeInteger(file.size) || file.size <= 0 || typeof file.arrayBuffer !== 'function')
        throw new Error('정상적인 PDF 파일만 선택할 수 있습니다.');
      totalSize += file.size;
      if (!Number.isSafeInteger(totalSize) || totalSize > MAX_TOTAL_INPUT_BYTES)
        throw new Error('브라우저 메모리 보호를 위해 입력 PDF 합계는 최대 120MB입니다.');
    }
    return files;
  }
  function resolvePages(spec, count) {
    if (!Number.isSafeInteger(count) || count < 1 || count > MAX_PAGES)
      throw new Error(`총 PDF 페이지는 1~${MAX_PAGES}쪽이어야 합니다.`);
    if (spec === 'all') return Array.from({length: count}, (_, i) => i);
    if (spec === 'odd' || spec === 'even')
      return Array.from({length: count}, (_, i) => i).filter(i => (i % 2 === 0) === (spec === 'odd'));
    const selected = [], seen = new Set();
    for (const token of spec.split(',')) {
      const match = /^\s*(\d+)\s*(?:-\s*(\d*)\s*)?$/.exec(token);
      if (!match) throw new Error('페이지 범위는 1-3,5,8-처럼 입력해 주세요.');
      const start = Number(match[1]);
      const end = match[2] === undefined ? start : (match[2] === '' ? count : Number(match[2]));
      if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 1 || end < start || end > count)
        throw new Error(`${token.trim()} 범위가 전체 ${count}쪽을 벗어났습니다.`);
      for (let page = start; page <= end; page++) {
        if (!seen.has(page)) { seen.add(page); selected.push(page - 1); }
      }
    }
    if (!selected.length) throw new Error('선택된 페이지가 없습니다.');
    return selected;
  }
  function rawContainsName(bytes, name) {
    // Supplement only; encrypted or compressed object streams may hide tokens.
    const pattern = Array.from('/' + name, ch => ch.charCodeAt(0));
    const delimiter = b => b === undefined || [0,9,10,12,13,32,40,41,47,60,62,91,93,123,125].includes(b);
    for (let i = 0; i <= bytes.length - pattern.length; i++) {
      if (i > 0 && !delimiter(bytes[i - 1])) continue;
      let found = true;
      for (let j = 0; j < pattern.length; j++) {
        if (bytes[i + j] !== pattern[j]) { found = false; break; }
      }
      if (found && delimiter(bytes[i + pattern.length])) return true;
    }
    return false;
  }
  const close = (a, b) => Math.abs(a - b) < 0.02;
  function checkSource(pdf, bytes, lib, fileName) {
    const N = lib.PDFName.of;
    if (pdf.context.trailerInfo?.Encrypt || pdf.catalog.get(N('Encrypt')))
      throw new Error(`${fileName}: 암호화된 PDF는 모아찍기를 지원하지 않습니다.`);
    if (rawContainsName(bytes, 'ByteRange') || rawContainsName(bytes, 'XFA'))
      throw new Error(`${fileName}: 서명 또는 XFA가 의심되어 안전하게 중단합니다.`);
    for (const name of CATALOG_GUARDS) {
      if (pdf.catalog.get(N(name)))
        throw new Error(`${fileName}: ${name} 구조는 모아찍기에서 보존할 수 없어 중단합니다.`);
    }
    const pages = pdf.getPages();
    if (!pages.length) throw new Error(`${fileName}: 페이지가 없습니다.`);
    for (let i = 0; i < pages.length; i++) {
      const page = pages[i];
      for (const name of PAGE_GUARDS) {
        if (page.node.get(N(name)))
          throw new Error(`${fileName} ${i + 1}쪽: ${name} 구조를 포함해 제외합니다.`);
      }
      const rawAnnots = page.node.get(N('Annots'));
      if (rawAnnots) {
        const resolved = pdf.context.lookup(rawAnnots);
        if (!(resolved instanceof lib.PDFArray) || resolved.size() > 0)
          throw new Error(`${fileName} ${i + 1}쪽: 주석·링크·양식은 배치 중 누락될 수 있어 처리하지 않습니다.`);
      }
      // pdf-lib's embedded page appearance does not automatically honor /Rotate
      // or offset CropBox. Require normalized pages to avoid silent clipping.
      const m = page.getMediaBox(), c = page.getCropBox();
      const rotation = ((page.getRotation().angle % 360) + 360) % 360;
      if (rotation !== 0 || !close(m.x, 0) || !close(m.y, 0) ||
        !close(c.x, 0) || !close(c.y, 0) || !close(c.width, m.width) ||
        !close(c.height, m.height) || !Number.isFinite(m.width) ||
        !Number.isFinite(m.height) || m.width <= 0 || m.height <= 0 ||
        m.width > MAX_PAGE_PT || m.height > MAX_PAGE_PT)
        throw new Error(`${fileName} ${i + 1}쪽: 회전·재단 영역·좌표가 복잡합니다. 정규화된 PDF만 모아찍기할 수 있습니다.`);
    }
    return pages;
  }
  function gridFor(nup, orientation) {
    const wide = orientation === 'landscape';
    if (nup === 2) return wide ? {cols:2, rows:1} : {cols:1, rows:2};
    if (nup === 6) return wide ? {cols:3, rows:2} : {cols:2, rows:3};
    const side = Math.sqrt(nup);
    return {cols:side, rows:side};
  }
  function dimensionsFor(paper, orientation) {
    let [w, h] = PAGE_SIZES_MM[paper].map(x => x * MM_TO_PT);
    if (orientation === 'landscape') [w, h] = [h, w];
    return {width:w, height:h};
  }
  function createPlan(settings, selectedPages) {
    if (!selectedPages?.length) throw new Error('배치할 페이지가 없습니다.');
    const orientations = settings.orientation === 'auto' ? ['portrait', 'landscape'] : [settings.orientation];
    let best = null;
    for (const orientation of orientations) {
      const paper = dimensionsFor(settings.paper, orientation);
      const grid = gridFor(settings.nup, orientation);
      const margin = settings.marginMm * MM_TO_PT, gap = settings.gapMm * MM_TO_PT;
      const cellWidth = (paper.width - 2 * margin - gap * (grid.cols - 1)) / grid.cols;
      const cellHeight = (paper.height - 2 * margin - gap * (grid.rows - 1)) / grid.rows;
      if (cellWidth < 30 || cellHeight < 30) continue;
      // Compare the first sheet's actual pages, not just the first page, in auto mode.
      const scales = selectedPages.slice(0, settings.nup).map(entry => Math.min(
        cellWidth / entry.width, cellHeight / entry.height
      ));
      const score = scales.reduce((sum, x) => sum + Math.log(x), 0) / scales.length;
      if (!best || score > best.score) best = {paper, grid, margin, gap, cellWidth, cellHeight, orientation, score};
    }
    if (!best) throw new Error('여백이 너무 커서 인쇄용지에 페이지를 배치할 수 없습니다.');
    return best;
  }
  function cellAt(plan, slot, order) {
    const {grid:{cols,rows},cellWidth,cellHeight,paper,margin,gap} = plan;
    const col = order === 'down' ? Math.floor(slot / rows) : slot % cols;
    const row = order === 'down' ? slot % rows : Math.floor(slot / cols);
    return {
      x: margin + col * (cellWidth + gap),
      y: paper.height - margin - (row + 1) * cellHeight - row * gap,
      width:cellWidth, height:cellHeight
    };
  }
  function parsedColor(hex, lib) {
    return lib.rgb(
      parseInt(hex.slice(1, 3), 16) / 255,
      parseInt(hex.slice(3, 5), 16) / 255,
      parseInt(hex.slice(5, 7), 16) / 255
    );
  }
  function drawCellBorder(page, cell, settings, lib) {
    if (!settings.border) return;
    const line = settings.borderWidthMm * MM_TO_PT;
    const color = parsedColor(settings.borderColor, lib);
    const {x, y, width, height} = cell;
    const inset = line / 2;
    const a = {x:x+inset, y:y+inset}, b = {x:x+width-inset,y:y+height-inset};
    const edges = [
      [a.x, a.y, b.x, a.y], [b.x, a.y, b.x, b.y],
      [b.x, b.y, a.x, b.y], [a.x, b.y, a.x, a.y]
    ];
    for (const [x1,y1,x2,y2] of edges)
      page.drawLine({start:{x:x1,y:y1},end:{x:x2,y:y2},thickness:line,color});
  }
  async function yieldToBrowser() {
    if (typeof setTimeout === 'function') await new Promise(resolve => setTimeout(resolve, 0));
  }
  async function readFile(file, opts) {
    const raw = typeof opts.readFile === 'function' ? await opts.readFile(file) : await file.arrayBuffer();
    const bytes = raw instanceof ArrayBuffer ? new Uint8Array(raw) :
      ArrayBuffer.isView(raw) && raw.BYTES_PER_ELEMENT === 1 ?
        new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength) : null;
    if (!bytes || !bytes.length || bytes.byteLength !== file.size)
      throw new Error(`${file.name}: PDF 파일을 완전히 읽지 못했습니다.`);
    return bytes;
  }
  async function create(inputs, rawSettings, opts = {}) {
    const files = validateFiles(inputs);
    const settings = normalizeOptions(rawSettings);
    const lib = opts.PDFLib;
    if (!lib?.PDFDocument?.load || !lib?.PDFDocument?.create || !lib.PDFName?.of ||
      !lib.PDFArray || typeof lib.rgb !== 'function')
      throw new Error('Sunrise PDF 편집 엔진(pdf-lib)이 필요합니다.');
    checkCancelled(opts);
    const sourceEntries = [];
    for (let fileIndex = 0; fileIndex < files.length; fileIndex++) {
      checkCancelled(opts);
      const file = files[fileIndex];
      opts.onProgress?.({phase:'loading',done:fileIndex,total:files.length,file:file.name});
      const bytes = await readFile(file, opts);
      checkCancelled(opts);
      const source = await lib.PDFDocument.load(bytes, {updateMetadata:false});
      const pages = checkSource(source, bytes, lib, file.name);
      if (sourceEntries.length + pages.length > MAX_PAGES)
        throw new Error(`PDF 합계는 최대 ${MAX_PAGES}쪽입니다.`);
      for (let i = 0; i < pages.length; i++) {
        const box = pages[i].getMediaBox();
        sourceEntries.push({page:pages[i],width:box.width,height:box.height,file:file.name,originalPage:i+1});
      }
      opts.onProgress?.({phase:'loading',done:fileIndex+1,total:files.length,file:file.name});
      await yieldToBrowser();
    }
    checkCancelled(opts);
    let selected = resolvePages(settings.pages,sourceEntries.length).map(i => sourceEntries[i]);
    if (settings.reverse) selected.reverse();
    const plan = createPlan(settings, selected);
    const output = await lib.PDFDocument.create();
    output.setTitle('Sunrise PDF Editor - N-up');
    output.setCreator('Sunrise PDF Editor');
    output.setProducer('Sunrise PDF Editor');
    const sheetCount = Math.ceil(selected.length / settings.nup);
    for (let sheetIndex = 0; sheetIndex < sheetCount; sheetIndex++) {
      checkCancelled(opts);
      const batch = selected.slice(sheetIndex * settings.nup, (sheetIndex+1) * settings.nup);
      // embedPages embeds vector appearance, not source PDF metadata/annotations.
      const embedded = await output.embedPages(batch.map(item => item.page));
      checkCancelled(opts);
      const sheet = output.addPage([plan.paper.width,plan.paper.height]);
      for (let slot = 0; slot < embedded.length; slot++) {
        checkCancelled(opts);
        const input = embedded[slot], cell = cellAt(plan,slot,settings.order);
        const factor = Math.min(cell.width / input.width,cell.height / input.height);
        const scale = settings.fitting === 'shrink' ? Math.min(factor, 1) : factor;
        if (!Number.isFinite(scale) || scale <= 0) throw new Error('입력 페이지의 비율을 계산하지 못했습니다.');
        const width = input.width * scale, height = input.height * scale;
        sheet.drawPage(input, {
          x:cell.x+(cell.width-width)/2,
          y:cell.y+(cell.height-height)/2,
          width, height
        });
        drawCellBorder(sheet,cell,settings,lib);
      }
      opts.onProgress?.({phase:'placing',done:sheetIndex+1,total:sheetCount,sourcePages:Math.min((sheetIndex+1)*settings.nup,selected.length)});
      await yieldToBrowser();
    }
    checkCancelled(opts);
    opts.onProgress?.({phase:'saving',done:sheetCount,total:sheetCount});
    const bytes = await output.save({updateFieldAppearances:false});
    checkCancelled(opts);
    if (!ArrayBuffer.isView(bytes) || !bytes.byteLength || bytes.byteLength > MAX_OUTPUT_BYTES)
      throw new Error('출력 PDF가 비어 있거나 브라우저의 안전 처리 범위를 초과했습니다.');
    const reopened = await lib.PDFDocument.load(bytes,{updateMetadata:false});
    if (reopened.getPageCount() !== sheetCount)
      throw new Error('출력 PDF의 용지 매수가 일치하지 않습니다.');
    for (const page of reopened.getPages()) {
      const b = page.getMediaBox();
      if (![b.width,b.height].every(Number.isFinite) ||
        !close(b.width,plan.paper.width) || !close(b.height,plan.paper.height))
        throw new Error('저장된 PDF의 용지 규격이 예상 결과와 다릅니다.');
    }
    checkCancelled(opts);
    const stem = files.length === 1 ? files[0].name.replace(/\.pdf$/i,'') : 'sunrise_pdf';
    const safeStem = stem.replace(/[\\/:*?"<>|\x00-\x1f]/g,'_').slice(0,130).trim() || 'sunrise_pdf';
    const filename = safeStem + `_nup${settings.nup}.pdf`;
    return {
      bytes, filename, inputFiles:files.length, inputPages:sourceEntries.length,
      selectedPages:selected.length, outputSheets:sheetCount, orientation:plan.orientation,
      nup:settings.nup, paper:settings.paper,
      limitations:'출력 PDF는 인쇄용 페이지 외형을 구성합니다. 원본의 주석·양식·서명·책갈피·접근성 태그를 복제하지 않습니다. 도면 축척과 인쇄 크기를 반드시 확인하세요.'
    };
  }
  return {
    create, normalizeOptions, resolvePages, gridFor, cellAt, createPlan,
    constants:Object.freeze({MAX_FILES, MAX_PAGES, ALLOWED_NUP, MAX_TOTAL_INPUT_BYTES})
  };
});
