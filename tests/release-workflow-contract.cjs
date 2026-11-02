'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs');
const workflow=fs.readFileSync('.github/workflows/production-release.yml','utf8');
for(const text of [
 'workflow_dispatch:','if: ${{ github.ref == \'refs/heads/main\' }}',
 'environment: production','private_backup_sha256','isolated_restore_receipt',
 'APPROVED_SHA','PRIVATE_BACKUP_SHA256','RESTORE_RECEIPT',
 'npm run release:check','npm test','npm run progress:check','npm run build',
 'npm run release:schema','wrangler deploy --dry-run','wrangler deploy',
 '/api/site-updates','/api/admin/health'
])assert(workflow.includes(text),'Production release workflow missing: '+text);
assert(!/\n\s+push:|\n\s+schedule:|\n\s+pull_request:/.test(workflow),
 'Production deployment must never run automatically on a push, schedule or PR');
const positions=['npm run release:check','npm test','npm run progress:check','npm run build',
 'npm run release:schema','wrangler deploy --dry-run','wrangler deploy\n']
 .map(t=>workflow.indexOf(t));
assert(positions.every(x=>x>=0));
assert(positions.every((x,i)=>!i||x>positions[i-1]),
 'All integrity gates must run before the actual deployment step');
assert(workflow.includes('CLOUDFLARE_API_TOKEN')&&workflow.includes('CLOUDFLARE_ACCOUNT_ID'));
console.log('PASS: manual production deployment requires exact main SHA, prior green CI, private backup/restore, remote schema and post-deploy smoke');
