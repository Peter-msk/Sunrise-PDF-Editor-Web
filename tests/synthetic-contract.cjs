// Focused checks against the editor's production functions and bundled PDF engine.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const { PDFDocument, degrees } = require('../dist/assets/pdf-lib/pdf-lib.min.js');
const koreanFont = require('../dist/assets/korean-font.js');
const editState = require('../dist/assets/sunrise-edit-state.js');
const fontAssets = {
  bytes: new Uint8Array(fs.readFileSync(path.join(__dirname, '../dist/assets/fonts/DroidSansFallback.ttf'))),
  metrics: JSON.parse(fs.readFileSync(path.join(__dirname, '../dist/assets/fonts/DroidSansFallback.metrics.json'), 'utf8')),
};

const html = fs.readFileSync(path.join(__dirname, '../src/editor/index.html'), 'utf8');
function section(start, end) {
  const a = html.indexOf(start), b = html.indexOf(end, a);
  assert(a >= 0 && b > a, `missing production function ${start}`);
  return html.slice(a, b);
}

const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFElEQVR4nGMUzpv/n4GBgYGJAQoAH5wCI2l1nlIAAAAASUVORK5CYII=';
const paint = { measureText: () => ({ width: 50 }), scale() {}, fillRect() {},
  strokeRect() {}, fillText() {} };
const context = vm.createContext({
  window: { PDFLib: require('../dist/assets/pdf-lib/pdf-lib.min.js'), SunriseEditState: editState,
    SunriseOutlineTransfer: require('../src/assets/sunrise-outline-transfer.js'),
    SunriseKoreanFont: { embed: (doc, texts) => koreanFont.embed(doc, texts, fontAssets) } },
  document: { createElement: () => ({ getContext: () => paint, toDataURL: () => png }) },
  console, Uint8Array, Date,
});
vm.runInContext('let overlayIdCounter = 100;\n' +
  section('    function remapPageItems', '    function openSaveAsModal') +
  section('    function addPdfHighlight(', '    async function highlightCurrentSearchHit(') +
  section('    function appendPdfBookmarks(', '    async function compileDocumentWithOverlays(') +
  section('    async function compileDocumentWithOverlays', '    // =========================================================================\n    // Feature 1:'), context);

(async () => {
  const doc = { overlays: [
    { id: 'one', pageIndex: 0, text: 'first' },
    { id: 'two', pageIndex: 1, text: 'second' },
  ], bookmarks: [{ id: 'b', page: 1, title: 'mark' }] };
  context.doc = doc;
  vm.runInContext('remapPageItems(doc, [1, 0, 1])', context);
  assert.equal(JSON.stringify(doc.overlays.map(x => [x.text, x.pageIndex])), JSON.stringify([['second', 0], ['first', 1], ['second', 2]]));
  assert.notEqual(doc.overlays[0].id, doc.overlays[2].id);
  assert.equal(JSON.stringify(doc.bookmarks.map(x => x.page)), JSON.stringify([0, 2]));
  const inserted = vm.runInContext('insertedPageMap(3, 1, 2)', context);
  assert.deepEqual(Array.from(inserted), [0, null, null, 1, 2]);

  const pdf = await PDFDocument.create();
  pdf.addPage([400, 600]);
  context.pdfForHighlight = pdf;
  vm.runInContext('addPdfHighlight(pdfForHighlight, 0, [30, 500, 80, 520])', context);
  pdf.addPage([400, 600]).setRotation(degrees(90));
  const bytes = await pdf.save();
  context.realDoc = {
    bytes, bookmarks: [{title: '첫 장', page: 0}], metadata: { title: 'Synthetic test', author: '', subject: '', keywords: '' },
    attachments: [{ name: 'fixture.txt', bytes: new TextEncoder().encode('synthetic attachment'), type: 'text/plain', isNew: true }],
    overlays: [
      { pageIndex: 0, type: 'Text', text: '한글 시험 ABC', x: 30, y: 40, width: 200, height: 30 },
      { pageIndex: 1, type: 'Note', text: 'Test', x: 50, y: 60, width: 80, height: 30 },
    ],
    pdfJsDoc: { getPage: async index => ({ rotate: index === 2 ? 90 : 0,
      getViewport: () => ({ convertToPdfPoint: (x, y) => index === 2 ? [y, x] : [x, 600 - y] }) }) },
  };
  const output = await vm.runInContext('compileDocumentWithOverlays(realDoc)', context);
  const outputPdf = await PDFDocument.load(output);
  assert.equal(outputPdf.getPageCount(), 2);
  assert(outputPdf.catalog.get(context.window.PDFLib.PDFName.of('Outlines')));
  assert.equal(outputPdf.getPage(0).node.Annots().size(),1);
  const restored = await editState.restore(output, context.window.PDFLib);
  assert.equal(restored.warning, false);
  assert.equal((await PDFDocument.load(restored.bytes)).getPage(0).node.Annots().size(),1);
  assert.equal(restored.overlays.length, 2);
  assert.equal(restored.overlays[0].text, '한글 시험 ABC');
  restored.overlays[0].text = '수정된 한글 ABC';
  context.editedDoc = { ...context.realDoc, bytes: restored.bytes, overlays: restored.overlays,
    attachments: [] };
  const edited = await vm.runInContext('compileDocumentWithOverlays(editedDoc)', context);
  assert.equal((await editState.restore(edited, context.window.PDFLib)).overlays[0].text, '수정된 한글 ABC');
  const target = process.env.SUNRISE_TEST_PDF;
  if (target) { fs.writeFileSync(target, output); fs.writeFileSync(target.replace(/\.pdf$/i, '.edited.pdf'), edited); }
  console.log('PASS: page remapping, searchable Korean PDF text, attachment, rotated overlay and saved-item restoration');
})().catch(error => { console.error(error); process.exit(1); });

