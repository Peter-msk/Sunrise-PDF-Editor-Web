'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs');
const {REQUIRED,DATABASE,parseQueryResult,verifySchema}=require('../scripts/d1-schema-preflight.cjs');
const tables=Object.keys(REQUIRED),columns=Object.fromEntries(tables.map(n=>[n,['id',...REQUIRED[n]]]));
assert.equal(DATABASE,'sunrise-pdf-editor-web-contact');
const good=verifySchema(tables,columns);
assert.deepEqual(good,{ready:true,checkedTables:tables.length,
  checkedFields:Object.values(REQUIRED).reduce((n,x)=>n+x.length,0)});
assert.deepEqual(parseQueryResult(JSON.stringify([{success:true,results:[{name:'analytics_daily'}]}])),[{name:'analytics_daily'}]);
for(const raw of ['not json','[]','[{"success":false,"results":[]}]','[{"success":true,"results":{}}]','[{"success":true,"results":[]},{"success":true,"results":[]}]'])
 assert.throws(()=>parseQueryResult(raw),/D1 query/);
assert.throws(()=>verifySchema(tables.filter(n=>n!=='operation_deployments'),columns),/operation_deployments/);
assert.throws(()=>verifySchema(tables,{...columns,inquiries:['id']}),/inquiries.revision/);
assert.throws(()=>verifySchema(tables,{...columns,analytics_sessions:[]}),/analytics_sessions/);
assert.throws(()=>verifySchema(tables,{...columns,site_releases:null}),/site_releases/);
assert.throws(()=>verifySchema(null,columns),/table metadata/);
const src=fs.readFileSync('scripts/d1-schema-preflight.cjs','utf8');
assert(src.includes('--remote')&&src.includes('--json'));
assert(src.includes("SELECT name FROM sqlite_master")&&src.includes('PRAGMA table_info('));
assert(!/--file|\b(?:DELETE|UPDATE|INSERT|DROP|ALTER|CREATE)\b/.test(src),'preflight must never mutate remote D1');
console.log('PASS: release D1 metadata gate rejects missing tables/fields and malformed read-only responses');
