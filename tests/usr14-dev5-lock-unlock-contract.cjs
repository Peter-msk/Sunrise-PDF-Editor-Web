/* FUTURE DEV5 source contract — NOT executed during authoring.
 * Actual interoperability requires a separately authorized QPDF WASM test.
 */
'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
const engine=read('src/assets/sunrise-pdf-protect.js');
const worker=read('src/assets/sunrise-pdf-protect-worker.js');
const editor=read('src/editor/index.html');
const hub=read('src/assets/sunrise-tool-hub.js');
assert(engine.includes("function unlockPdf(options){return workerOperation('unlock',options);}"));
assert(engine.includes('ownerPassword === password'));
assert(worker.includes('self.crypto.getRandomValues(random)'));
assert(worker.includes('await pdf.unlock(source,{password:message.password})'));
assert(worker.includes('after.pageCount!==before.pageCount'));
assert(editor.includes('case "unlockPdfPassword":'));
assert(editor.includes('openPdfPasswordUnlockModal()'));
assert(editor.includes('pdfProtectOwnerPassword'));
assert(hub.includes("action:'unlockPdfPassword'"));
assert(!engine.includes('localStorage'));
assert(!worker.includes('localStorage'));
console.log('USR-14 DEV5 code-connection contract passed');
