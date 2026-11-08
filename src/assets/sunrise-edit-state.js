(function (root) {
  'use strict';
  const KEY = 'SunriseWebEdits';
  const TOKEN = 'SunriseWebToken';
  const TYPES = new Set(['Text', 'Note', 'Highlight', 'Stamp', 'Watermark', 'Table', 'Shape', 'PageNumber', 'Header', 'Footer']);

  function validItem(item, pageCount) {
    if (!item || !TYPES.has(item.type) || !Number.isInteger(item.pageIndex) ||
        item.pageIndex < 0 || item.pageIndex >= pageCount || typeof item.text !== 'string' || item.text.length > 10000) return false;
    for (const key of ['x', 'y', 'width', 'height', 'fontSize', 'opacity']) {
      if (item[key] !== undefined && (typeof item[key] !== 'number' || !Number.isFinite(item[key]) || Math.abs(item[key]) > 10000)) return false;
    }
    if (item.rotation !== undefined && ![0, 90, 180, 270].includes(item.rotation)) return false;
    if (item.type === 'Shape' && (!['rect','ellipse','line'].includes(item.shapeKind) ||
        !Number.isFinite(item.width) || item.width < 20 || item.width > 800 ||
        !Number.isFinite(item.height) || item.height < 20 || item.height > 800 ||
        !Number.isFinite(item.strokeWidth) || item.strokeWidth < 1 || item.strokeWidth > 15)) return false;
    for (const key of ['color', 'bgColor']) {
      if (item[key] !== undefined && (typeof item[key] !== 'string' || item[key].length > 80 ||
          !/^(#[0-9a-f]{3,8}|transparent|rgba?\([\d\s.,%]+\))$/i.test(item[key]))) return false;
    }
    if (item.cells !== undefined && (!Array.isArray(item.cells) || item.cells.length > 30 ||
        item.cells.some(row => !Array.isArray(row) || row.length > 30 || row.some(cell => typeof cell !== 'string' || cell.length > 2000)))) return false;
    return true;
  }

  function record(pdfDoc, pageStreams, overlays, pdfLib) {
    const { PDFName, PDFHexString } = pdfLib;
    const key = PDFName.of(KEY);
    if (pdfDoc.catalog.has(key)) throw new Error('이 PDF의 기존 편집 정보와 충돌하여 저장을 중단했습니다.');
    if (!overlays.length) return;
    if (overlays.length > 3000 || overlays.some(item => !validItem(item, pdfDoc.getPageCount()))) {
      throw new Error('삽입 항목의 정보가 올바르지 않아 저장을 중단했습니다.');
    }
    const data = JSON.stringify(overlays);
    if (data.length > 1000000) throw new Error('삽입 항목의 크기가 너무 큽니다.');
    const token = root.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const records = [];
    for (const [pageIndex, pair] of pageStreams) {
      pair.stream.dict.set(PDFName.of(TOKEN), PDFHexString.fromText(token));
      records.push({ PageIndex: pageIndex, Content: pair.ref });
    }
    pdfDoc.catalog.set(key, pdfDoc.context.obj({
      Version: 1, Token: PDFHexString.fromText(token), Data: PDFHexString.fromText(data), Streams: records,
    }));
  }

  async function restore(bytes, pdfLib) {
    const { PDFDocument, PDFName, PDFDict, PDFArray, PDFHexString, PDFNumber, PDFRef } = pdfLib;
    const pdfDoc = await PDFDocument.load(bytes);
    const key = PDFName.of(KEY);
    if (!pdfDoc.catalog.has(key)) return { bytes, overlays: [], warning: false };
    try {
      const info = pdfDoc.catalog.lookup(key, PDFDict);
      if (info.lookup(PDFName.of('Version'), PDFNumber).asNumber() !== 1) throw new Error('unsupported version');
      const token = info.lookup(PDFName.of('Token'), PDFHexString).decodeText();
      const data = info.lookup(PDFName.of('Data'), PDFHexString).decodeText();
      if (!token || token.length > 100 || data.length > 1000000) throw new Error('invalid data');
      const overlays = JSON.parse(data);
      const pages = pdfDoc.getPages();
      if (!Array.isArray(overlays) || !overlays.length || overlays.length > 3000 ||
          overlays.some(item => !validItem(item, pages.length))) throw new Error('invalid items');
      const records = info.lookup(PDFName.of('Streams'), PDFArray);
      const pagesWithItems = new Set(overlays.map(item => item.pageIndex));
      if (records.size() !== pagesWithItems.size) throw new Error('invalid streams');
      const removals = [];
      const seen = new Set();
      for (let i = 0; i < records.size(); i++) {
        const entry = records.lookup(i, PDFDict);
        const pageIndex = entry.lookup(PDFName.of('PageIndex'), PDFNumber).asNumber();
        const ref = entry.get(PDFName.of('Content'));
        if (!Number.isInteger(pageIndex) || !pagesWithItems.has(pageIndex) || seen.has(pageIndex) || !(ref instanceof PDFRef)) throw new Error('invalid page');
        seen.add(pageIndex);
        const stream = pdfDoc.context.lookup(ref);
        if (!stream?.dict || stream.dict.lookup(PDFName.of(TOKEN), PDFHexString).decodeText() !== token) throw new Error('stream identity changed');
        const contents = pages[pageIndex].node.Contents();
        if (!(contents instanceof PDFArray)) throw new Error('contents changed');
        const indices = [];
        for (let j = 0; j < contents.size(); j++) if (contents.get(j)?.toString() === ref.toString()) indices.push(j);
        if (indices.length !== 1) throw new Error('stream missing or duplicated');
        removals.push({ contents, index: indices[0] });
      }
      for (const item of removals) item.contents.remove(item.index);
      pdfDoc.catalog.delete(key);
      return { bytes: await pdfDoc.save(), overlays, warning: false };
    } catch (error) {
      console.warn('Saved editor items could not be safely restored', error);
      return { bytes, overlays: [], warning: true };
    }
  }

  const api = { record, restore };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.SunriseEditState = api;
})(typeof globalThis !== 'undefined' ? globalThis : window);

