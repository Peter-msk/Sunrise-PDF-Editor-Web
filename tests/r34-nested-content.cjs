'use strict';
const assert=require('node:assert/strict');
const lib=require('../dist/assets/pdf-lib/pdf-lib.min.js');
const core=require('../src/assets/sunrise-content-editor.js');
const n=lib.PDFName.of;
async function main(){
 const pdf=await lib.PDFDocument.create(),font=await pdf.embedFont(lib.StandardFonts.Helvetica),ctx=pdf.context;
 const inner=ctx.register(ctx.flateStream('BT /F1 12 Tf 1 0 0 1 10 30 Tm (NESTED) Tj ET\n0 0 50 40 re S',{Type:'XObject',Subtype:'Form',BBox:[0,0,100,100],Resources:{Font:{F1:font.ref}}}));
 const outer=ctx.register(ctx.flateStream('/Inner Do',{Type:'XObject',Subtype:'Form',BBox:[0,0,100,100],Resources:{XObject:{Inner:inner}}}));
 for(let i=0;i<2;i++){
  const page=pdf.addPage([400,600]);page.node.set(n('Resources'),ctx.obj({XObject:{Outer:outer}}));
  page.node.set(n('Contents'),ctx.register(ctx.flateStream('q 1 0 0 1 10 400 cm /Outer Do Q\nq 1 0 0 1 200 400 cm /Outer Do Q')));
 }
 const bytes=await pdf.save(),original=bytes.slice();const records=await core.listText({bytes,pageNumber:1,PDFLib:lib});
 assert.equal(records.length,2);assert(records.every(r=>r.original==='NESTED'&&r.id.startsWith('form:')));
 const changed=await core.replaceText({bytes,pageNumber:1,targetId:records[0].id,original:'NESTED',replacement:'EDITED',PDFLib:lib});
 assert.deepEqual(bytes,original);
 assert.deepEqual((await core.listText({bytes:changed.bytes,pageNumber:1,PDFLib:lib})).map(r=>r.original),['EDITED','NESTED']);
 assert.deepEqual((await core.listText({bytes:changed.bytes,pageNumber:2,PDFLib:lib})).map(r=>r.original),['NESTED','NESTED']);
 const paths=await core.listVectorPaths({bytes,pageNumber:1,PDFLib:lib});assert.equal(paths.length,2);
 const moved=await core.replaceVectorPath({bytes,pageNumber:1,targetId:paths[0].id,steps:paths[0].steps.map(s=>({...s,values:s.values.map((v,i)=>i===0?v+5:v)})),strokeColor:'#FF0000',PDFLib:lib});
 const after=await core.listVectorPaths({bytes:moved.bytes,pageNumber:1,PDFLib:lib});
 assert.equal(after[0].steps[0].values[0],5);assert.equal(after[1].steps[0].values[0],0);
 const rectangles=await core.listRectangles({bytes,pageNumber:1,PDFLib:lib});assert.equal(rectangles.length,2);
 const rect=await core.replaceRectangle({bytes,pageNumber:1,targetId:rectangles[0].id,x:5,y:6,width:70,height:80,PDFLib:lib});
 assert.equal((await core.listRectangles({bytes:rect.bytes,pageNumber:1,PDFLib:lib}))[1].x,0);

 const clipping=await lib.PDFDocument.create(),clipPage=clipping.addPage([400,600]);
 clipPage.node.set(n('Contents'),clipping.context.register(clipping.context.flateStream('q 0 0 100 100 re W n\n0 0 300 300 re f Q')));
 const clipBytes=await clipping.save(),clips=await core.listVectorPaths({bytes:clipBytes,pageNumber:1,PDFLib:lib});
 assert.equal(clips[0].clip,'W');
 const newClip=await core.replaceVectorPath({bytes:clipBytes,pageNumber:1,targetId:clips[0].id,steps:[{operator:'re',values:[1,2,80,90]}],PDFLib:lib});
 const clipResult=await core.listVectorPaths({bytes:newClip.bytes,pageNumber:1,PDFLib:lib});assert.equal(clipResult[0].clip,'W');assert.equal(clipResult[0].steps[0].values[2],80);
 await assert.rejects(core.replaceVectorPath({bytes:clipBytes,pageNumber:1,targetId:clips[0].id,steps:clips[0].steps,lineWidth:2,PDFLib:lib}),/클리핑/);
 console.log('R34 nested Form editing: text/path/rectangle, repeated invocation and other-page isolation passed');
}
main().catch(e=>{console.error(e);process.exitCode=1;});
