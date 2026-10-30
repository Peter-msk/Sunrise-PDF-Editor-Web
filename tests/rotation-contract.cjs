const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const PDFLib = require('../dist/assets/pdf-lib/pdf-lib.min.js');
const source = fs.readFileSync(require('node:path').join(__dirname, '../src/editor/index.html'), 'utf8');
const start = source.indexOf('    async function rotateSelectedPages(');
const end = source.indexOf('    // Content & Annotation Modals', start);
assert(start >= 0 && end > start);
const notices = [];
let failParsing = false;
const ctx = vm.createContext({window:{PDFLib}, console:{error() {}}, Set, activeDoc: () => ctx.doc,
  showToast: message => notices.push(message),
  saveUndoSnapshot: doc => { doc.savedSnapshots.push(doc.bytes); },
  parsePageCountAndMeta: async bytes => {
    if (failParsing) throw Error('synthetic parse failure');
    const parsed = await PDFLib.PDFDocument.load(bytes);
    return {pageCount:parsed.getPageCount(), pdfJsDoc:{destroy:async()=>{}}};
  },
  reloadDocPdfJs: async (doc, options) => { doc.selectedPages = new Set(options.selection); },
  refreshAllViews: async () => {}, document:{querySelector:()=>null}, updateCommandStates:()=>{}, syncThumbnailSelection:()=>{}, requestAnimationFrame:fn=>fn(),
});
vm.runInContext(source.slice(start, end), ctx);
(async () => {
  const original = await PDFLib.PDFDocument.create();
  original.addPage([300,500]);
  original.addPage([300,500]).setRotation(PDFLib.degrees(90));
  original.addPage([300,500]);
  const initial = await original.save();
  const initialCopy = Buffer.from(initial);
  ctx.doc = {bytes:initial, selectedPages:new Set([0,1]), currentPage:0, pageSizes:[{width:300,height:500},{width:500,height:300},{width:300,height:500}], pdfJsDoc:{}, overlays:[], savedSnapshots:[]};
  await vm.runInContext('rotateSelectedPages(doc, 90)',ctx);
  let pdf = await PDFLib.PDFDocument.load(ctx.doc.bytes);
  assert.deepEqual(pdf.getPages().map(p=>p.getRotation().angle), [90,180,0]);
  assert.deepEqual(Array.from(ctx.doc.selectedPages), [0,1]);
  assert.deepEqual(Buffer.from(initial), initialCopy);
  assert(notices.some(x=>x.includes("2개 페이지를 회전했습니다")));
  await vm.runInContext('rotateSelectedPages(doc, -90)',ctx);
  pdf = await PDFLib.PDFDocument.load(ctx.doc.bytes);
  assert.deepEqual(pdf.getPages().map(p=>p.getRotation().angle), [0,90,0]);
  const beforeFailure = ctx.doc.bytes;
  const snapshots = ctx.doc.savedSnapshots.length;
  failParsing = true;
  await vm.runInContext('rotateSelectedPages(doc, 90)',ctx);
  assert.strictEqual(ctx.doc.bytes, beforeFailure);
  assert.equal(ctx.doc.savedSnapshots.length, snapshots);
  assert.equal(ctx.doc.operationBusy, false);
  failParsing = false;
  ctx.doc.overlays = [{type:'Text',pageIndex:0,x:30,y:40}];
  await vm.runInContext('rotateSelectedPages(doc, 90)',ctx);
  assert.deepEqual([ctx.doc.overlays[0].x,ctx.doc.overlays[0].y,ctx.doc.overlays[0].rotation],[460,30,90]);
  ctx.doc.overlays = [{type:'unknown',pageIndex:0,x:30,y:40}];
  const current = ctx.doc.bytes;
  await vm.runInContext('rotateSelectedPages(doc, 90)',ctx);
  assert.strictEqual(ctx.doc.bytes,current);
  assert(notices.some(x=>x.includes('삽입 항목')));
  console.log('PASS: multi-page clockwise/counterclockwise, selection, failure atomicity, overlay safety');
})().catch(error => {console.error(error);process.exit(1)});

