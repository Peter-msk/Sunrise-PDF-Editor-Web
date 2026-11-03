'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const lib=require('../dist/assets/pdf-lib/pdf-lib.min.js');
const images=require('../src/assets/sunrise-embedded-images.js');
// Two-pixel RGB JPEG created for this contract (not a licensed third-party asset).
const original=Uint8Array.from(Buffer.from('/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAUDBAQEAwUEBAQFBQUGBwwIBwcHBw8LCwkMEQ8SEhEPERETFhwXExQaFRERGCEYGh0dHx8fExciJCIeJBweHx7/2wBDAQUFBQcGBw4ICA4eFBEUHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh7/wAARCAACAAIDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDBooor9APhz//Z','base64'));
const n=lib.PDFName.of;
async function fixture(){
 const doc=await lib.PDFDocument.create();
 const jpeg=await doc.embedJpg(original);
 for(let i=0;i<2;i++){
  const page=doc.addPage([420,600]);
  page.drawImage(jpeg,{x:20,y:20,width:120,height:120});
 }
 return Uint8Array.from(await doc.save());
}
function hooks(extra){
 const out=[];
 return {out,opts:{PDFLib:lib,onImage:async x=>out.push(x),
  yieldTask:async()=>{},...extra}};
}
async function test(){
 const source=await fixture(),copy=Uint8Array.from(source);
 const {out,opts}=hooks();
 const report=await images.extractOriginalJpegs(source,opts);
 assert.equal(report.pages,2);
 assert.equal(report.images,1,'reused XObject should be extracted only once');
 assert.equal(report.skipped,0);
 assert.equal(out[0].page,1);
 assert.equal(out[0].width,2);assert.equal(out[0].height,2);
 assert.equal(out[0].format,'jpeg');
 assert.deepEqual(out[0].bytes,original,'native JPEG must remain bit-identical');
 assert.notStrictEqual(out[0].bytes,original,'results must own a copy');
 assert.deepEqual(source,copy,'PDF source bytes must not change');
 const pageOnly=hooks({currentPage:2});
 const limited=await images.extractOriginalJpegs(source,pageOnly.opts);
 assert.equal(limited.pages,1);assert.equal(limited.images,1);
 assert.equal(pageOnly.out[0].page,2);
 await assert.rejects(images.extractOriginalJpegs(source,hooks({currentPage:3}).opts),/페이지 번호/);
 await assert.rejects(images.extractOriginalJpegs(source,hooks({cancelled:()=>true}).opts),/취소/);
 // Non-JPEG /Filter must be reported as skipped rather than exported with
 // an incorrect JPG extension, even if the underlying bytes look like JPEG.
 const changed=await lib.PDFDocument.load(source);
 const xobj=changed.context.lookup(changed.getPage(0).node.Resources().get(n('XObject')));
 const reference=xobj.entries()[0][1];
 const stream=changed.context.lookup(reference);
 assert.equal(stream.dict.get(n('Subtype')).toString(),'/Image');
 assert.equal(stream.dict.get(n('Filter')).toString(),'/DCTDecode');
 stream.dict.set(n('Filter'),n('JPXDecode'));
 const unsupported=hooks();
 const skipped=await images.extractOriginalJpegs(await changed.save(),unsupported.opts);
 assert.equal(skipped.images,0);assert.equal(unsupported.out.length,0);
 assert(skipped.skipped>=1);
 // Masked images require a composite surface; native JPEG alone is incomplete.
 stream.dict.set(n('Filter'),n('DCTDecode'));
 stream.dict.set(n('SMask'),n('UnsupportedMask'));
 const masked=hooks();
 const maskedResult=await images.extractOriginalJpegs(await changed.save(),masked.opts);
 assert.equal(maskedResult.images,0);assert(maskedResult.skipped>=1);
 // Explicit non-JPEG sources (RGB PNG) cannot be disguised as original JPGs.
 const png=await lib.PDFDocument.create();
 const pngBytes=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL/nwAAAABJRU5ErkJggg==','base64');
 const embedded=await png.embedPng(pngBytes);
 png.addPage([120,120]).drawImage(embedded,{x:10,y:10,width:90,height:90});
 const nonJpeg=hooks();
 const nonJpegResult=await images.extractOriginalJpegs(await png.save(),nonJpeg.opts);
 assert.equal(nonJpegResult.images,0);assert.equal(nonJpeg.out.length,0);
 // Full UI path must select JPEG vs PNG explicitly, use the correct MIME,
 // and not alter the previous PNG extractor contract.
 const editor=fs.readFileSync('src/editor/index.html','utf8');
 const modal=editor.slice(editor.indexOf('function openEmbeddedImagesModal'),editor.indexOf('async function renderImageForExport'));
 assert.match(modal,/id="embeddedImageMode"/);
 assert.match(modal,/extractOriginalJpegs\(originalBytes/);
 assert.match(modal,/extract\(reader/);
 assert.match(modal,/image\/jpeg/);
 assert.match(modal,/원본 JPG 저장/);
 console.log('PASS R20: actual pdf-lib embedded JPEG byte identity, resource dedup, page scope, mask/filter exclusions, cancellation and UI wiring');
}
test().catch(e=>{console.error(e);process.exitCode=1;});
