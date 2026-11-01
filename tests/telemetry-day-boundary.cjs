const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');

(async()=>{
  const source=fs.readFileSync('dist/assets/sunrise-telemetry.js','utf8');
  const events=[],listeners={};let wall=Date.parse('2026-10-30T14:59:50Z'),elapsed=0,tick;
  class Clock extends Date {static now(){return wall}}
  const context={
    location:{pathname:'/editor/'},sessionStorage:{getItem:()=>null,setItem(){}},
    crypto:{randomUUID:()=> '123e4567-e89b-42d3-a456-426614174000'},
    document:{visibilityState:'visible',hasFocus:()=>true,addEventListener(){},getElementById:()=>null},
    window:{addEventListener(type,handler){listeners[type]=handler}},
    performance:{now:()=>elapsed},Date:Clock,AbortController,Promise,
    fetch:async(_url,opts)=>{events.push(JSON.parse(opts.body));return {ok:true}},
    setInterval(fn){tick=fn},setTimeout(){return 1},clearTimeout(){}
  };
  vm.runInNewContext(source,context);
  assert.equal(events[0].type,'visit');
  await new Promise(resolve=>setImmediate(resolve));
  wall+=15000;elapsed+=15000;
  await tick();
  assert.deepEqual(events.map(x=>x.type),['visit','visit','pulse']);
  assert.equal(events[2].seconds,5,'only the five foreground seconds after KST midnight belong to the new day');
  wall+=15000;elapsed+=15000;
  await tick();
  assert.deepEqual(events.map(x=>x.type),['visit','visit','pulse','pulse']);
  assert.equal(events.filter(x=>x.type==='visit').length,2,'same tab registers once per KST day');
  assert(events.every(x=>!JSON.stringify(x).includes('filename')));
  console.log('PASS: an editor tab crossing KST midnight registers the next day before sending usage');
})().catch(e=>{console.error(e);process.exitCode=1});
