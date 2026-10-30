// Optional preview-only QA assets. Never runs in the production build command.
const fs=require('node:fs'),lib=require('../dist/assets/pdf-lib/pdf-lib.min.js');
(async()=>{
 const pdf=await lib.PDFDocument.create(),page=pdf.addPage([600,800]),n=lib.PDFName.of;
 const data=new Uint8Array(1200*900*3);let seed=9;
 for(let i=0;i<data.length;i++){seed=(Math.imul(seed,1664525)+1013904223)>>>0;data[i]=80+(seed>>>24)%120;}
 const image=pdf.context.register(pdf.context.stream(data,{Type:'XObject',Subtype:'Image',Width:1200,Height:900,ColorSpace:'DeviceRGB',BitsPerComponent:8}));
 page.node.set(n('Resources'),pdf.context.obj({XObject:{Photo:image}}));
 page.node.set(n('Contents'),pdf.context.register(pdf.context.flateStream('q 550 0 0 412.5 25 200 cm /Photo Do Q')));
 page.drawText('SEARCHABLE COMPRESSION QA',{x:25,y:80,size:18});pdf.setTitle('Synthetic compression QA');
 const root=pdf.context.obj({Type:'Outlines'}),rr=pdf.context.register(root),mark=pdf.context.obj({Title:lib.PDFString.of('QA page'),Parent:rr,Dest:[page.ref,n('Fit')]}),mr=pdf.context.register(mark);
 root.set(n('First'),mr);root.set(n('Last'),mr);root.set(n('Count'),lib.PDFNumber.of(1));pdf.catalog.set(n('Outlines'),rr);
 fs.mkdirSync('dist/qa',{recursive:true});fs.writeFileSync('dist/qa/image.pdf',await pdf.save());
 fs.writeFileSync('dist/qa/index.html','<!doctype html><html lang="en"><meta charset="utf-8"><title>Compression QA</title><h1>Synthetic PDF compression fixture</h1><p>No user documents are included.</p><a href="/qa/image.pdf" download="compression-qa.pdf">Download synthetic PDF</a><p><a href="/editor/">Open editor</a></p></html>');
 console.log('Generated preview-only QA fixture');
})().catch(e=>{console.error(e);process.exitCode=1});
