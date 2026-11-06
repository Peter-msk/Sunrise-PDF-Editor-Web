'use strict';
// R32-DEV2: authored source-contract examples. NOT EXECUTED at creation time.
const assert=require('node:assert/strict');
const source=require('../src/assets/sunrise-special-pdf.js');
assert.equal(source.isSourceTextCandidate('INVOICE 2026'),true);
assert.equal(source.isSourceTextCandidate('Résumé € – 2026'),true);
assert.equal(source.isSourceTextCandidate('L\u2019été (2026)'),true);
assert.equal(source.isSourceTextCandidate('한글 문구'),false);
assert.equal(source.isSourceTextCandidate('\u{1F600}'),false);
assert.equal(source.isSourceTextCandidate('\u0000'),false);
assert.equal(source.isSourceTextCandidate('A'.repeat(121)),false);
assert.deepEqual(source.normalizeSourceTextBatch([
  {pageNumber:1,original:'RÉSUMÉ',replacement:'RESUME'},
  {pageNumber:2,original:'EUR €',replacement:'USD $'},
 ],2).map(x=>x.pageNumber),[1,2]);
assert.throws(()=>source.normalizeSourceTextBatch([
  {pageNumber:1,original:'한글',replacement:'AB'},
 ],1),/WinAnsi/);
assert.throws(()=>source.normalizeSourceTextBatch([
  {pageNumber:1,original:'A',replacement:'B€'},
 ],1),/바이트/);
console.log('DEV2 WinAnsi source text guard examples: PASS');
