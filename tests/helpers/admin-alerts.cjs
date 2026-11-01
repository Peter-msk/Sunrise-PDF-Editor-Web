'use strict';
const assert=require('node:assert/strict'),vm=require('node:vm');
module.exports=function checkAlertRendering(html){
 const code=html.match(/^function renderOperationAlerts\(\)\{[\s\S]*?^\}/m)?.[0];
 assert(code,'Administrator alert rendering entry point is required');
 const rows=[],root={replaceChildren(){rows.length=0},append(node){rows.push(node)}},count={textContent:''};
 const context={healthAlerts:['중복','서비스'],qualityAlerts:['중복','품질'],operationAlerts:['문의'],deploymentAlerts:['배포'],maintenanceAlerts:['중복','보존'],
  $:id=>id==='operationAlerts'?root:count,document:{createElement(){const node={textContent:''};Object.defineProperty(node,'innerHTML',{set(){throw Error('Unsafe HTML alert rendering')}});return node}}};
 vm.createContext(context);vm.runInContext(code+'\nrenderOperationAlerts();',context);
 assert.deepEqual(rows.map(x=>x.textContent),['중복','서비스','품질','문의','배포','보존']);assert.equal(count.textContent,'6');
 const untrusted='<img src=x onerror=alert(1)>';
 for(const key of ['healthAlerts','qualityAlerts','operationAlerts','deploymentAlerts','maintenanceAlerts'])context[key]=[];
 context.maintenanceAlerts=[untrusted];vm.runInContext('renderOperationAlerts()',context);
 assert.deepEqual(rows.map(x=>x.textContent),[untrusted],'alert content must remain text');
 context.maintenanceAlerts=[];vm.runInContext('renderOperationAlerts()',context);assert.equal(count.textContent,'0');assert.equal(rows.length,1);
};
