'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {assertNoPreviewAssets} = require('../scripts/check-release-ci-gate.cjs');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sunrise-preview-gate-'));
try {
 fs.mkdirSync(path.join(tmp,'dist'));
 assert.doesNotThrow(() => assertNoPreviewAssets(tmp));
 const marker = path.join(tmp,'dist','SUNRISE_PREVIEW_ONLY.json');
 fs.writeFileSync(marker,JSON.stringify({previewOnly:true,productionDeployAllowed:false}));
 assert.throws(() => assertNoPreviewAssets(tmp), /Preview-only assets exist/);
 assert.equal(JSON.parse(fs.readFileSync(marker,'utf8')).productionDeployAllowed,false);
 fs.rmSync(marker);
 assert.doesNotThrow(() => assertNoPreviewAssets(tmp));
 console.log('PASS: opt-in preview build is explicitly rejected by the release gate');
} finally {fs.rmSync(tmp,{recursive:true,force:true});}
