'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs');
const filename='.github/workflows/manual-production-release.yml';
const workflow=fs.readFileSync(filename,'utf8');
assert(!fs.existsSync('.github/workflows/production-release.yml'),
 'There must be exactly one manually approved production release workflow');
for(const text of [
 'workflow_dispatch:', 'inputs.confirmed_release', "github.ref == 'refs/heads/main'",
 'environment: production','private_backup_sha256','isolated_restore_receipt',
 'BACKUP_HASH','RESTORE_RECEIPT','DEPLOYMENT_EVENT_SECRET',
 'node scripts/check-release-ci-gate.cjs','npm test','npm run progress:check','npm run build',
 'npm run release:schema','wrangler deploy --dry-run','wrangler deploy',
 '/editor/','/api/site-updates','/api/admin/health',
 'node scripts/report-deployment.cjs succeeded','node scripts/report-deployment.cjs failed'
])assert(workflow.includes(text),'Release workflow missing: '+text);
assert(!/\n\s+push:|\n\s+schedule:|\n\s+pull_request:/.test(workflow),
 'Production deployment must not run automatically on push, schedule or PR');
const positions=[
 'node scripts/check-release-ci-gate.cjs','npm test','npm run progress:check',
 'npm run build','npm run release:schema','wrangler deploy --dry-run',
 'run: ./node_modules/.bin/wrangler deploy\n','Smoke-test public editor'
].map(x=>workflow.indexOf(x));
assert(positions.every(x=>x>=0),'Release verification stage missing');
assert(positions.every((x,i)=>i===0||x>positions[i-1]),
 'Every release check must be executed in order, before publishing');
assert(workflow.includes("steps.deploy.outcome == 'success'"));
assert(workflow.includes('steps.smoke.outcome'));
assert(workflow.includes('CLOUDFLARE_API_TOKEN')&&workflow.includes('CLOUDFLARE_ACCOUNT_ID'));
console.log('PASS: single manual release workflow, exact main SHA, CI, D1 backup/restore, schema, smoke and signed reporting');
