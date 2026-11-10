'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {spawnSync} = require('node:child_process');
const root = path.resolve(__dirname, '..');
const dist = path.join(root, 'dist');
const pkg = JSON.parse(fs.readFileSync(path.join(root,'package.json'), 'utf8'));
const lock = JSON.parse(fs.readFileSync(path.join(root,'package-lock.json'),'utf8'));
assert.equal(pkg.devDependencies?.terser,undefined,'Terser must not be required by the offline release');
assert.equal(lock.packages['']?.devDependencies?.terser,undefined,'Terser must be removed from package-lock root');
assert.equal(lock.packages['node_modules/terser'],undefined,'Orphan Terser lock records must be removed');
const script = fs.readFileSync(path.join(root,'scripts/build-release.cjs'),'utf8');
assert(!/require\(['"]terser['"]\)/.test(script),'Build must not require Terser');
const build = spawnSync(process.execPath,[path.join(root,'scripts/build-release.cjs')],{cwd:root,encoding:'utf8',timeout:45000});
assert.equal(build.status,0,'Offline production build failed: '+build.stderr);
assert(!fs.existsSync(path.join(dist,'SUNRISE_PREVIEW_ONLY.json')),'Preview marker survived production build');
assert(!fs.existsSync(path.join(dist,'SUNRISE_BUILD_INCOMPLETE.json')),'Incomplete marker survived production build');
const manifest = JSON.parse(fs.readFileSync(path.join(dist,'SUNRISE_RELEASE_MANIFEST.json'),'utf8'));
assert.equal(manifest.build,'offline-source-preserving');
assert.equal(manifest.minifier,'none');
assert.equal(manifest.validated,'vm.Script');
assert(Object.keys(manifest.assets).length>=40,'Unexpected release asset count');
for(const [rel,digest] of Object.entries(manifest.assets)){
 const bytes = fs.readFileSync(path.join(dist,rel));
 assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'),digest,`Changed after release: ${rel}`);
 if(rel.startsWith('assets/') && rel.endsWith('.js')){
   const source = fs.readFileSync(path.join(root,'src',rel),'utf8').replace(/\r\n?/g,'\n');
   assert.equal(bytes.toString('utf8'),source+'\n',`Release silently rewrote script: ${rel}`);
 }
}
const preflight = spawnSync(process.execPath,[path.join(root,'scripts/r06-release-preflight.cjs'),'--post-build'],{cwd:root,encoding:'utf8',timeout:15000});
assert.equal(preflight.status,0,'Production release gate failed: '+preflight.stderr);
// The post-build gate must detect changes to generated release assets.
const file = path.join(dist,'assets','sunrise-pdf-visual-compare.js');
const original = fs.readFileSync(file);
try {
 fs.appendFileSync(file,'\n// tamper\n');
 const tampered = spawnSync(process.execPath,[path.join(root,'scripts/r06-release-preflight.cjs'),'--post-build'],{cwd:root,encoding:'utf8',timeout:15000});
 assert.notEqual(tampered.status,0,'Tampered production asset was accepted');
 assert.match(tampered.stderr,/해시 불일치/);
} finally {fs.writeFileSync(file, original);}
// A stale preview marker is never a deployable production release.
const preview = path.join(dist,'SUNRISE_PREVIEW_ONLY.json');
try {
 fs.writeFileSync(preview, JSON.stringify({previewOnly:true,productionDeployAllowed:false}));
 const blocked = spawnSync(process.execPath,[path.join(root,'scripts/r06-release-preflight.cjs'),'--post-build'],{cwd:root,encoding:'utf8',timeout:15000});
 assert.notEqual(blocked.status,0,'Preview build was accepted as production');
} finally {fs.rmSync(preview,{force:true});}
assert.equal(spawnSync(process.execPath,[path.join(root,'scripts/r06-release-preflight.cjs'),'--post-build'],{cwd:root,encoding:'utf8'}).status,0);
// Any early source/vendor validation error must revoke a previous release
// manifest before it can be mistaken for a successful build.
const os = require('node:os');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sunrise-r07-fail-closed-'));
try {
 fs.mkdirSync(path.join(tmp,'scripts'),{recursive:true});
 fs.mkdirSync(path.join(tmp,'dist'),{recursive:true});
 fs.copyFileSync(path.join(root,'scripts/build-release.cjs'),path.join(tmp,'scripts/build-release.cjs'));
 fs.writeFileSync(path.join(tmp,'dist/SUNRISE_RELEASE_MANIFEST.json'),'stale-success');
 const failed=spawnSync(process.execPath,[path.join(tmp,'scripts/build-release.cjs')],{cwd:tmp,encoding:'utf8',timeout:15000});
 assert.notEqual(failed.status,0,'Build without pinned vendors was accepted');
 assert(fs.existsSync(path.join(tmp,'dist/SUNRISE_BUILD_INCOMPLETE.json')),'Failed build left no stop marker');
 assert(!fs.existsSync(path.join(tmp,'dist/SUNRISE_RELEASE_MANIFEST.json')),'Stale success manifest survived failed build');
} finally {fs.rmSync(tmp,{recursive:true,force:true});}
console.log('PASS R07: offline Terser-free real production build, byte-preserving assets, manifest tamper and preview guards');
