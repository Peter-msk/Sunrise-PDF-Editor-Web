'use strict';
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
// Extracted editor functions retain their real telemetry boundary. A sandbox
// without a telemetry client follows the same optional-client behavior as UI.
module.exports=function installEditorMetrics(context){
 const source=fs.readFileSync(path.resolve(__dirname,'../../src/editor/index.html'),'utf8');
 const start=source.indexOf('    function beginOperationMetric('),end=source.indexOf('\n    async function openPdfFromBytes(',start);
 if(start<0||end<=start)throw Error('Editor metrics boundary not found');
 if(!vm.isContext(context))vm.createContext(context);
 vm.runInContext(source.slice(start,end),context);
 return context;
};
