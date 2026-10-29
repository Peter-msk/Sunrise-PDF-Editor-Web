// Exercises production compilation against diverse disposable PDF inputs.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const pdfLib = require('../dist/assets/pdf-lib/pdf-lib.min.js');
const editState = require('../dist/assets/sunrise-edit-state.js');
const koreanFont = require('../dist/assets/korean-font.js');
const { PDFDocument } = pdfLib;
const folder = process.argv[2];
assert(folder, 'fixture directory is required');
const html = fs.readFileSync(path.join(__dirname, '../src/editor/index.html'), 'utf8');
const start = html.indexOf('    async function compileDocumentWithOverlays');
const end = html.indexOf('    // =========================================================================\n    // Feature 1:', start);
assert(start >= 0 && end > start);
const ctx = vm.createContext({ window: { PDFLib: pdfLib, SunriseEditState: editState, SunriseKoreanFont: koreanFont }, console, Uint8Array });
vm.runInContext(html.slice(start, end), ctx);

(async () => {
  const files = ['korean_multipage.pdf', 'scanned_image.pdf', 'rotated_pages.pdf', 'form_attachment.pdf'];
  for (const file of files) {
    const input = new Uint8Array(fs.readFileSync(path.join(folder, file)));
    const original = await PDFDocument.load(input);
    ctx.testDoc = { bytes: input, overlays: [], attachments: [], metadata: {
      title: original.getTitle() || '', author: original.getAuthor() || '',
      subject: original.getSubject() || '', keywords: original.getKeywords() || '',
    } };
    const output = await vm.runInContext('compileDocumentWithOverlays(testDoc)', ctx);
    const reread = await PDFDocument.load(output);
    assert.equal(reread.getPageCount(), original.getPageCount(), file);
    fs.writeFileSync(path.join(folder, file.replace('.pdf', '.output.pdf')), output);
  }
  const encrypted = fs.readFileSync(path.join(folder, 'encrypted.pdf'));
  await assert.rejects(() => PDFDocument.load(encrypted), /encrypt/i);
  const broken = fs.readFileSync(path.join(folder, 'broken.pdf'));
  let rejected = false;
  try { const doc = await PDFDocument.load(broken); rejected = doc.getPageCount() < 1; }
  catch { rejected = true; }
  assert(rejected, 'truncated PDF must not be accepted as a usable PDF');
  const merged = await PDFDocument.create();
  for (const file of files.slice(0, 3)) {
    const source = await PDFDocument.load(fs.readFileSync(path.join(folder, file)));
    (await merged.copyPages(source, source.getPageIndices())).forEach(page => merged.addPage(page));
  }
  const bytes = await merged.save();
  assert.equal((await PDFDocument.load(bytes)).getPageCount(), 6);
  fs.writeFileSync(path.join(folder, 'merged.output.pdf'), bytes);
  console.log('PASS: four PDF save/reopen paths, protected/broken rejection, and 3+1+2 page merge');
})().catch(error => { console.error(error); process.exit(1); });
