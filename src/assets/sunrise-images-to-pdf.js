/* Sunrise PDF Editor — LOCAL-07 image files -> PDF, browser-local only.
 * Independent Sunrise implementation using existing pdf-lib. No OCR, network,
 * persistent storage, or source-file modification. Integration/tests pending.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.SunriseImagesToPdf = api;
})(typeof globalThis !== 'undefined' ? globalThis : undefined, function () {
  'use strict';

  const MAX_IMAGES = 60;
  const MAX_PDF_DIM = 14400; // ISO 32000 commonly supported maximum page dimension, pt.
  const MM_TO_PT = 72 / 25.4;
  const PAGE_SIZES = Object.freeze({ a4: [595.2756, 841.8898], letter: [612, 792] });
  const EXT = Object.freeze({ jpg: 'jpeg', jpeg: 'jpeg', png: 'png', webp: 'webp' });

  function abort() {
    const error = new Error('이미지 PDF 변환을 취소했습니다. 결과 파일은 제공하지 않습니다.');
    error.name = 'AbortError';
    throw error;
  }
  function checkCancel(opts) { if (opts.cancelled?.()) abort(); }
  function yieldUI() { return new Promise(resolve => setTimeout(resolve, 0)); }

  function normalizeFiles(input) {
    if (!input || typeof input[Symbol.iterator] !== 'function')
      throw new Error('변환할 이미지 파일을 선택해 주세요.');
    const files = Array.from(input);
    if (files.length < 1 || files.length > MAX_IMAGES)
      throw new Error(`한 번에 1~${MAX_IMAGES}개 이미지를 선택해 주세요.`);
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      if (!file || !Number.isSafeInteger(file.size) || file.size < 1 ||
          typeof file.name !== 'string' || !file.name || file.name.length > 240 ||
          typeof file.arrayBuffer !== 'function')
        throw new Error(`${i + 1}번째 이미지 파일의 이름·크기·읽기 기능을 확인해 주세요.`);
      const extension = file.name.split('.').pop().toLowerCase();
      if (!Object.prototype.hasOwnProperty.call(EXT, extension))
        throw new Error(`지원하지 않는 형식: ${file.name} (JPG·PNG·WebP 지원)`);
    }
    return files;
  }

  function normalizeSettings(input) {
    const settings = input || {};
    const page = settings.page || 'a4';
    const orientation = settings.orientation || 'auto';
    const marginMm = settings.marginMm === undefined ? 8 : Number(settings.marginMm);
    if (!['a4', 'letter', 'original'].includes(page)) throw new Error('페이지 크기 설정이 올바르지 않습니다.');
    if (!['auto', 'portrait', 'landscape'].includes(orientation))
      throw new Error('페이지 방향 설정이 올바르지 않습니다.');
    if (!Number.isFinite(marginMm) || marginMm < 0 || marginMm > 40)
      throw new Error('여백은 0~40mm 이내로 입력해 주세요.');
    return { page, orientation, marginMm };
  }

  function detectType(bytes) {
    if (!(bytes instanceof Uint8Array) || bytes.byteLength < 12)
      throw new Error('이미지 파일이 비어 있거나 손상되었습니다.');
    if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpeg';
    if ([137, 80, 78, 71, 13, 10, 26, 10].every((v, i) => bytes[i] === v)) return 'png';
    if (String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF' &&
        String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP') return 'webp';
    throw new Error('이미지의 실제 형식을 판별할 수 없습니다. JPG·PNG·WebP만 지원합니다.');
  }

  // Read only a bounded JPEG header segment region for EXIF orientation.
  // An EXIF orientation other than 1 requires browser orientation normalization.
  function jpegExifOrientation(bytes) {
    if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return 1;
    let offset = 2;
    while (offset + 4 < Math.min(bytes.length, 131072)) {
      if (bytes[offset] !== 0xff) break;
      const marker = bytes[offset + 1];
      if (marker === 0xda || marker === 0xd9) break;
      if (marker === 0xff) { offset++; continue; }
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { offset += 2; continue; }
      const length = bytes[offset + 2] * 256 + bytes[offset + 3];
      if (length < 2 || offset + 2 + length > bytes.length) break;
      if (marker === 0xe1 && length >= 16) {
        const start = offset + 4;
        if ([69, 120, 105, 102, 0, 0].every((v, i) => bytes[start + i] === v)) {
          const tiff = start + 6;
          const little = bytes[tiff] === 0x49 && bytes[tiff + 1] === 0x49;
          const big = bytes[tiff] === 0x4d && bytes[tiff + 1] === 0x4d;
          if (!little && !big) return 1;
          const u16 = i => little ? bytes[i] + bytes[i + 1] * 256 : bytes[i] * 256 + bytes[i + 1];
          const u32 = i => little ? (bytes[i] + bytes[i + 1] * 256 + bytes[i + 2] * 65536 + bytes[i + 3] * 16777216)
                                   : (bytes[i] * 16777216 + bytes[i + 1] * 65536 + bytes[i + 2] * 256 + bytes[i + 3]);
          if (u16(tiff + 2) !== 42 || tiff + 8 > bytes.length) return 1;
          const directory = tiff + u32(tiff + 4);
          if (directory + 2 > bytes.length) return 1;
          const count = Math.min(u16(directory), 128);
          for (let j = 0; j < count; j++) {
            const pos = directory + 2 + j * 12;
            if (pos + 12 > bytes.length) break;
            if (u16(pos) === 0x0112 && u16(pos + 2) === 3 && u32(pos + 4) === 1) {
              const n = u16(pos + 8);
              return n >= 1 && n <= 8 ? n : 1;
            }
          }
        }
      }
      offset += length + 2;
    }
    return 1;
  }

  async function decodeToPng(file, options) {
    if (typeof options.browserConvert !== 'function')
      throw new Error('이 브라우저에서 이미지 방향 보정 또는 WebP 변환 기능을 사용할 수 없습니다.');
    const result = await options.browserConvert(file);
    if (!(result instanceof Uint8Array) || detectType(result) !== 'png')
      throw new Error('브라우저 이미지 변환 결과가 올바른 PNG 형식이 아닙니다.');
    return result;
  }

  function getPageGeometry(image, settings) {
    const pixelsWide = image.width, pixelsHigh = image.height;
    if (![pixelsWide, pixelsHigh].every(v => Number.isFinite(v) && v >= 1))
      throw new Error('이미지 가로·세로 크기를 확인할 수 없습니다.');
    const margin = settings.marginMm * MM_TO_PT;
    let width, height;
    if (settings.page === 'original') {
      // 96 CSS pixels per inch is the explicit original-size mapping; not EXIF DPI.
      const scale = Math.min(0.75, (MAX_PDF_DIM - 2 * margin) / Math.max(pixelsWide, pixelsHigh));
      width = pixelsWide * scale + 2 * margin;
      height = pixelsHigh * scale + 2 * margin;
    } else {
      [width, height] = PAGE_SIZES[settings.page];
      const landscape = settings.orientation === 'landscape' ||
        (settings.orientation === 'auto' && pixelsWide > pixelsHigh);
      if (landscape) [width, height] = [height, width];
    }
    if (![width, height].every(v => v > 1 && v <= MAX_PDF_DIM))
      throw new Error('PDF 페이지 크기가 지원 범위를 벗어났습니다.');
    const usableWidth = width - 2 * margin, usableHeight = height - 2 * margin;
    if (usableWidth <= 0 || usableHeight <= 0)
      throw new Error('설정한 여백이 PDF 페이지보다 큽니다.');
    const scale = Math.min(usableWidth / pixelsWide, usableHeight / pixelsHigh);
    const drawWidth = pixelsWide * scale, drawHeight = pixelsHigh * scale;
    return {
      width, height,
      x: (width - drawWidth) / 2, y: (height - drawHeight) / 2,
      drawWidth, drawHeight
    };
  }

  /**
   * Produce one new PDF from images. No source modification/upload.
   * Files: 1..60 JPG/PNG/WebP, ordered as supplied.
   * Dependencies: options.PDFLib (pdf-lib), options.browserConvert for WebP or rotated EXIF JPEG.
   * Cancel: checked before/after each awaited stage, rejects with AbortError,
   * never returns a partial PDF; synchronous parsing/save cannot be interrupted.
   */
  async function create(inputs, inputSettings, options) {
    const files = normalizeFiles(inputs);
    const settings = normalizeSettings(inputSettings);
    if (!options?.PDFLib?.PDFDocument?.create || !options.PDFLib.PDFDocument.load)
      throw new Error('Sunrise PDF 생성 엔진을 찾을 수 없습니다.');
    if (options.cancelled != null && typeof options.cancelled !== 'function')
      throw new Error('취소 콜백 형식이 올바르지 않습니다.');
    const pdf = await options.PDFLib.PDFDocument.create();
    pdf.setTitle('Sunrise PDF Editor - Images');
    pdf.setCreator('Sunrise PDF Editor');
    const expected = [];
    for (let index = 0; index < files.length; index++) {
      checkCancel(options);
      await yieldUI();
      checkCancel(options);
      const file = files[index];
      options.onProgress?.({done:index,total:files.length,name:file.name,phase:'reading'});
      const buffer = await file.arrayBuffer();
      checkCancel(options);
      if (buffer.byteLength !== file.size) throw new Error(`${file.name}: 파일을 완전히 읽지 못했습니다.`);
      let bytes = new Uint8Array(buffer);
      const type = detectType(bytes);
      const extension = EXT[file.name.split('.').pop().toLowerCase()];
      if (extension !== type) throw new Error(`${file.name}: 확장자와 실제 이미지 형식이 다릅니다.`);
      const requiresConversion = type === 'webp' ||
        (type === 'jpeg' && jpegExifOrientation(bytes) !== 1);
      if (requiresConversion) {
        options.onProgress?.({done:index,total:files.length,name:file.name,phase:'converting'});
        bytes = await decodeToPng(file, options);
        checkCancel(options);
      }
      options.onProgress?.({done:index,total:files.length,name:file.name,phase:'embedding'});
      const embedded = requiresConversion || type === 'png'
        ? await pdf.embedPng(bytes)
        : await pdf.embedJpg(bytes);
      checkCancel(options);
      const geometry = getPageGeometry(embedded, settings);
      const page = pdf.addPage([geometry.width, geometry.height]);
      page.drawImage(embedded, {
        x:geometry.x, y:geometry.y,
        width:geometry.drawWidth, height:geometry.drawHeight
      });
      expected.push({width:geometry.width,height:geometry.height});
      options.onProgress?.({done:index+1,total:files.length,name:file.name,phase:'done'});
      bytes = null;
    }
    checkCancel(options);
    options.onProgress?.({done:files.length,total:files.length,phase:'saving'});
    const result = await pdf.save({updateFieldAppearances:false});
    checkCancel(options);
    if (!(result instanceof Uint8Array) || !result.byteLength)
      throw new Error('PDF 생성 결과가 비어 있습니다.');
    options.onProgress?.({done:files.length,total:files.length,phase:'verifying'});
    const saved = await options.PDFLib.PDFDocument.load(result, {updateMetadata:false});
    checkCancel(options);
    const pages = saved.getPages();
    if (pages.length !== files.length) throw new Error('저장된 PDF 페이지 수가 이미지 개수와 일치하지 않습니다.');
    for (let i = 0; i < pages.length; i++) {
      const size = pages[i].getSize();
      if (Math.abs(size.width - expected[i].width) > .05 ||
          Math.abs(size.height - expected[i].height) > .05)
        throw new Error(`${i+1}쪽의 페이지 크기가 저장 과정에서 변경되었습니다.`);
    }
    return {
      bytes:result,
      pages:files.length,
      images:files.length,
      outputName:'sunrise_images_' + files.length + 'pages.pdf',
      note:'PDF 페이지 수·크기를 재열기 확인했습니다. 실제 화면 품질과 외부 뷰어 호환성은 통합 후 검증이 필요합니다.'
    };
  }

  return Object.freeze({create, normalizeFiles, normalizeSettings, detectType,
    jpegExifOrientation, getPageGeometry, MAX_IMAGES});
});
