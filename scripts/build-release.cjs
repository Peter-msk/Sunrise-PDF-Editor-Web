const fs = require('node:fs');
const path = require('node:path');
// Explicit preview mode is allowed when the locked minifier is unavailable.
// It MUST NOT be used for an approved production release.
const previewBuild = process.argv.includes('--preview-unminified');
const { minify } = previewBuild ? { minify: null } : require('terser');
const root = path.resolve(__dirname, '..');
const crypto = require('node:crypto');
function verifyVendor(name,version){
  const folder=path.join(root,'vendor',name),manifest=JSON.parse(fs.readFileSync(path.join(folder,'SUNRISE_PROVENANCE.json'),'utf8'));
  if(manifest.name!==name||manifest.version!==version||!manifest.files||!Object.keys(manifest.files).length)throw Error('Pinned vendor manifest mismatch: '+name);
  for(const [relative,expected] of Object.entries(manifest.files)){
    const file=path.resolve(folder,relative);
    if(!file.startsWith(folder+path.sep)||!fs.existsSync(file)||crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')!==expected)throw Error('Vendor integrity mismatch: '+name+'/'+relative);
  }
}
async function compact(code, module = false) {
  if (previewBuild) {
    // Normalize line endings only; execute the original source without a substitute minifier.
    // Abort on an inline script terminator rather than creating a broken/unsafe HTML bundle.
    if (/<\/script(?=[\s/>])/i.test(code)) throw Error('Inline script terminator in preview source');
    return code.replace(/\r\n?/g, '\n');
  }
  const result = await minify(code, { module, compress: false, mangle: { toplevel: false }, format: { comments: false, ascii_only: false, inline_script: true } });
  if (!result.code) throw new Error('JavaScript minification produced no output');
  return result.code;
}
(async () => {
  // USR-14: fail closed if the locked local WASM engine is not installed.
  // Keep the third-party engine on the same origin; never load from a CDN.
  verifyVendor('pdfstudio','0.4.0');verifyVendor('node-forge','1.4.1');
  const pdfStudioDist=path.join(root,'vendor/pdfstudio/dist');
  const forgeDist=path.join(root,'vendor/node-forge/dist');
  if(!fs.existsSync(path.join(forgeDist,'forge.min.js')))throw new Error('Pinned local PKI engine missing');
  for(const name of ['index.js','wasm/qpdf.wasm']) {
    if(!fs.existsSync(path.join(pdfStudioDist,name)))
      throw new Error('USR-14 local QPDF WASM missing: restore vendor/pdfstudio@0.4.0 from the verified source package');
  }
  let html = fs.readFileSync(path.join(root, 'src/editor/index.html'), 'utf8').replace(/\r\n?/g, '\n');
  const start = html.indexOf('  <script>\n');
  const end = html.indexOf('  </script>', start);
  if (start < 0 || end < start) throw new Error('Editor script boundary not found');
  const scriptStart = start + '  <script>\n'.length;
  const before = html.slice(0, scriptStart).replace(/^[ \t]*<!--[\s\S]*?-->[ \t]*\n/gm, '');
  html = before + await compact(html.slice(scriptStart, end)) + '\n' + html.slice(end);
  fs.writeFileSync(path.join(root, 'dist/editor/index.html'), html);
  for (const name of ['sunrise-diagnostics.js', 'korean-font.js', 'sunrise-edit-state.js', 'sunrise-auto-bookmarks.js', 'sunrise-outline-transfer.js', 'sunrise-batch-pages.js', 'sunrise-pdf-quality.js', 'sunrise-pdf-quality-report.js', 'sunrise-comment-report.js', 'sunrise-embedded-images.js', 'sunrise-special-pdf.js', 'sunrise-content-editor.js', 'sunrise-office-export.js', 'sunrise-pdf-cms.js', 'sunrise-pki.js', 'sunrise-pki-worker.js', 'sunrise-pdf-protect.js', 'sunrise-pdf-protect-worker.js']) {
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
  fs.cpSync(pdfStudioDist,path.join(root,'dist/assets/pdfstudio'),{recursive:true,force:true});
  const pdfStudioLicense=path.join(root,'vendor/pdfstudio/LICENSE');
  if(fs.existsSync(pdfStudioLicense))
    fs.copyFileSync(pdfStudioLicense,path.join(root,'dist/assets/pdfstudio/LICENSE.txt'));
  fs.mkdirSync(path.join(root,'dist/assets/node-forge'),{recursive:true});
  fs.copyFileSync(path.join(forgeDist,'forge.min.js'),path.join(root,'dist/assets/node-forge/forge.min.js'));
  fs.copyFileSync(path.join(root,'vendor/node-forge/LICENSE'),path.join(root,'dist/assets/node-forge/LICENSE.txt'));
  fs.mkdirSync(path.join(root, 'dist/tools'), {recursive:true});
  fs.copyFileSync(path.join(root, 'src/tools/index.html'), path.join(root, 'dist/tools/index.html'));
  require('./site-integration.cjs');
  const previewMarker = path.join(root, 'dist/SUNRISE_PREVIEW_ONLY.json');
  if (previewBuild) {
    fs.writeFileSync(previewMarker, JSON.stringify({previewOnly:true,productionDeployAllowed:false,reason:'Unminified local validation build; locked terser production build not verified'},null,2)+'\n');
    console.log('PREVIEW ONLY: unminified local assets. Production deployment is not authorized.');
  } else if (fs.existsSync(previewMarker)) fs.unlinkSync(previewMarker);
})().catch(error => { console.error(error); process.exitCode = 1; });

