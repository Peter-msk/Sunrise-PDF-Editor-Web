'use strict';
// R29 DEFERRED targeted/browser contract source. DO NOT execute until the user
// explicitly authorizes verification. Delivery is not a PASS result.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const engine=require('../src/assets/sunrise-special-pdf.js');
const rows='1\tINVOICE 2026\tINVOICE 2027\r\n2\tSTATUS DRAFT\tSTATUS FINAL\r\n';
const edits=engine.parseSourceTextBatch(rows,2);
const serialized=engine.serializeSourceTextBatch(edits,2);
assert.equal(serialized,'1\tINVOICE 2026\tINVOICE 2027\n2\tSTATUS DRAFT\tSTATUS FINAL\n');
assert.deepEqual(engine.parseSourceTextBatch(serialized,2),edits);
assert.throws(()=>engine.serializeSourceTextBatch([
 {pageNumber:1,original:'A',replacement:'B'},
 {pageNumber:1,original:'B',replacement:'C'}
],2),/충돌/);
const editor=fs.readFileSync('src/editor/index.html','utf8');
for(const marker of [
 'sourceBatchCandidatePage','sourceBatchCandidate','sourceBatchFind','sourceBatchInsert','sourceBatchPlanFile',
 'sourceBatchImport','sourceBatchExport','candidateSerial','candidatePage',
 'engine.serializeSourceTextBatch(',"candidateStatus.textContent=",
 'planFile.addEventListener(\'change\'',
 'input.value=combined;invalidate();',
 'input.value=content;invalidate();',
 "saveUndoSnapshot(doc,'PDF 원문 여러 곳 직접 수정"
])assert(editor.includes(marker),'R29 UI marker absent: '+marker);
assert(editor.includes('option.textContent='),'PDF text must not be inserted as HTML');
assert(editor.includes("accept=\".tsv,.txt"),'local file import should be restricted in UI');
console.log('PASS R29: planned TSV roundtrip, safe PDF text candidate UI and existing atomic apply path');
