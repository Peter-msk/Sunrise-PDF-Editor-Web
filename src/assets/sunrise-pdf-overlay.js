/* Sunrise PDF Editor Web — LOCAL-11 PDF page overlay/underlay.
 * Authoring overlay ONLY. No OCR, network requests or source-file mutation.
 * Appearance-only output: source annotations, form fields, digital signatures,
 * links, outlines, attachments and tagged structures are NOT transported.
 * The operation is NOT redaction and does not erase underlying PDF content.
 */
(function(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.SunrisePdfOverlay = api;
})(typeof globalThis !== 'undefined' ? globalThis : undefined, function() {
  'use strict';

  const MM_TO_PT = 72 / 25.4;
  const MAX_BASE_PAGES = 250;
  const MAX_OVERLAY_PAGES = 250;
  const MAX_INPUT_BYTES = 120 * 1024 * 1024;
  const MAX_OUTPUT_BYTES = 250 * 1024 * 1024;
  const MAX_PAGE_PT = 14400;
  const CATALOG_GUARDS = Object.freeze([
    'AcroForm', 'Perms', 'DSS', 'Outlines', 'Names', 'AF', 'Collection',
    'StructTreeRoot', 'MarkInfo', 'OpenAction', 'AA', 'OCProperties',
    'PageLabels', 'Metadata'
  ]);
  const PAGE_GUARDS = Object.freeze(['AA', 'Metadata', 'StructParents', 'B', 'PresSteps']);
  const close = (a, b) => Math.abs(a - b) < 0.02;

  function abortError() {
    const e = new Error('PDF 겹치기를 취소했습니다. 부분 결과 PDF는 제공하지 않습니다.');
    e.name = 'AbortError';
    return e;
  }
  function checkCancelled(opts) {
    if (opts?.signal?.aborted || opts?.cancelled?.()) throw abortError();
  }
  function numberWithin(value, min, max, label) {
    if (value == null || String(value).trim() === '') throw Error(`${label} 값을 입력해 주세요.`);
    const n = Number(value);
    if (!Number.isFinite(n) || n < min || n > max)
      throw Error(`${label} 값은 ${min}~${max} 범위여야 합니다.`);
    return n;
  }
  function normalizeOptions(raw = {}) {
    const position = String(raw.position ?? 'front');
    const mapping = String(raw.mapping ?? 'repeat-last');
    const anchor = String(raw.anchor ?? 'center');
    const size = String(raw.size ?? 'contain');
    const pages = String(raw.pages ?? 'all').trim().toLowerCase();
    if (!['front', 'back'].includes(position)) throw Error('전경 또는 배경 모드를 선택해 주세요.');
    if (!['first', 'sequence', 'repeat-last', 'cycle'].includes(mapping))
      throw Error('오버레이 페이지 대응 방식을 확인해 주세요.');
    if (!['center', 'top-left', 'top-right', 'bottom-left', 'bottom-right'].includes(anchor))
      throw Error('겹칠 페이지 기준 위치를 확인해 주세요.');
    if (!['contain', 'stretch'].includes(size)) throw Error('PDF 배치 크기 방식을 확인해 주세요.');
    if (!pages || pages.length > 200 ||
      !(pages === 'all' || pages === 'odd' || pages === 'even' || /^[\d,\-\s]+$/.test(pages)))
      throw Error('적용 페이지는 all, odd, even 또는 1-3,5,8- 형식으로 입력해 주세요.');
    return Object.freeze({
      position, mapping, anchor, size, pages,
      opacity: numberWithin(raw.opacity ?? 100, 5, 100, '불투명도(%)') / 100,
      scale: numberWithin(raw.scale ?? 100, 25, 200, '크기 비율(%)') / 100,
      xMm: numberWithin(raw.xMm ?? 0, -100, 100, '좌우 이동(mm)'),
      yMm: numberWithin(raw.yMm ?? 0, -100, 100, '상하 이동(mm)')
    });
  }
  function selectPages(spec, count) {
    if (!Number.isSafeInteger(count) || count < 1 || count > MAX_BASE_PAGES)
      throw Error(`기준 PDF는 1~${MAX_BASE_PAGES}쪽이어야 합니다.`);
    if (spec === 'all') return Array.from({length:count}, (_, i) => i);
    if (spec === 'odd' || spec === 'even')
      return Array.from({length:count}, (_, i) => i).filter(i => ((i + 1) % 2 === 1) === (spec === 'odd'));
    const result = [], seen = new Set();
    for (const token of spec.split(',')) {
      const m = /^\s*(\d+)\s*(?:-\s*(\d*)\s*)?$/.exec(token);
      if (!m) throw Error('페이지 범위는 1-3,5,8- 형식으로 입력해 주세요.');
      const from = Number(m[1]);
      const to = m[2] === undefined ? from : (m[2] === '' ? count : Number(m[2]));
      if (!Number.isSafeInteger(from) || !Number.isSafeInteger(to) || from < 1 || to < from || to > count)
        throw Error(`적용 페이지 '${token.trim()}'이(가) 문서 범위 1~${count}을 벗어났습니다.`);
      for (let n = from; n <= to; n++) if (!seen.has(n - 1)) {seen.add(n - 1);result.push(n - 1);}
    }
    if (!result.length) throw Error('겹치기를 적용할 페이지가 없습니다.');
    return result.sort((a, b) => a - b);
  }
  function overlayIndex(baseIndex, overlayCount, mapping) {
    if (!Number.isSafeInteger(baseIndex) || baseIndex < 0 ||
      !Number.isSafeInteger(overlayCount) || overlayCount < 1) throw Error('페이지 대응 값이 잘못되었습니다.');
    if (mapping === 'first') return 0;
    if (mapping === 'cycle') return baseIndex % overlayCount;
    if (mapping === 'repeat-last') return Math.min(baseIndex, overlayCount - 1);
    if (mapping === 'sequence') {
      if (baseIndex >= overlayCount)
        throw Error(`페이지 1:1 대응은 오버레이에 최소 ${baseIndex+1}쪽이 있어야 합니다.`);
      return baseIndex;
    }
    throw Error('알 수 없는 페이지 대응 방식입니다.');
  }
  function validateFile(file, label) {
    if (!file || typeof file.name !== 'string' || file.name.length > 220 ||
      !/\.pdf$/i.test(file.name) || !Number.isSafeInteger(file.size) ||
      file.size < 1 || typeof file.arrayBuffer !== 'function')
      throw Error(`${label}에 정상적인 PDF 파일을 선택해 주세요.`);
    return file;
  }
  async function readPdf(file, opts) {
    checkCancelled(opts);
    const raw = typeof opts.readFile === 'function' ? await opts.readFile(file) : await file.arrayBuffer();
    const bytes = raw instanceof ArrayBuffer ? new Uint8Array(raw) :
      ArrayBuffer.isView(raw) && raw.BYTES_PER_ELEMENT === 1 ?
        new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength) : null;
    if (!bytes || !bytes.byteLength || bytes.byteLength !== file.size)
      throw Error(`${file.name}: PDF 바이트를 완전하게 읽지 못했습니다.`);
    checkCancelled(opts);
    return bytes;
  }
  function rawHasName(bytes, name) {
    // Additional warning gate, not a complete parser for compressed object streams.
    const pattern = Array.from('/' + name, ch => ch.charCodeAt(0));
    const delimiter = n => n === undefined || [0,9,10,12,13,32,40,41,47,60,62,91,93,123,125].includes(n);
    for (let at = 0; at <= bytes.length - pattern.length; at++) {
      if (at && !delimiter(bytes[at - 1])) continue;
      let matches = true;
      for (let j = 0; j < pattern.length; j++) if (bytes[at+j] !== pattern[j]) { matches = false; break; }
      if (matches && delimiter(bytes[at+pattern.length])) return true;
    }
    return false;
  }
  function inspectSource(pdf, bytes, lib, filename, maxPages) {
    const N = lib.PDFName.of;
    if (pdf.context.trailerInfo?.Encrypt || pdf.catalog.get(N('Encrypt')))
      throw Error(`${filename}: 암호화된 문서는 안전하게 제외합니다.`);
    if (rawHasName(bytes,'ByteRange') || rawHasName(bytes,'XFA'))
      throw Error(`${filename}: 서명 또는 XFA 구조가 의심되어 처리하지 않습니다.`);
    for (const name of CATALOG_GUARDS) if (pdf.catalog.get(N(name)))
      throw Error(`${filename}: ${name} 구조가 있어 외형 재조립에서 제외합니다.`);
    const pages = pdf.getPages();
    if (!pages.length || pages.length > maxPages)
      throw Error(`${filename}: 지원 페이지 수는 1~${maxPages}쪽입니다.`);
    for (let i = 0; i < pages.length; i++) {
      const p = pages[i];
      for (const name of PAGE_GUARDS) if (p.node.get(N(name)))
        throw Error(`${filename} ${i+1}쪽: ${name} 구조가 있어 제외합니다.`);
      const annots = p.node.get(N('Annots'));
      if (annots) {
        const arr = pdf.context.lookup(annots);
        if (!(arr instanceof lib.PDFArray) || arr.size())
          throw Error(`${filename} ${i+1}쪽: 주석/링크/양식은 겹치기 후 유지되지 않아 제외합니다.`);
      }
      const media = p.getMediaBox(), crop = p.getCropBox();
      const rotation = ((p.getRotation().angle % 360) + 360) % 360;
      if (rotation !== 0 || !close(media.x,0) || !close(media.y,0) ||
        !close(crop.x,0) || !close(crop.y,0) ||
        !close(crop.width,media.width) || !close(crop.height,media.height) ||
        !Number.isFinite(media.width) || !Number.isFinite(media.height) ||
        media.width <= 0 || media.height <= 0 ||
        media.width > MAX_PAGE_PT || media.height > MAX_PAGE_PT)
        throw Error(`${filename} ${i+1}쪽: 회전/재단 박스가 있는 비정규 페이지는 제외합니다.`);
    }
    return pages;
  }
  function placement(base, overlay, opts) {
    if (![base.width,base.height,overlay.width,overlay.height].every(Number.isFinite) ||
      base.width <= 0 || base.height <= 0 || overlay.width <= 0 || overlay.height <= 0)
      throw Error('PDF 페이지의 크기가 올바르지 않습니다.');
    const baseFactor = opts.size === 'stretch' ? 1 :
      Math.min(base.width / overlay.width, base.height / overlay.height);
    const width = (opts.size === 'stretch' ? base.width : overlay.width * baseFactor) * opts.scale;
    const height = (opts.size === 'stretch' ? base.height : overlay.height * baseFactor) * opts.scale;
    const left = opts.anchor.endsWith('right') ? base.width - width :
      opts.anchor.endsWith('left') ? 0 : (base.width - width) / 2;
    const bottom = opts.anchor.startsWith('top') ? base.height - height :
      opts.anchor.startsWith('bottom') ? 0 : (base.height - height) / 2;
    return {x:left+opts.xMm*MM_TO_PT, y:bottom+opts.yMm*MM_TO_PT, width, height,
      opacity:opts.opacity};
  }
  async function yieldToBrowser() {
    if (typeof setTimeout === 'function') await new Promise(resolve => setTimeout(resolve,0));
  }
  async function create(baseFile, overlayFile, rawOptions = {}, opts = {}) {
    validateFile(baseFile, '기준 문서');
    validateFile(overlayFile, '겹칠 문서');
    const totalSize = baseFile.size + overlayFile.size;
    if (!Number.isSafeInteger(totalSize) || totalSize > MAX_INPUT_BYTES)
      throw Error('두 PDF의 크기 합계는 브라우저 메모리 보호를 위해 최대 120MB입니다.');
    const settings = normalizeOptions(rawOptions);
    const lib = opts.PDFLib;
    if (!lib?.PDFDocument?.load || !lib?.PDFDocument?.create || !lib?.PDFName?.of || !lib?.PDFArray)
      throw Error('기존 Sunrise PDF 편집 엔진(pdf-lib)이 필요합니다.');
    checkCancelled(opts);
    opts.onProgress?.({phase:'loading',done:0,total:2});
    const baseBytes = await readPdf(baseFile, opts);
    const basePdf = await lib.PDFDocument.load(baseBytes, {updateMetadata:false});
    const basePages = inspectSource(basePdf,baseBytes,lib,baseFile.name,MAX_BASE_PAGES);
    checkCancelled(opts);
    opts.onProgress?.({phase:'loading',done:1,total:2});
    await yieldToBrowser();
    const overlayBytes = await readPdf(overlayFile, opts);
    const overlayPdf = await lib.PDFDocument.load(overlayBytes, {updateMetadata:false});
    const overlayPages = inspectSource(overlayPdf,overlayBytes,lib,overlayFile.name,MAX_OVERLAY_PAGES);
    checkCancelled(opts);
    opts.onProgress?.({phase:'loading',done:2,total:2});
    const chosen = new Set(selectPages(settings.pages,basePages.length));
    // Preflight all target mappings before building any output PDF.
    for (const index of chosen) overlayIndex(index,overlayPages.length,settings.mapping);
    const output = await lib.PDFDocument.create();
    output.setTitle('Sunrise PDF Editor - Overlay');
    output.setCreator('Sunrise PDF Editor');
    output.setProducer('Sunrise PDF Editor');
    const embeddedOverlays = new Map();
    for (let i = 0; i < basePages.length; i++) {
      checkCancelled(opts);
      const basePage = basePages[i];
      const baseSize = basePage.getMediaBox();
      const sheet = output.addPage([baseSize.width,baseSize.height]);
      const baseAppearance = await output.embedPage(basePage);
      const drawBase = () => sheet.drawPage(baseAppearance,{
        x:0,y:0,width:baseSize.width,height:baseSize.height
      });
      if (!chosen.has(i)) {
        drawBase();
      } else {
        const index = overlayIndex(i,overlayPages.length,settings.mapping);
        let appearance = embeddedOverlays.get(index);
        if (!appearance) {
          appearance = await output.embedPage(overlayPages[index]);
          embeddedOverlays.set(index,appearance);
        }
        const position = placement({width:baseSize.width,height:baseSize.height},appearance,settings);
        if (settings.position === 'back') {
          sheet.drawPage(appearance,position);
          drawBase();
        } else {
          drawBase();
          sheet.drawPage(appearance,position);
        }
      }
      opts.onProgress?.({phase:'drawing',done:i+1,total:basePages.length,applied:chosen.has(i)});
      if ((i+1)%4===0) await yieldToBrowser();
    }
    checkCancelled(opts);
    opts.onProgress?.({phase:'saving',done:basePages.length,total:basePages.length});
    const bytes = await output.save({updateFieldAppearances:false});
    checkCancelled(opts);
    if (!ArrayBuffer.isView(bytes) || bytes.BYTES_PER_ELEMENT !== 1 ||
      !bytes.byteLength || bytes.byteLength > MAX_OUTPUT_BYTES)
      throw Error('결과 PDF가 비어 있거나 브라우저 안전 출력 크기(250MB)를 초과했습니다.');
    const reopened = await lib.PDFDocument.load(bytes,{updateMetadata:false});
    if (reopened.getPageCount() !== basePages.length)
      throw Error('결과 PDF의 페이지 수가 기준 문서와 일치하지 않습니다.');
    for (let i=0;i<basePages.length;i++) {
      const before = basePages[i].getMediaBox();
      const after = reopened.getPage(i).getMediaBox();
      if (!close(before.width,after.width) || !close(before.height,after.height))
        throw Error(`${i+1}쪽 결과 페이지의 규격이 변했습니다.`);
    }
    checkCancelled(opts);
    const stem = baseFile.name.replace(/\.pdf$/i,'').replace(/[\\/:*?"<>|\x00-\x1f]/g,'_').slice(0,125).trim() || 'sunrise_pdf';
    return Object.freeze({
      bytes, filename:`${stem}_overlay.pdf`, pages:basePages.length, applied:chosen.size,
      mode:settings.position, mapping:settings.mapping,
      limitations:'서명/양식/주석/링크/북마크/접근성 정보를 보존하지 않는 외형 재조립 기능입니다. 민감정보 삭제 기능이 아닙니다. 흰색 배경의 문서는 배경 오버레이가 가려질 수 있습니다.'
    });
  }
  return {create,normalizeOptions,selectPages,overlayIndex,placement,
    constants:Object.freeze({MAX_BASE_PAGES,MAX_OVERLAY_PAGES,MAX_INPUT_BYTES})};
});
