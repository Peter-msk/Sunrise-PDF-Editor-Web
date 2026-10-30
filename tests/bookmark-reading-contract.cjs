const assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm');
const src = fs.readFileSync('src/editor/index.html', 'utf8');
const a = src.indexOf('    async function readPdfOutline('), b = src.indexOf('    async function ensurePageTexts(', a);
assert(a >= 0 && b > a);
const ctx = vm.createContext({}); vm.runInContext(src.slice(a, b), ctx);
(async () => {
  const ref = {num: 5, gen: 0};
  const reader = {numPages: 3, getOutline: async () => [
    {title: '첫 장', dest: 'chapter', items: [{title: '하위', dest: [ref, 'Fit'], items: []}]},
    {title: '외부 링크', dest: null, items: []}
  ], getDestination: async name => name === 'chapter' ? [0, 'Fit'] : null,
  getPageIndex: async value => { assert.equal(value, ref); return 2; }};
  ctx.reader = reader;
  const rows = await vm.runInContext('readPdfOutline(reader)', ctx);
  assert.deepEqual(Array.from(rows, x => [x.title, x.depth]), [['첫 장', 0], ['하위', 1], ['외부 링크', 0]]);
  ctx.dest = rows[0].dest; assert.equal(await vm.runInContext('outlinePage(reader, dest)', ctx), 0);
  ctx.dest = rows[1].dest; assert.equal(await vm.runInContext('outlinePage(reader, dest)', ctx), 2);
  ctx.dest = rows[2].dest; assert.equal(await vm.runInContext('outlinePage(reader, dest)', ctx), null);
  ctx.dest = [8, 'Fit']; assert.equal(await vm.runInContext('outlinePage(reader, dest)', ctx), null);
  reader.getOutline = async () => { throw Error('broken outline'); };
  await assert.rejects(vm.runInContext('readPdfOutline(reader)', ctx), /broken outline/);
  console.log('PASS: nested outlines, named and direct destinations, unavailable links, read errors');
})().catch(e => {console.error(e); process.exitCode = 1});
