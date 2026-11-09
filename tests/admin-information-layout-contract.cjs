'use strict';
// Layout-only contract: no private D1, network, credentials or browser runtime needed.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const html=fs.readFileSync('dist/admin/index.html','utf8');
for(const id of ['adminPageEyebrow','adminMenuToggle','adminPageTitle','adminHealthWorkerBrief','adminHealthDatabaseBrief','visitsToday','unread','inProgress','errorCount','healthWorker','healthDatabase','diagnosticTitle','qualityTitle','operationDays','operationQualityRows','inquiryRows','publicationForm','sessionsRevoke']){
  assert(html.includes(`id="${id}"`),'Critical admin element missing: '+id);
}
for(const page of ['overview','usage','errors','inquiries','publications','system','security'])
  assert(html.includes(`data-admin-link="${page}"`),'Missing navigation page: '+page);
const script=html.match(/<script>\s*([\s\S]*?)<\/script>/);
assert(script,'Missing admin workspace script');
new vm.Script(script[1],{filename:'admin-client-navigation.js'});
for(const code of [
  'admin-overview-grid','admin-primary-metrics','admin-secondary-metrics','admin-alerts-zone',
  'admin-diagnostic-panel','admin-quality-summary','admin-session-panel','admin-operation-panel',
  'admin-quick-actions','admin-danger-action','admin-export-row','admin-health-brief',
  'new MutationObserver(sync).observe(source','new MutationObserver(sync).observe(from',
  'Number.isFinite(count)&&count>0','history.pushState','aria-current',
  'position:sticky','max-height:520px','@media(max-width:760px)','@media(max-width:540px)',
])assert(html.includes(code),'Admin UI contract missing: '+code);
const routeBinds=html.match(/data-admin-shortcut/g)||[];
assert(routeBinds.length>=2,'Overview quick actions absent');
assert(html.includes("const priorityIDs=['unread','inProgress','errorCount','visitsToday','secondsToday','visitsWeek']"),'Critical metrics must appear first');
assert(html.includes('root.insertBefore(diagnosticPanel,qualityPanel)'),'Most actionable diagnostics must appear first');
// A visual-only improvement may not introduce new network endpoints, cookie storage or shadow KPI source.
assert(!/fetch\(['"]https?:\/\//.test(script[1]),'Navigation must not make external requests');
assert(!script[1].includes('cloneNode('),'Duplicate KPI nodes risk inconsistent figures');
console.log('PASS: seven-view information hierarchy, six priority KPIs, live Worker/D1 mirrors, conditional severity, keyboard/mobile responsive contract');
