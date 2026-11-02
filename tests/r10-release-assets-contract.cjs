const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const editor=fs.readFileSync(path.join(root,'src/editor/index.html'),'utf8');
const build=fs.readFileSync(path.join(root,'scripts/build-release.cjs'),'utf8');
const assets=fs.readdirSync(path.join(root,'src/assets')).filter(name=>name.startsWith('sunrise-')&&
  (name.includes('local-')||name.includes('page-composer')||name.includes('pdf-form-tools')||name.includes('pdf-stamper')||
    name.includes('pdf-finishing')||name.includes('pdf-metadata')||name.includes('batch-preflight')||name.includes('images-to-pdf')||
    name.includes('pdf-to-images')||name.includes('pdf-page-geometry')||name.includes('pdf-nup')||name.includes('pdf-overlay')||
    name.includes('pdf-visual-compare')||name.includes('tool-hub'))&&name.endsWith('.js'));
assert.equal(assets.length,24,`expected 24 LOCAL JS, got ${assets.length}`);
const htmlNames=[...editor.matchAll(/<script src="\/assets\/(sunrise-[^"]+\.js)"><\/script>/g)].map(x=>x[1]);
const ordered=assets.map(n=>({name:n,html:htmlNames.indexOf(n),build:build.indexOf('"'+n+'"')}));
for(const x of ordered){assert(x.html>=0,`Editor missing ${x.name}`);assert(x.build>=0,`Build missing ${x.name}`)}
const htmlLocal=htmlNames.filter(n=>assets.includes(n));
const buildLocal=htmlLocal.slice().sort((a,b)=>build.indexOf('"'+a+'"')-build.indexOf('"'+b+'"'));
assert.deepEqual(htmlLocal,buildLocal,'LOCAL dependency ordering drift between editor and release builder');
assert(fs.existsSync(path.join(root,'src/tools/index.html')),'Missing tools page');
assert(build.includes('src/tools/index.html')&&build.includes('dist/tools/index.html'),'Tool page not copied');
for (const n of ['sunrise-images-to-pdf-ui.js','sunrise-pdf-to-images-ui.js','sunrise-pdf-page-geometry-ui.js','sunrise-pdf-visual-compare-ui.js']) {
 const content=fs.readFileSync(path.join(root,'src/assets',n),'utf8');
 assert(content.includes('!root.SunriseToolHub'),`${n}: duplicate URL launch guard missing`);
}
const overlay=fs.readFileSync(path.join(root,'src/assets/sunrise-pdf-overlay-ui.js'),'utf8');
assert(overlay.includes('engine.normalizeOptions(raw)')&&overlay.includes('return raw;'),'Overlay UI must not double-normalize percentage inputs');
console.log('PASS: R10 LOCAL 24 script sources/load order/build registration; tool URL single owner; overlay raw percentage options');
