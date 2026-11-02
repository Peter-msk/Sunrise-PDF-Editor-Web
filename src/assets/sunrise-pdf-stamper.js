/* Sunrise PDF Editor — local watermarks and document page numbering.
 * Works on copies of unprotected PDFs; no network transfer or OCR.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.SunrisePdfStamper = api;
})(typeof globalThis !== 'undefined' ? globalThis : undefined, function () {
  'use strict';
  const MAX_PAGES = 500;
  const POSITIONS = ['bottom-left', 'bottom-center', 'bottom-right', 'top-left', 'top-center', 'top-right'];
  const abort = cancelled => {
    if (cancelled?.()) {
      const error = new Error('PDF 꾸미기를 취소했습니다. 결과 파일은 제공되지 않습니다.');
      error.name = 'AbortError';
      throw error;
    }
  };
  async function yieldUI() { await new Promise(resolve => setTimeout(resolve, 0)); }
  function limit(n, low, high, message) {
    if (!Number.isFinite(n) || n < low || n > high) throw new Error(message);
    return n;
  }
  function parsePageSelection(text, total) {
    if (!Number.isSafeInteger(total) || total < 1 || total > MAX_PAGES) {
      throw new Error(`PDF는 1~${MAX_PAGES}쪽까지 꾸밀 수 있습니다.`);
    }
    if (text === undefined || text === null || text === '' || String(text).trim() === '*') {
      return Array.from({ length: total }, (_, i) => i);
    }
    if (typeof text !== 'string' || text.length > 4000) throw new Error('페이지 범위가 올바르지 않습니다.');
    const seen = new Set();
    for (const part of text.split(',')) {
      const match = /^(\d+)\s*(?:-\s*(\d+))?$/.exec(part.trim());
      if (!match) throw new Error(`페이지 지정 형식이 잘못됐습니다: ${part}`);
      const first = Number(match[1]), last = Number(match[2] || match[1]);
      if (!Number.isSafeInteger(first) || !Number.isSafeInteger(last) || first < 1 ||
          last < first || last > total) throw new Error(`페이지 범위가 1~${total}쪽을 벗어났습니다.`);
      for (let n = first; n <= last; n++) seen.add(n - 1);
    }
    if (!seen.size) throw new Error('적용할 페이지가 없습니다.');
    return [...seen].sort((a, b) => a - b);
  }
  function asPdfText(value, font, customFont) {
    if (typeof value !== 'string' || value.length > 300 || /[\x00-\x08\x0b\x0e-\x1f]/.test(value)) {
      throw new Error('워터마크·페이지 번호 텍스트는 최대 300자까지 지원합니다.');
    }
    if (!customFont && /[\u0100-\uffff]/u.test(value)) {
      throw new Error('한글 등 유니코드 문자에는 사용자 글꼴과 fontkit이 필요합니다.');
    }
    font.encodeText(value);
    return value;
  }
  function viewport(page) {
    const crop = page.getCropBox();
    const rotation = ((page.getRotation().angle % 360) + 360) % 360;
    if (![0, 90, 180, 270].includes(rotation)) throw new Error('지원하지 않는 페이지 회전값입니다.');
    return {
      crop, rotation,
      width: rotation % 180 ? crop.height : crop.width,
      height: rotation % 180 ? crop.width : crop.height
    };
  }
  // Map visual coordinates (origin: bottom-left of the displayed page) into
  // PDF user space, preserving visual horizontal text on rotated pages.
  function toPage(vp, x, y) {
    const { crop: c, rotation: r } = vp;
    if (r === 90) return { x: c.x + c.width - y, y: c.y + x };
    if (r === 180) return { x: c.x + c.width - x, y: c.y + c.height - y };
    if (r === 270) return { x: c.x + y, y: c.y + c.height - x };
    return { x: c.x + x, y: c.y + y };
  }
  function pageNumberPosition(vp, width, size, pos, margin) {
    const isTop = pos.startsWith('top');
    const x = pos.endsWith('center') ? (vp.width - width) / 2 :
      pos.endsWith('right') ? vp.width - margin - width : margin;
    const y = isTop ? vp.height - margin - size : margin;
    if (x < 0 || x + width > vp.width || y < 0 || y + size > vp.height) {
      throw new Error('PDF 페이지 크기에 비해 번호 문자열 또는 여백이 너무 큽니다.');
    }
    return { x, y };
  }
  function guardPdf(pdf, lib) {
    const n = lib.PDFName.of;
    for (const name of ['Perms', 'DSS']) {
      if (pdf.catalog.get(n(name))) throw new Error(`서명·보안 구조 ${name}가 있는 PDF에는 표시를 추가하지 않습니다.`);
    }
    const formRef = pdf.catalog.get(n('AcroForm'));
    if (formRef) {
      const formDict = pdf.context.lookup(formRef);
      if (formDict?.get?.(n('XFA'))) throw new Error('XFA PDF 양식에는 표시를 추가하지 않습니다.');
      const signatureFlags = pdf.context.lookup(formDict?.get?.(n('SigFlags')));
      if (signatureFlags?.asNumber?.() & 1) throw new Error('전자서명 표시가 있는 PDF에는 표시를 추가하지 않습니다.');
      const fields = pdf.getForm().getFields();
      if (fields.some(f => lib.PDFSignature && f instanceof lib.PDFSignature)) {
        throw new Error('서명 필드가 있는 PDF에는 표시를 추가하지 않습니다.');
      }
    }
    if (pdf.getPageCount() < 1 || pdf.getPageCount() > MAX_PAGES) {
      throw new Error(`PDF 페이지는 1~${MAX_PAGES}쪽을 지원합니다.`);
    }
  }
  async function fontFor(pdf, lib, opts) {
    if (opts.fontBytes) {
      if (!opts.fontkit || typeof pdf.registerFontkit !== 'function') {
        throw new Error('추가 글꼴을 적용하려면 fontkit 연동이 필요합니다.');
      }
      pdf.registerFontkit(opts.fontkit);
      return pdf.embedFont(opts.fontBytes, { subset: true });
    }
    return pdf.embedFont(lib.StandardFonts.Helvetica);
  }
  /**
   * options:
   * number: { enabled, template:'{page} / {total}', startAt:1,
   *           position:'bottom-center', fontSize:11, margin:24 }
   * watermark: {enabled, text:'DRAFT', fontSize:65,
   *             opacity:0.15, angle:-30 }
   * pages: '*' or '1-3,5'. The numbering index follows physical PDF order.
   */
  async function apply(file, settings, opts) {
    const lib = opts?.PDFLib;
    if (!lib?.PDFDocument || !lib.StandardFonts || !lib.degrees ||
        typeof opts?.readFile !== 'function') throw new Error('PDF 표시 엔진을 불러오지 못했습니다.');
    if (!Number.isSafeInteger(file?.size) || file.size <= 0) throw new Error('PDF를 선택해 주세요.');
    const number = settings?.number || {};
    const watermark = settings?.watermark || {};
    if (!number.enabled && !watermark.enabled) throw new Error('페이지 번호나 워터마크 중 하나를 선택해 주세요.');
    abort(opts.cancelled);
    const bytes = await opts.readFile(file);
    if (!ArrayBuffer.isView(bytes) || bytes.byteLength !== file.size) throw new Error('PDF 파일 읽기가 완료되지 않았습니다.');
    const pdf = await lib.PDFDocument.load(bytes, { updateMetadata: false });
    guardPdf(pdf, lib);
    const selected = parsePageSelection(settings.pages, pdf.getPageCount());
    const font = await fontFor(pdf, lib, opts);
    const customFont = Boolean(opts.fontBytes);
    let numberSize = 11, margin = 24, position = 'bottom-center';
    let numberTemplate = '', startAt = 1;
    if (number.enabled) {
      numberSize = limit(Number(number.fontSize ?? 11), 6, 64, '페이지 번호 글자 크기는 6~64pt입니다.');
      margin = limit(Number(number.margin ?? 24), 0, 300, '페이지 번호 여백은 0~300pt입니다.');
      position = number.position ?? position;
      if (!POSITIONS.includes(position)) throw new Error('페이지 번호 위치를 선택해 주세요.');
      numberTemplate = String(number.template ?? '{page} / {total}');
      if (!numberTemplate || numberTemplate.length > 120) throw new Error('페이지 번호 형식을 확인해 주세요.');
      startAt = Number(number.startAt ?? 1);
      if (!Number.isSafeInteger(startAt) || startAt < 0 || startAt > 999999) throw new Error('페이지 번호 시작값이 올바르지 않습니다.');
    }
    let markText = '', markSize = 65, markOpacity = 0.15, markAngle = -30;
    if (watermark.enabled) {
      markText = String(watermark.text ?? 'DRAFT').trim();
      if (!markText) throw new Error('워터마크 문구를 입력해 주세요.');
      markSize = limit(Number(watermark.fontSize ?? 65), 8, 180, '워터마크 크기는 8~180pt입니다.');
      markOpacity = limit(Number(watermark.opacity ?? 0.15), 0.03, 0.65, '워터마크 불투명도는 0.03~0.65입니다.');
      markAngle = limit(Number(watermark.angle ?? -30), -65, 65, '워터마크 각도는 -65~65도입니다.');
      asPdfText(markText, font, customFont);
    }
    for (let at = 0; at < selected.length; at++) {
      abort(opts.cancelled);
      const index = selected[at];
      const page = pdf.getPage(index), vp = viewport(page);
      if (watermark.enabled) {
        const width = font.widthOfTextAtSize(markText, markSize);
        const origin = toPage(vp, (vp.width - width) / 2, vp.height / 2);
        page.drawText(markText, {
          ...origin, size: markSize, font,
          rotate: lib.degrees((vp.rotation + markAngle) % 360),
          opacity: markOpacity, color: lib.rgb(0.55, 0.58, 0.63)
        });
      }
      if (number.enabled) {
        const text = asPdfText(numberTemplate
          .replaceAll('{page}', String(startAt + index))
          .replaceAll('{total}', String(pdf.getPageCount())), font, customFont);
        const width = font.widthOfTextAtSize(text, numberSize);
        const point = pageNumberPosition(vp, width, numberSize, position, margin);
        const origin = toPage(vp, point.x, point.y);
        page.drawText(text, {
          ...origin, font, size: numberSize,
          rotate: lib.degrees(vp.rotation), color: lib.rgb(0.25, 0.30, 0.36)
        });
      }
      opts.onProgress?.({ done: at + 1, total: selected.length, page: index + 1 });
      if ((at + 1) % 8 === 0) await yieldUI();
    }
    abort(opts.cancelled);
    const result = await pdf.save({ updateFieldAppearances: false });
    abort(opts.cancelled);
    const reopened = await lib.PDFDocument.load(result, { updateMetadata: false });
    if (reopened.getPageCount() !== pdf.getPageCount()) throw new Error('저장 후 PDF 페이지 수가 일치하지 않습니다.');
    abort(opts.cancelled);
    return { bytes: result, pageCount: pdf.getPageCount(), affectedPages: selected.length };
  }
  return { apply, parsePageSelection, MAX_PAGES };
});
