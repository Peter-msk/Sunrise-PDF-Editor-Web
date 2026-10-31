const fs = require('node:fs');
const path = require('node:path');
const { minify } = require('terser');
const root = path.resolve(__dirname, '..');
async function compact(code, module = false) {
  const result = await minify(code, { module, compress: false, mangle: { toplevel: false }, format: { comments: false, ascii_only: false, inline_script: true } });
  if (!result.code) throw new Error('JavaScript minification produced no output');
  return result.code;
}
(async () => {
  let html = fs.readFileSync(path.join(root, 'src/editor/index.html'), 'utf8');
  const start = html.indexOf('  <script>\n');
  const end = html.indexOf('  </script>', start);
  if (start < 0 || end < start) throw new Error('Editor script boundary not found');
  const scriptStart = start + '  <script>\n'.length;
  const before = html.slice(0, scriptStart).replace(/^[ \t]*<!--[\s\S]*?-->[ \t]*\n/gm, '');
  html = before + await compact(html.slice(scriptStart, end)) + '\n' + html.slice(end);
  fs.writeFileSync(path.join(root, 'dist/editor/index.html'), html);
  for (const name of ['korean-font.js', 'sunrise-edit-state.js', 'sunrise-auto-bookmarks.js']) {
    const source = fs.readFileSync(path.join(root, 'src/assets', name), 'utf8');
    fs.writeFileSync(path.join(root, 'dist/assets', name), await compact(source) + '\n');
  }
  require('./site-integration.cjs');
})().catch(error => { console.error(error); process.exitCode = 1; });

