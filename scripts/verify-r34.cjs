'use strict';
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),cp=require('node:child_process');
const root=path.resolve(__dirname,'..');
const tests=[
 'r33-content-editing.cjs','r33-office-grids.cjs','r33-signature-integrity.cjs',
 'r34-form-transfer.cjs','r34-incremental-signatures.cjs','r34-nested-content.cjs',
 'r34-cmap-vertical.cjs','r34-multiple-tables.cjs','r34-mixed-word.cjs',
 'r34-annotation-appearance.cjs','r34-engine-roundtrip.cjs','r34-worker-encryption.cjs',
 'native-annotation-edit.cjs','embedded-image-extraction.cjs',
 'form-save-roundtrip.cjs','standalone-form-save-integrity.cjs',
 'r34-pki-container.cjs','outline-transfer.cjs','bookmark-hierarchy.cjs'
];
const selected=process.argv.includes('--new-only')?tests.filter(file=>/^r3[34]-/.test(file)):tests;
const results=[];
for(const file of ['sunrise-content-editor.js','sunrise-office-export.js','sunrise-pdf-form-tools.js','sunrise-pdf-cms.js','sunrise-pki.js','sunrise-embedded-images.js','sunrise-outline-transfer.js']){
 const run=cp.spawnSync(process.execPath,['--check',path.join(root,'src/assets',file)],{encoding:'utf8',timeout:30000});
 results.push({kind:'syntax',file:'src/assets/'+file,status:run.status===0?'PASS':'FAIL',output:run.stderr.trim()});
}
try{
 const html=fs.readFileSync(path.join(root,'src/editor/index.html'),'utf8'),start=html.indexOf('  <script>\n'),end=html.indexOf('  </script>',start);
 if(start<0||end<0)throw Error('Editor script boundaries missing');
 new vm.Script(html.slice(start+'  <script>\n'.length,end),{filename:'src/editor/index.html:inline'});
 results.push({kind:'syntax',file:'src/editor/index.html:inline',status:'PASS'});
}catch(error){results.push({kind:'syntax',file:'src/editor/index.html:inline',status:'FAIL',output:error.message});}
for(const file of selected){
 const run=cp.spawnSync(process.execPath,[path.join(root,'tests',file)],{cwd:root,encoding:'utf8',timeout:60000,maxBuffer:1024*1024});
 const status=run.status===0?'PASS':'FAIL',output=[run.stdout,run.stderr,run.error?.message].filter(Boolean).join('\n').trim();
 results.push({kind:'functional',file:'tests/'+file,status,exitCode:run.status,output});
 console.log(status+' '+file);if(status==='FAIL')console.error(output);
}
const failed=results.filter(r=>r.status!=='PASS').length;
const report={release:'R34-DEV1',checkedAt:new Date().toISOString(),scope:'Changed source and focused synthetic regressions only',
 syntax:{passed:results.filter(r=>r.kind==='syntax'&&r.status==='PASS').length,total:results.filter(r=>r.kind==='syntax').length},
 functional:{passed:results.filter(r=>r.kind==='functional'&&r.status==='PASS').length,total:selected.length},
 allRequestedFunctionalityComplete:false,build:'NOT_RUN',fullRegression:'NOT_RUN',browserAcceptance:'NOT_RUN',mobileAcceptance:'NOT_RUN',ci:'NOT_RUN',deployment:'NOT_RUN',results};
if(!process.argv.includes('--new-only'))fs.writeFileSync(path.join(root,'docs/R34_VALIDATION.json'),JSON.stringify(report,null,2)+'\n');
console.log('Syntax '+report.syntax.passed+'/'+report.syntax.total+'; functional groups '+report.functional.passed+'/'+report.functional.total);
process.exitCode=failed?1:0;
