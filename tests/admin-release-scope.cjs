'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),{execFileSync}=require('node:child_process');
const files=execFileSync('git',['diff','--name-only','origin/main...HEAD'],{encoding:'utf8'})
  .trim().split(/\r?\n/).filter(Boolean);
const blocked=files.filter(x=>x.startsWith('src/editor/')||x.startsWith('dist/editor/')||
  (x.startsWith('src/assets/')&&!x.includes('sunrise-telemetry'))||
  (x.startsWith('dist/assets/')&&!['dist/assets/sunrise-telemetry.js','dist/assets/sunrise-admin-password.js','dist/assets/sunrise-home-admin.css'].includes(x))||
  x==='dist/index.html');
assert.deepEqual(blocked,[],'admin-only release must not include unapproved editor or homepage assets');
const code=fs.readFileSync('src/worker.mjs','utf8');
for(const name of ['adminApi','getAdminSession','authRoutes','runTrackedAdminRetention']){
 assert(code.includes(name),'required admin module '+name);
}
const admin=fs.readFileSync('dist/admin/index.html','utf8');
assert(admin.includes('문의')&&admin.includes('공지'),'administrator UI exists');
const config=fs.readFileSync('wrangler.toml','utf8');
assert(config.includes('[version_metadata]')&&config.includes('CF_VERSION_METADATA'));
assert(fs.existsSync('scripts/admin-production-gate.cjs'));
console.log('PASS: isolated administrator release scope and UI/module wiring');
