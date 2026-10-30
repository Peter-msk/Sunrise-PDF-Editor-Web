const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),P=require('../dist/assets/pdf-lib/pdf-lib.min.js');
const s=fs.readFileSync('src/editor/index.html','utf8'),a=s.indexOf('    function renamePdfOutline('),b=s.indexOf('    async function renameExistingBookmark(',a);assert(a>=0&&b>a);
const n=P.PDFName.of,ctx=vm.createContext({window:{PDFLib:P}});vm.runInContext(s.slice(a,b),ctx);
async function fixture(kind){const pdf=await P.PDFDocument.create();for(let i=0;i<3;i++)pdf.addPage();const c=pdf.context;
 const root=c.obj({Type:'Outlines'}),rr=c.register(root);pdf.catalog.set(n('Outlines'),rr);
 const first=c.obj({S:'GoTo',D:[pdf.getPage(0).ref,n('Fit')]}),fr=c.register(first);
 const next=c.obj({S:kind==='mixed'?'URI':'GoTo',D:[pdf.getPage(1).ref,n('Fit')]}),nr=c.register(next);
 first.set(n('Next'),kind==='array'?c.obj([nr]):nr);if(kind==='cycle')next.set(n('Next'),fr);
 const one=c.obj({Title:P.PDFHexString.fromText('선택'),Parent:rr,A:fr}),oneRef=c.register(one);
 const two=c.obj({Title:P.PDFHexString.fromText('공유'),Parent:rr,A:fr,Prev:oneRef}),twoRef=c.register(two);
 one.set(n('Next'),twoRef);root.set(n('First'),oneRef);root.set(n('Last'),twoRef);root.set(n('Count'),P.PDFNumber.of(2));
 return {pdf,first,next,one,two,fr,nr,rows:[{path:[0],titles:['선택']},{path:[1],titles:['공유']}]};}
function change(f){ctx.pdf=f.pdf;ctx.rows=f.rows;return vm.runInContext("renamePdfOutline(pdf,[0],['선택'],'',rows,false,2)",ctx)}
(async()=>{for(const type of ['linear','array']){const f=await fixture(type);change(f);let altered=f.one.lookup(n('A'));assert.equal(altered.lookup(n('D')).get(0).toString(),f.pdf.getPage(2).ref.toString());assert.equal(f.first.lookup(n('D')).get(0).toString(),f.pdf.getPage(0).ref.toString());assert.equal(f.two.lookup(n('A')).lookup(n('D')).get(0).toString(),f.pdf.getPage(0).ref.toString());assert.equal(f.next.lookup(n('D')).get(0).toString(),f.pdf.getPage(1).ref.toString());assert.equal(altered.get(n('Next')).toString(),f.first.get(n('Next')).toString());
 const out=await P.PDFDocument.load(await f.pdf.save()),r=out.catalog.lookup(n('Outlines')),item=out.context.lookup(r.get(n('First')));assert.equal(item.lookup(n('A')).lookup(n('D')).get(0).toString(),out.getPage(2).ref.toString());}
 for(const type of ['linear','array']) {const f=await fixture(type);ctx.pdf=f.pdf;ctx.rows=f.rows;
 vm.runInContext("renamePdfOutline(pdf,[0],['선택'],'',rows,false,2,1)",ctx);
 const changedRoot=f.one.lookup(n('A')),raw=changedRoot.lookup(n('Next')),changedNext=type==='array'?raw.lookup(0):raw;
 assert.equal(changedRoot.lookup(n('D')).get(0).toString(),f.pdf.getPage(0).ref.toString());
 assert.equal(changedNext.lookup(n('D')).get(0).toString(),f.pdf.getPage(2).ref.toString());
 assert.equal(f.next.lookup(n('D')).get(0).toString(),f.pdf.getPage(1).ref.toString());
 assert.equal(f.two.lookup(n('A')).get(n('Next')).toString(),f.first.get(n('Next')).toString());
 const check=await P.PDFDocument.load(await f.pdf.save()),root=check.catalog.lookup(n('Outlines')),one=check.context.lookup(root.get(n('First'))),next=one.lookup(n('A')).lookup(n('Next'));
 assert.equal((type==='array'?next.lookup(0):next).lookup(n('D')).get(0).toString(),check.getPage(2).ref.toString());
 assert.throws(()=>vm.runInContext("renamePdfOutline(pdf,[0],['선택'],'',rows,false,2,5)",ctx),/순번/);
 }
 for(const type of ['mixed','cycle']){const f=await fixture(type);assert.throws(()=>change(f),/변경|수정/);assert.equal(f.one.get(n('A')).toString(),f.fr.toString());assert.equal(f.first.lookup(n('D')).get(0).toString(),f.pdf.getPage(0).ref.toString());}
 console.log('PASS: GoTo chain destination editing, shared action isolation, next actions preserved, mixed/cyclic rejection');})().catch(e=>{console.error(e);process.exitCode=1});
