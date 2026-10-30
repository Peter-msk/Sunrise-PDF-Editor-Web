const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const html=fs.readFileSync('src/editor/index.html','utf8');
const a=html.indexOf('    let pageJumpDraftDoc = null;'),b=html.indexOf('    function updateCommandStates()',a);assert(a>=0&&b>a);
const doc={currentPage:0,pageCount:100,selectedPages:new Set([0])},other={currentPage:7,pageCount:10};
const input={value:'1',focus(){}}, warnings=[];let renders=0;
const ctx=vm.createContext({doc,other,input,Set,showToast:v=>warnings.push(v),isMobileViewport:()=>false,toggleLeftPane:()=>{},renderCurrentPageCanvas:()=>renders++,renderLeftPane:()=>{}});
vm.runInContext(html.slice(a,b),ctx);
vm.runInContext('pageJumpDraftDoc=doc; input.value="35"; doc.currentPage=1; syncPageJumpInput(doc,input)',ctx);assert.equal(input.value,'35');
assert.equal(vm.runInContext('applyPageJump(doc,input)',ctx),true);assert.equal(doc.currentPage,34);assert.deepEqual([...doc.selectedPages],[34]);assert.equal(renders,1);
for(const value of ['','0','101','1.5','1e2','99999999999999999999']){input.value=value;assert.equal(vm.runInContext('applyPageJump(doc,input)',ctx),false);assert.equal(doc.currentPage,34)}
vm.runInContext('pageJumpDraftDoc=doc; input.value="90"; syncPageJumpInput(other,input)',ctx);assert.equal(input.value,'8');
console.log('PASS: in-progress page jump survives render; validates integer and document changes');
