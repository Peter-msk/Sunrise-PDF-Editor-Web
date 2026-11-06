'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs');
const office=require('../src/assets/sunrise-office-export.js'),images=require('../src/assets/sunrise-embedded-images.js');
const png=Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jY3cAAAAASUVORK5CYII=','base64'));
const text=(str,x,y)=>({str,width:50,fontName:'F1',dir:'ltr',transform:[12,0,0,12,x,y]});
async function main(){
 const rules={horizontal:[100,200].map(at=>({at,from:20,to:200})),vertical:[20,110,200].map(at=>({at,from:100,to:200}))};
 const page={width:400,height:600,rotation:0,styles:{F1:{fontFamily:'sans-serif'}},items:[text('TITLE',20,550),text('CELL_A',30,150),text('CELL_B',120,150),text('FOOTER',20,50)],images:[{png,x:240,y:300,width:100,height:100}]};
 const bytes=office.docxMixed([page],[rules]),contents=Buffer.from(bytes).toString('utf8');
 assert(contents.includes('wps:txbx'));assert(contents.includes('word/media/image1.png'));assert(contents.includes('<w:tbl>'));assert(contents.includes('w:tblpPr'));
 for(const value of ['TITLE','CELL_A','CELL_B','FOOTER'])assert.equal((contents.match(new RegExp(value,'g'))||[]).length,1,'each text fragment stays editable exactly once');
 assert(!contents.includes('word/media/page1.png'));
 const OPS={save:1,restore:2,transform:3,paintImageXObject:4,clip:5,eoClip:6,paintInlineImageXObject:7};
 const raster={width:1,height:1,kind:2,data:Uint8Array.of(255,0,0)};
 const createCanvas=()=>({getContext:()=>({createImageData:()=>({data:new Uint8ClampedArray(4)}),putImageData:()=>{}}),toBlob:cb=>cb({size:png.length,arrayBuffer:async()=>png.buffer})});
 const pdfPage={getOperatorList:async()=>({fnArray:[1,3,4,2,1,3,4,2],argsArray:[[],[100,0,0,80,20,30],['Im'],[],[],[40,0,0,60,200,50],['Im'],[]]}),objs:{has:()=>true,get:()=>raster}};
 const placements=await images.placements(pdfPage,{OPS,createCanvas});assert.equal(placements.length,2);assert.equal(placements[0].x,20);assert.equal(placements[0].y,30);assert.equal(placements[1].width,40);
 await assert.rejects(images.placements({...pdfPage,getOperatorList:async()=>({fnArray:[1,5,4,2],argsArray:[[],[],['Im'],[]]})},{OPS,createCanvas}),/잘림/);
 await assert.rejects(images.placements(pdfPage,{OPS,createCanvas,cancelled:()=>true}),/취소/);
 // Inspect the generated package with an independent ZIP/XML parser.
 const cp=require('node:child_process'),path=require('node:path'),os=require('node:os');const dir=fs.mkdtempSync(path.join(os.tmpdir(),'sunrise-mixed-'));
 try{const file=path.join(dir,'mixed.docx');fs.writeFileSync(file,bytes);cp.execFileSync(process.env.SUNRISE_PYTHON||'python3',['-c','import sys,zipfile,xml.etree.ElementTree as ET\nwith zipfile.ZipFile(sys.argv[1]) as z:\n for name in z.namelist():\n  if name.endswith((".xml",".rels")): ET.fromstring(z.read(name))\n assert z.testzip() is None',file],{stdio:'pipe'});}finally{fs.rmSync(dir,{recursive:true,force:true});}
 const html=fs.readFileSync('src/editor/index.html','utf8');assert(html.includes('case "exportWordMixed":'));assert(html.includes('SunriseEmbeddedImages.placements(page'));
 console.log('R34 mixed Word: editable text and cells, individually placed image objects, ZIP/XML parsing, clipping rejection and cancellation passed');
}
main().catch(e=>{console.error(e);process.exitCode=1;});
