'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const root=path.resolve(__dirname,'..');
const dist=path.join(root,'dist');
const html=fs.readFileSync(path.join(dist,'editor/index.html'),'utf8');
assert(html.includes('Sunrise PDF Editor'),'Editor heading must be present');
assert(html.includes('/assets/sunrise-telemetry.js'),'Telemetry integration missing');
const linked=[...html.matchAll(/\b(?:src|href)="(\/assets\/[^"?#]+)"/g)].map(x=>x[1]);
const missing=linked.filter(url=>!fs.existsSync(path.join(dist,url.slice(1))));
assert.deepEqual(missing,[],'Referenced local assets must be included in dist: '+missing.join(','));
for(const vendor of ['pdfstudio','node-forge']) {
 const dir=path.join(root,'vendor',vendor);
 const manifest=JSON.parse(fs.readFileSync(path.join(dir,'SUNRISE_PROVENANCE.json'),'utf8'));
 for(const [rel,hash] of Object.entries(manifest.files)){
  const bytes=fs.readFileSync(path.join(dir,rel));
  assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'),hash,`Source vendor tampered: ${vendor}/${rel}`);
  if(rel.startsWith('dist/')) {
   const distAsset=path.join(dist,'assets',vendor,rel.slice('dist/'.length));
   if(fs.existsSync(distAsset))assert.deepEqual(fs.readFileSync(distAsset),bytes,`Distribution vendor mismatch: ${vendor}/${rel}`);
  }
 }
}
const marker=path.join(dist,'SUNRISE_PREVIEW_ONLY.json');
if(fs.existsSync(marker)){
 const info=JSON.parse(fs.readFileSync(marker,'utf8'));
 assert.equal(info.previewOnly,true);
 assert.equal(info.productionDeployAllowed,false);
}
console.log(`PASS: distribution ${fs.existsSync(marker)?'preview-only':'production'} asset integrity; ${linked.length} local references checked`);
