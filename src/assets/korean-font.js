(function (root) {
  'use strict';
  let assetsPromise;

  function makeFontKit(metrics, texts) {
    const characters = new Set();
    const byGlyph = new Map();
    for (const value of texts) {
      for (const char of String(value || '').normalize('NFC').replace(/\t/g, ' ')) {
        if (char === '\n' || char === '\r') continue;
        const codepoint = char.codePointAt(0);
        const entry = metrics.glyphs[codepoint];
        if (!entry) throw new Error(`저장 글꼴에서 지원하지 않는 문자: ${char} (U+${codepoint.toString(16).toUpperCase()})`);
        const previous = byGlyph.get(entry[0]);
        if (previous !== undefined && previous !== codepoint) {
          throw new Error('일부 문자의 글꼴 매핑이 겹쳐 정확한 텍스트 저장을 중단했습니다.');
        }
        byGlyph.set(entry[0], codepoint);
        characters.add(codepoint);
      }
    }
    const getGlyph = (codepoint) => {
      const entry = metrics.glyphs[codepoint];
      if (!entry) throw new Error(`지원하지 않는 글꼴 코드: U+${codepoint.toString(16).toUpperCase()}`);
      return { id: entry[0], advanceWidth: entry[1], codePoints: [codepoint] };
    };
    return { create: () => ({
      unitsPerEm: metrics.unitsPerEm, ascent: metrics.ascent, descent: metrics.descent,
      bbox: metrics.bbox, postscriptName: 'DroidSansFallback', italicAngle: 0, cff: false,
      post: { isFixedPitch: false }, head: { macStyle: { italic: false } },
      characterSet: Array.from(characters), glyphForCodePoint: getGlyph,
      layout: (text) => ({ glyphs: Array.from(String(text).normalize('NFC').replace(/\t/g, ' '),
        (char) => getGlyph(char.codePointAt(0))) }),
    }) };
  }

  async function loadAssets() {
    if (!assetsPromise) {
      assetsPromise = Promise.all([
        fetch('/assets/fonts/DroidSansFallback.ttf'),
        fetch('/assets/fonts/DroidSansFallback.metrics.json'),
      ]).then(async ([font, metrics]) => {
        if (!font.ok || !metrics.ok) throw new Error('한글 저장 글꼴을 불러오지 못했습니다.');
        return { bytes: new Uint8Array(await font.arrayBuffer()), metrics: await metrics.json() };
      }).catch((error) => { assetsPromise = undefined; throw error; });
    }
    return assetsPromise;
  }

  async function embed(pdfDoc, texts, suppliedAssets) {
    const assets = suppliedAssets || await loadAssets();
    pdfDoc.registerFontkit(makeFontKit(assets.metrics, texts));
    return pdfDoc.embedFont(assets.bytes, { subset: false });
  }

  const api = { makeFontKit, embed };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.SunriseKoreanFont = api;
})(typeof globalThis !== 'undefined' ? globalThis : window);
