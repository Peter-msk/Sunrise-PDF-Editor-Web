'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs');
// GitHub Actions can be intentionally disabled for quota management.
// The release contract must still guard the same workflow without re-enabling it.
const active='.github/workflows/manual-production-release.yml';
const paused=active+'.paused';
assert.notEqual(fs.existsSync(active),fs.existsSync(paused),'Release workflow must exist in exactly one active/paused form');
const filename=fs.existsSync(active)?active:paused;
const workflow=fs.readFileSync(filename,'utf8');
assert(!fs.existsSync('.github/workflows/production-release.yml'),
 'There must be exactly one manually approved production release workflow');
for(const text of [
 'workflow_dispatch:', 'inputs.confirmed_release', "github.ref == 'refs/heads/main'",
 'environment: production','private_backup_sha256','isolated_restore_receipt',
 'BACKUP_HASH','RESTORE_RECEIPT','DEPLOYMENT_EVENT_SECRET',
 'CLOUDFLARE_REHEARSAL_D1_DATABASE_ID','WRANGLER_REHEARSAL_CONFIG','REHEARSAL_D1_ID',
 'Prepare isolated D1 verification config (not production)',
 'node scripts/check-release-ci-gate.cjs','node scripts/check-release-recovery-evidence.cjs','npm test','npm run progress:check','npm run build',
 'npm run release:schema','admin_publication_restore_runs','PUBLICATION_RESTORE_SIGNING_KEY','wrangler secret list --name sunrise-pdf-editor --format json',
 '바인딩이 없어 배포를 차단합니다.','wrangler deploy --dry-run','wrangler deploy',
 '/editor/','/api/site-updates','/api/admin/health',
 'node scripts/report-deployment.cjs succeeded','node scripts/report-deployment.cjs failed'
])assert(workflow.includes(text),'Release workflow missing: '+text);
assert(!/\n\s+push:|\n\s+schedule:|\n\s+pull_request:/.test(workflow),
 'Production deployment must not run automatically on push, schedule or PR');
const positions=[
 'node scripts/check-release-ci-gate.cjs','npm test','npm run progress:check',
 'npm run build','node scripts/check-release-recovery-evidence.cjs','npm run release:schema',
 'Verify publication restore audit migration on production D1',
 'wrangler secret list --name sunrise-pdf-editor --format json','wrangler deploy --dry-run',
 'run: ./node_modules/.bin/wrangler deploy\n','Smoke-test public editor'
].map(x=>workflow.indexOf(x));
assert(positions.every(x=>x>=0),'Release verification stage missing');
assert(positions.every((x,i)=>i===0||x>positions[i-1]),
 'Every release check must be executed in order, before publishing');
assert(workflow.includes("steps.deploy.outcome == 'success'"));
assert(workflow.includes('steps.smoke.outcome'));
assert(workflow.includes('CLOUDFLARE_API_TOKEN')&&workflow.includes('CLOUDFLARE_ACCOUNT_ID'));

const {parseEvidence,validateCounts,TABLES}=require('../scripts/check-release-recovery-evidence.cjs');
const hash='a'.repeat(64), counts=[2,0,10,5,1,3], receipt='r12:'+hash+':'+counts.map(x=>x.toString(36)).join(',');
assert.deepEqual(parseEvidence(hash,receipt),counts);
assert.throws(()=>parseEvidence('b'.repeat(64),receipt));
assert.throws(()=>parseEvidence(hash,'fake-confirmation'));
const rows=TABLES.map((table_name,i)=>({table_name,row_count:counts[i]}));
assert.equal(validateCounts(counts,rows),true);
assert.throws(()=>validateCounts(counts,rows.map((x,i)=>i===0?{...x,row_count:x.row_count+1}:x)));
assert.throws(()=>validateCounts(counts,rows.slice(1)));

console.log('PASS: manual release enforces private backup receipt, remote isolated D1 counts, migration, CI and smoke gates');
