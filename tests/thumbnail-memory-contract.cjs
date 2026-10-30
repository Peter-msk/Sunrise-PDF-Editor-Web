const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const src=fs.readFileSync('src/editor/index.html','utf8');
const a=src.indexOf('        const thumbReader = doc.pdfJsDoc;'),b=src.indexOf('        for (let i = 0; i < doc.pageCount; i++) {',a);assert(a>=0&&b>a);
let callback, release;const gate=new Promise(r=>release=r);
const canvas={width:1,height:1,isConnected:true,getContext:()=>({drawImage(){}})};
const card={dataset:{pageIndex:'0'},isConnected:true,querySelector:()=>canvas};
let waiting=false, observed=0;const page={getViewport:()=>({width:100,height:150}),render:()=>({promise:waiting?gate:Promise.resolve()})};
const doc={pdfJsDoc:{getPage:async()=>page}};
class IntersectionObserver {constructor(cb){callback=cb} observe(){observed++} unobserve(){}}
const ctx=vm.createContext({doc,IntersectionObserver,container:{},document:{createElement:()=>({getContext:()=>({})})},console});
vm.runInContext('let thumbObserver;\n'+src.slice(a,b),ctx);
const flush=()=>new Promise(r=>setImmediate(r));
(async()=>{
 callback([{target:card,isIntersecting:true}]);await flush();assert.equal(canvas.width,100);assert.equal(card.dataset.rendered,'1');
 callback([{target:card,isIntersecting:false}]);assert.equal(canvas.width,1);assert.equal(card.dataset.rendered,undefined);
 waiting=true;callback([{target:card,isIntersecting:true}]);await flush();callback([{target:card,isIntersecting:false}]);release();await flush();assert.equal(canvas.width,1);assert.equal(card.dataset.rendered,undefined);
 waiting=false;callback([{target:card,isIntersecting:true}]);await flush();assert.equal(canvas.width,100);assert.equal(card.dataset.rendered,'1');
 console.log('PASS: offscreen thumbnail release, in-flight render and recovery');
})().catch(e=>{console.error(e);process.exitCode=1});
