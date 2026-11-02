const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require('node:path').join(__dirname, '../src/editor/index.html'), 'utf8');
function slice(start, end) { const a=source.indexOf(start),b=source.indexOf(end,a); assert(a>=0&&b>a); return source.slice(a,b); }
const stage={classList:{remove(){}},getBoundingClientRect:()=>({left:100,top:200})};
const hint={style:{}}; let snapshots=0, renders=0;
const doc={currentPage:0,pageSizes:[{width:400,height:600}],zoom:2,overlays:[],selectedPages:new Set([0])};
const ctx=vm.createContext({Math,Set,state:{pendingPlacement:null,selectedInsertId:null},activeDoc:()=>doc,
 document:{getElementById:id=>id==='pageStage'?stage:hint},saveUndoSnapshot:()=>snapshots++,renderOverlayItems:()=>renders++,renderLeftPane:()=>{},updateCommandStates:()=>{},showToast:()=>{}});
vm.runInContext('let overlayIdCounter=1;\n'+slice('    function cancelPlacement()', '    // Event Listeners & File Input Wiring'),require('./helpers/editor-metrics.cjs')(ctx));
ctx.state.pendingPlacement={doc,type:'Text',title:'텍스트 삽입',text:'한글',fontSize:14,color:'#000000',bg:'transparent'};
ctx.event={clientX:300,clientY:500};
vm.runInContext('placePendingItem(event)',require('./helpers/editor-metrics.cjs')(ctx));
assert.equal(doc.overlays.length,1);assert.equal(doc.overlays[0].x,100);assert.equal(doc.overlays[0].y,150);assert.equal(snapshots,1);assert.equal(renders,1);assert.equal(ctx.state.pendingPlacement,null);
ctx.state.pendingPlacement={doc};vm.runInContext('cancelPlacement()',require('./helpers/editor-metrics.cjs')(ctx));assert.equal(snapshots,1);assert.equal(ctx.state.pendingPlacement,null);
let now=1000; class FakeDate extends Date { static now(){return now;} }
const events={};let navigation=[];
const viewport={scrollHeight:100,clientHeight:100,scrollWidth:100,clientWidth:100,scrollTop:0,scrollLeft:0,addEventListener:(name,fn)=>events[name]=fn};
const select={addEventListener(){}};
const touchCtx=vm.createContext({Date:FakeDate,Math,state:{viewMode:'single'},document:{getElementById:id=>id==='canvasViewport'?viewport:select},requestAnimationFrame:()=>1,syncPageFromScroll:()=>{},navigatePageByDelta:async n=>navigation.push(n),activeDoc:()=>({pageCount:3})});
vm.runInContext(slice('      let swipeTouchState = null;', '      // Capture placement before item dragging'),touchCtx);
const target={closest:()=>null};const t=(x,y)=>({clientX:x,clientY:y});
(async()=>{
 events.touchstart({touches:[t(10,100)],target});await events.touchend({touches:[],changedTouches:[t(10,20)]});assert.deepEqual(navigation,[1]);
 now+=500;events.touchstart({touches:[t(10,100)],target});events.touchstart({touches:[t(10,100),t(30,100)],target});
 await events.touchend({touches:[t(10,100)],changedTouches:[t(30,20)]});now+=50;await events.touchend({touches:[],changedTouches:[t(10,20)]});
 now+=100;events.touchstart({touches:[t(10,100)],target});await events.touchend({touches:[],changedTouches:[t(10,20)]});assert.deepEqual(navigation,[1]);
 now+=400;events.touchstart({touches:[t(10,100)],target});await events.touchend({touches:[],changedTouches:[t(10,20)]});assert.deepEqual(navigation,[1,1]);
 console.log('PASS: click placement coordinates/cancellation and pinch swipe guard');
})().catch(error=>{console.error(error);process.exit(1)});

