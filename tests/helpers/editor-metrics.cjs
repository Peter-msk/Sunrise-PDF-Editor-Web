'use strict';
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
// Extracted editor functions retain their real telemetry boundary. A sandbox
// without a telemetry client follows the same optional-client behavior as UI.
module.exports=function installEditorMetrics(context){
 const source=fs.readFileSync(path.resolve(__dirname,'../../src/editor/index.html'),'utf8');
 const start=source.indexOf('    function beginOperationMetric('),end=source.indexOf('\n    async function openPdfFromBytes(',start);
 if(start<0||end<=start)throw Error('Editor metrics boundary not found');
 if(!vm.isContext(context))vm.createContext(context);
 // The real editor defines its safe diagnostic bridge immediately above the
 // metrics wrapper. Include it for isolated page-operation function tests.
 const diagnosticStart=source.indexOf('    function tracedOperationFailure('),diagnosticEnd=source.indexOf('    async function openPdfFile(',diagnosticStart);
 if(diagnosticStart>=0&&diagnosticEnd>diagnosticStart)vm.runInContext(source.slice(diagnosticStart,diagnosticEnd),context);
 vm.runInContext(source.slice(start,end),context);
 return context;
};
