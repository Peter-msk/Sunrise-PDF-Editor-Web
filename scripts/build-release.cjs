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
  let html = fs.readFileSync(path.join(root, 'src/editor/index.html'), 'utf8').replace(/\r\n?/g, '\n');
  const start = html.indexOf('  <script>\n');
  const end = html.indexOf('  </script>', start);
  if (start < 0 || end < start) throw new Error('Editor script boundary not found');
  const scriptStart = start + '  <script>\n'.length;
  const before = html.slice(0, scriptStart).replace(/^[ \t]*<!--[\s\S]*?-->[ \t]*\n/gm, '');
  html = before + await compact(html.slice(scriptStart, end)) + '\n' + html.slice(end);
  fs.writeFileSync(path.join(root, 'dist/editor/index.html'), html);
  for (const name of ['korean-font.js', 'sunrise-edit-state.js', 'sunrise-auto-bookmarks.js', 'sunrise-outline-transfer.js', 'sunrise-batch-pages.js', 'sunrise-pdf-quality.js', 'sunrise-pdf-quality-report.js', 'sunrise-comment-report.js', 'sunrise-embedded-images.js', 'sunrise-special-pdf.js', 'sunrise-office-export.js']) {
    const source = fs.readFileSync(path.join(root, 'src/assets', name), 'utf8');
    fs.writeFileSync(path.join(root, 'dist/assets', name), await compact(source) + '\n');
  }
  // SUNRISE-LOCAL-R07: manifest-pinned feature assets.
  for (const name of [
    "sunrise-local-ui.js",
    "sunrise-local-metrics.js",
    "sunrise-page-composer.js",
    "sunrise-page-composer-ui.js",
    "sunrise-pdf-form-tools.js",
    "sunrise-pdf-stamper.js",
    "sunrise-pdf-finishing-ui.js",
    "sunrise-pdf-metadata.js",
    "sunrise-pdf-metadata-ui.js",
    "sunrise-batch-preflight.js",
    "sunrise-batch-preflight-ui.js",
    "sunrise-images-to-pdf.js",
    "sunrise-images-to-pdf-ui.js",
    "sunrise-pdf-to-images.js",
    "sunrise-pdf-to-images-ui.js",
    "sunrise-pdf-page-geometry.js",
    "sunrise-pdf-page-geometry-ui.js",
    "sunrise-pdf-nup.js",
    "sunrise-pdf-nup-ui.js",
    "sunrise-pdf-overlay.js",
    "sunrise-pdf-overlay-ui.js",
    "sunrise-pdf-visual-compare.js",
    "sunrise-pdf-visual-compare-ui.js",
    "sunrise-tool-hub.js"
  ]) {
    const input = fs.readFileSync(path.join(root, 'src/assets', name), 'utf8');
    fs.writeFileSync(path.join(root, 'dist/assets', name), await compact(input) + '\n');
  }
  fs.mkdirSync(path.join(root, 'dist/tools'), {recursive:true});
  fs.copyFileSync(path.join(root, 'src/tools/index.html'), path.join(root, 'dist/tools/index.html'));
  require('./site-integration.cjs');
})().catch(error => { console.error(error); process.exitCode = 1; });

