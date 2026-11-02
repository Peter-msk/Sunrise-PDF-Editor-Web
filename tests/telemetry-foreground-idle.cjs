'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
(async()=>{
 let elapsed=0,focused=true,interval;
 const origin=Date.parse('2026-10-31T03:00:00Z'),events=[],docListeners={},windowListeners={};
 class Clock extends Date{static now(){return origin+elapsed}}
 const document={visibilityState:'visible',hasFocus:()=>focused,getElementById:()=>null,addEventListener(type,fn){docListeners[type]=fn}};
 const context={location:{pathname:'/editor/'},sessionStorage:{getItem:()=>null,setItem(){}},crypto:{randomUUID:()=> '123e4567-e89b-42d3-a456-426614174000'},document,window:{addEventListener(type,fn){windowListeners[type]=fn}},performance:{now:()=>elapsed},Date:Clock,AbortController,Promise,setInterval(fn){interval=fn},setTimeout(){return 1},clearTimeout(){},fetch:async(_url,opts)=>{events.push(JSON.parse(opts.body));return {ok:true}}};
 vm.runInNewContext(fs.readFileSync('dist/assets/sunrise-telemetry.js','utf8'),context);
 await new Promise(resolve=>setImmediate(resolve));
 elapsed=5000;focused=false;document.visibilityState='hidden';docListeners.visibilitychange();windowListeners.blur();
 elapsed=15000;await interval();
 assert.equal(events.filter(e=>e.type==='pulse').at(-1).seconds,5,'five foreground seconds before blur');
 elapsed=29000;focused=true;document.visibilityState='visible';docListeners.visibilitychange();windowListeners.focus();
 elapsed=30000;await interval();
 assert.equal(events.filter(e=>e.type==='pulse').at(-1).seconds,1,'refocus must not credit fourteen hidden seconds');
 for(elapsed=45000;elapsed<=135000;elapsed+=15000)await interval();
 assert.equal(events.filter(e=>e.type==='pulse').reduce((n,e)=>n+e.seconds,0),96,'stop exactly at two minutes since last input');
 elapsed=135000;docListeners.keydown();elapsed=150000;await interval();
 assert.equal(events.filter(e=>e.type==='pulse').reduce((n,e)=>n+e.seconds,0),111,'new input must not backfill idle time');
 const before=events.filter(e=>e.type==='pulse').length;
 elapsed=210000;await interval();assert.equal(events.filter(e=>e.type==='pulse').length,before,'discard a suspended sampling interval');
 assert(events.every(e=>Object.keys(e).every(k=>['type','session','area','seconds'].includes(k))));
 console.log('PASS: foreground segments, focus boundaries, two-minute idle cutoff, resumed input and suspended timer');
})().catch(error=>{console.error(error);process.exitCode=1});
