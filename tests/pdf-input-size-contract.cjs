const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const src=fs.readFileSync('src/editor/index.html','utf8');
const section=(a,b)=>{const i=src.indexOf(a),j=src.indexOf(b,i);assert(i>=0&&j>i,a);return src.slice(i,j)};
const handlers={},notices=[],opened=[],state={mergeQueue:[],mergeSelectedIdx:-1};let reads=0;
const elements={};
const element=id=>elements[id] ||= {classList:{contains:()=>false},addEventListener(type,fn){handlers[id+':'+type]=fn}};
const context=vm.createContext({Uint8Array,Number,Math,Date,Set,Array,console,document:{getElementById:element},
 window:{PDFLib:{PDFDocument:{}},addEventListener(type,fn){handlers['window:'+type]=fn}},state,
 activeDoc:()=>({bytes:new Uint8Array([1]),currentPage:0}),
 showToast:s=>notices.push(s),openPdfFromBytes:async(name,bytes)=>opened.push({name,bytes}),
 parsePageCountAndMeta:async()=>({pageCount:1,pdfJsDoc:{destroy:async()=>{}}}),renderMergeQueueList(){}});
vm.runInContext(
 section('    function validatePdfByteLength(', '    async function openPdfFromBytes(')+
 section('    async function addFilesToMergeQueue(', '    async function executePdfMergeFromModal(')+
 section('      document.getElementById("openPdfInput").addEventListener', '      document.getElementById("imageToPdfInput")')+
 section('      // Global Drag & Drop PDF onto workspace', '      // Mobile & Touch'),context);

(async()=>{
 assert.doesNotThrow(()=>vm.runInContext('validatePdfByteLength(50*1024*1024)',context));
 assert.throws(()=>vm.runInContext('validatePdfByteLength(50*1024*1024+1)',context),/50MB/);
 const oversized={name:'large.pdf',size:50*1024*1024+1,arrayBuffer:async()=>{reads++;return new Uint8Array([1])}};
 const valid={name:'small.pdf',size:8,arrayBuffer:async()=>{reads++;return new Uint8Array([37,80,68,70,45,49,46,55])}};
 let event={target:{files:[oversized,valid],value:'selection'}};
 await handlers['openPdfInput:change'](event);
 assert.equal(reads,1);assert.deepEqual(opened.map(x=>x.name),['small.pdf']);assert.equal(event.target.value,'');
 await vm.runInContext('addFilesToMergeQueue([oversized,valid])',vm.createContext({...context,oversized,valid}));
 assert.equal(reads,2);assert.equal(state.mergeQueue.length,1);
 event={target:{files:[oversized],value:'selection'}};
 await handlers['insertPdfInput:change'](event);assert.equal(reads,2);assert.equal(event.target.value,'');
 let prevented=false;await handlers['window:drop']({dataTransfer:{files:[oversized,valid]},preventDefault(){prevented=true}});
 assert(prevented);assert.equal(reads,3);assert.deepEqual(opened.map(x=>x.name),['small.pdf','small.pdf']);
 assert(notices.filter(x=>x.includes('50MB')).length>=4);
 console.log('PASS: open, merge, insert and drop reject oversized PDF before reading; other files continue');
})().catch(e=>{console.error(e);process.exitCode=1});
