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
 // No arbitrary 50 MB limit. Reject invalid metadata or mismatched bytes
 // without making a false claim that large but valid PDFs are unsupported.
 assert.doesNotThrow(()=>vm.runInContext('validatePdfByteLength(50*1024*1024+1)',context));
 assert.doesNotThrow(()=>vm.runInContext('validatePdfByteLength(512*1024*1024)',context));
 for(const expression of ['-1','Number.MAX_SAFE_INTEGER+1','NaN','1.5']){
  assert.throws(()=>vm.runInContext('validatePdfByteLength('+expression+')',context),/크기 정보/);
 }
 const invalid={name:'invalid-size.pdf',size:Number.MAX_SAFE_INTEGER+1,arrayBuffer:async()=>{reads++;return new Uint8Array([1])}};
 const inconsistent={name:'mismatch.pdf',size:50*1024*1024+1,arrayBuffer:async()=>{reads++;return new Uint8Array([1])}};
 const valid={name:'small.pdf',size:8,arrayBuffer:async()=>{reads++;return new Uint8Array([37,80,68,70,45,49,46,55])}};
 let event={target:{files:[invalid,inconsistent,valid],value:'selection'}};
 await handlers['openPdfInput:change'](event);
 assert.equal(reads,2,'unsafe length rejected before read; mismatch detected after read');
 assert.deepEqual(opened.map(x=>x.name),['small.pdf']);assert.equal(event.target.value,'');
 await vm.runInContext('addFilesToMergeQueue([invalid,inconsistent,valid])',vm.createContext({...context,invalid,inconsistent,valid}));
 assert.equal(reads,4);assert.equal(state.mergeQueue.length,1);
 event={target:{files:[invalid],value:'selection'}};
 await handlers['insertPdfInput:change'](event);assert.equal(reads,4);assert.equal(event.target.value,'');
 let prevented=false;await handlers['window:drop']({dataTransfer:{files:[invalid,inconsistent,valid]},preventDefault(){prevented=true}});
 assert(prevented);assert.equal(reads,6);
 assert.deepEqual(opened.map(x=>x.name),['small.pdf','small.pdf']);
 assert(notices.filter(x=>x.includes('크기 정보를 확인')).length>=4,'unsafe file metadata must be rejected');
 assert(notices.filter(x=>x.includes('읽은 크기가 원본과 일치하지')).length>=3,'partial reads must be rejected');
 console.log('PASS: valid large PDF metadata allowed; unsafe sizes rejected before read; partial reads blocked in open, merge, insert and drop');
})().catch(e=>{console.error(e);process.exitCode=1});
