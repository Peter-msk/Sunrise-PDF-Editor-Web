const assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm');
const lib = require('../dist/assets/pdf-lib/pdf-lib.min.js');
const src = fs.readFileSync('src/editor/index.html', 'utf8');
const section = (a, b) => { const i = src.indexOf(a), j = src.indexOf(b, i); assert(i >= 0 && j > i); return src.slice(i, j); };
let snapshots = 0, toast = '', callbacks = {}, modal;
const state = {pageClipboard: {sourceName: 'unchanged'}};
const elements = {
  reorderInput: {value: '2, 1'},
  reorderReverseBtn: {addEventListener: (type, fn) => callbacks.reverse = fn},
  reorderCancelBtn: {addEventListener: (type, fn) => callbacks.cancel = fn},
  reorderConfirmBtn: {addEventListener: (type, fn) => callbacks.confirm = fn},
};
const ctx = vm.createContext({window:{PDFLib:lib}, state, Set, Array, console,
  showToast: message => toast = message, saveUndoSnapshot: () => snapshots++,
  reloadDocPdfJs: async () => {}, refreshAllViews: async () => {}, closeModal: () => {},
  openModal: config => {modal = config; config.onMount();}, document: {getElementById: id => elements[id]},
  remapPageItems: (doc, order) => { doc.overlays = []; doc.bookmarks = []; }});
vm.runInContext(section('    function allowPageStructureChange(', '    function openPastePagesModal(') +
  section('    async function deleteSelectedPagesFromDoc(', '    async function rotateSelectedPages('), require('./helpers/editor-metrics.cjs')(ctx));
async function createDoc(withOutline) {
  const pdf = await lib.PDFDocument.create(); pdf.addPage([100,100]); pdf.addPage([100,100]);
  if (withOutline) {
    const root = pdf.context.obj({Type:'Outlines'}), rootRef = pdf.context.register(root);
    const item = pdf.context.obj({Title:lib.PDFHexString.fromText('기존'), Parent:rootRef, Dest:lib.PDFString.of('named-destination')});
    const ref = pdf.context.register(item); root.set(lib.PDFName.of('First'), ref); root.set(lib.PDFName.of('Last'), ref); root.set(lib.PDFName.of('Count'), lib.PDFNumber.of(1));
    pdf.catalog.set(lib.PDFName.of('Outlines'), rootRef);
  }
  return {bytes:await pdf.save(), pageCount:2, currentPage:0, selectedPages:new Set([0]), overlays:[], bookmarks:[], name:'test.pdf'};
}
(async()=>{
  const doc = await createDoc(true); ctx.doc = doc; const original = doc.bytes;
  await vm.runInContext('deleteSelectedPagesFromDoc(doc)',require('./helpers/editor-metrics.cjs')(ctx));
  assert.equal(doc.bytes, original); assert.equal(snapshots, 0); assert.match(toast, /북마크 보호/);
  await vm.runInContext('copySelectedPagesToClipboard(doc, true)',require('./helpers/editor-metrics.cjs')(ctx));
  assert.equal(doc.bytes, original); assert.equal(snapshots, 0); assert.equal(state.pageClipboard.sourceName, 'unchanged');
  vm.runInContext('openReorderPagesModal(doc)', require('./helpers/editor-metrics.cjs')(ctx)); await callbacks.confirm();
  assert.equal(doc.bytes, original); assert.equal(snapshots, 0); assert.ok(modal);
  await vm.runInContext('copySelectedPagesToClipboard(doc, false)',require('./helpers/editor-metrics.cjs')(ctx));
  assert.equal(state.pageClipboard.sourceName, 'test.pdf'); assert.equal(doc.bytes, original);
  const normal = await createDoc(false); ctx.doc = normal;
  await vm.runInContext('deleteSelectedPagesFromDoc(doc)',require('./helpers/editor-metrics.cjs')(ctx));
  assert.equal(snapshots, 1); assert.equal((await lib.PDFDocument.load(normal.bytes)).getPageCount(), 1);
  console.log('PASS: outline protection for delete, cut and reorder; copy and ordinary delete remain available');
})().catch(error => {console.error(error); process.exitCode=1;});
