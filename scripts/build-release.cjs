const fs = require('node:fs');
const path = require('node:path');
// Production release preserves source semantics without a minifier or npm dependency.
// Preview mode remains a separate, explicitly non-deployable path.
const previewBuild = process.argv.includes('--preview-unminified');
const vm = require('node:vm');
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
function compact(code, module = false, name = '<release script>') {
  // No syntax rewriting, obfuscation, compression or external dependencies.
  // HTML's parser terminates an inline script even if a closing tag appears in
  // a JavaScript string or comment; prevent this before creating the artifact.
  if (/<\/script(?=[\s/>])/i.test(code))
    throw Error('Unsafe inline script terminator in '+name);
  const normalized = code.replace(/\r\n?/g, '\n');
  // VM syntax validation is deterministic, offline and does not execute code.
  // All scripts packaged here are classic scripts; module compilation is not
  // required by the current release asset contract.
  new vm.Script(normalized, {filename:name});
  return normalized;
}
function sha256(bytes){return crypto.createHash('sha256').update(bytes).digest('hex');}
(async () => {
  // Mark production output invalid before any read/verification that may fail;
  // never trust a stale success manifest after a failed new build.
  const dist=path.join(root,'dist');
  const incompleteMarker=path.join(dist,'SUNRISE_BUILD_INCOMPLETE.json');
  const releaseManifest=path.join(dist,'SUNRISE_RELEASE_MANIFEST.json');
  if(!previewBuild){
    fs.writeFileSync(incompleteMarker,JSON.stringify({buildComplete:false,reason:'Build has not yet passed validation'})+'\n');
    fs.rmSync(releaseManifest,{force:true});
  }
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
  const generated=[];
  let html = fs.readFileSync(path.join(root, 'src/editor/index.html'), 'utf8').replace(/\r\n?/g, '\n');
  const start = html.indexOf('  <script>\n');
  const end = html.indexOf('  </script>', start);
  if (start < 0 || end < start) throw new Error('Editor script boundary not found');
  const scriptStart = start + '  <script>\n'.length;
  const before = html.slice(0, scriptStart).replace(/^[ \t]*<!--[\s\S]*?-->[ \t]*\n/gm, '');
  html = before + compact(html.slice(scriptStart, end), false, 'src/editor/index.html#inline') + '\n' + html.slice(end);
  fs.writeFileSync(path.join(root, 'dist/editor/index.html'), html);
  generated.push('editor/index.html');
  for (const name of ['sunrise-diagnostics.js', 'korean-font.js', 'sunrise-edit-state.js', 'sunrise-auto-bookmarks.js', 'sunrise-outline-transfer.js', 'sunrise-batch-pages.js', 'sunrise-pdf-quality.js', 'sunrise-pdf-quality-report.js', 'sunrise-comment-report.js', 'sunrise-embedded-images.js', 'sunrise-special-pdf.js', 'sunrise-content-editor.js', 'sunrise-office-export.js', 'sunrise-pdf-cms.js', 'sunrise-pki.js', 'sunrise-pki-worker.js', 'sunrise-pdf-protect.js', 'sunrise-pdf-protect-worker.js']) {
    const source = fs.readFileSync(path.join(root, 'src/assets', name), 'utf8');
    fs.writeFileSync(path.join(root, 'dist/assets', name), compact(source,false,'src/assets/'+name) + '\n');
    generated.push('assets/'+name);
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
    fs.writeFileSync(path.join(root, 'dist/assets', name), compact(input,false,'src/assets/'+name) + '\n');
    generated.push('assets/'+name);
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
  generated.push('index.html','tools/index.html');
  const previewMarker = path.join(dist, 'SUNRISE_PREVIEW_ONLY.json');
  if (previewBuild) {
    fs.writeFileSync(previewMarker, JSON.stringify({previewOnly:true,productionDeployAllowed:false,reason:'Preview validation is not the audited production build'},null,2)+'\n');
    console.log('PREVIEW ONLY: production release checks are intentionally not certified.');
  } else {
    // Hash each asset after integration and syntax checks to detect later drift.
    for(const rel of generated){
      const file=path.join(dist,rel);
      if(!fs.existsSync(file)) throw Error('Generated release asset missing: '+rel);
    }
    const hashes=Object.fromEntries(generated.sort().map(rel=>[rel,sha256(fs.readFileSync(path.join(dist,rel)))]));
    fs.writeFileSync(releaseManifest,JSON.stringify({format:1,build:'offline-source-preserving',minifier:'none',validated:'vm.Script',assets:hashes},null,2)+'\n');
    fs.rmSync(previewMarker,{force:true});
    fs.rmSync(incompleteMarker,{force:true});
    console.log('PASS: validated offline production build, '+generated.length+' release asset hashes, no Terser');
  }
})().catch(error => { console.error(error); process.exitCode = 1; });

