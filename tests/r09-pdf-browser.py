"""Chromium DOM + bundled PDF.js; isolated fixture, no network or production."""
from playwright.sync_api import sync_playwright
from reportlab.pdfgen import canvas
from io import BytesIO
import json,base64,zipfile
from pathlib import Path
root=Path(__file__).resolve().parents[1]
def sample(message,pages=1):
 buf=BytesIO();c=canvas.Canvas(buf,pagesize=(220,150))
 for i in range(pages):
  c.setFont('Helvetica',16);c.drawString(20,100,message+' '+str(i));c.showPage()
 c.save();return base64.b64encode(buf.getvalue()).decode()
with sync_playwright() as p:
 b=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox','--no-proxy-server'])
 page=b.new_page();page.set_content('<!doctype html><html><body></body></html>')
 main=(root/'dist/assets/pdfjs/pdf.min.mjs').read_text();worker=(root/'dist/assets/pdfjs/pdf.worker.min.mjs').read_text()
 page.evaluate('''async ({main,worker})=>{
  const src=URL.createObjectURL(new Blob([main],{type:'text/javascript'}));
  const pdfjs=await import(src);
  pdfjs.GlobalWorkerOptions.workerSrc=URL.createObjectURL(new Blob([worker],{type:'text/javascript'}));
  window.pdfjsLib=pdfjs;
 }''',{'main':main,'worker':worker})
 for f in ['sunrise-pdf-to-images.js','sunrise-pdf-visual-compare.js']:
  page.add_script_tag(path=str(root/'src/assets'/f))
 result=page.evaluate('''async ({same,changed,short})=>{
  const file=(b64,name)=>new File([Uint8Array.from(atob(b64),ch=>ch.charCodeAt(0))],name,{type:'application/pdf'});
  const a=file(same,'a.pdf'),c=file(changed,'c.pdf'),shortFile=file(short,'short.pdf');
  const opts={pdfjsLib:window.pdfjsLib,createCanvas:()=>document.createElement('canvas'),createZip:SunrisePdfToImages.packEntries};
  const png=await SunrisePdfToImages.convert([a],{format:'png',dpi:96,pages:'all'},opts);
  const jpeg=await SunrisePdfToImages.convert([a],{format:'jpeg',dpi:96,pages:'all',quality:0.9},opts);
  const equal=await SunrisePdfVisualCompare.convert(a,a,{dpi:72,tolerance:0,pages:'1'},opts);
  const diff=await SunrisePdfVisualCompare.convert(a,c,{dpi:72,tolerance:0,pages:'all'},opts);
  const missing=await SunrisePdfVisualCompare.convert(a,shortFile,{dpi:72,tolerance:0,pages:'all'},opts);
  const b64=async blob=>{
    const bytes=new Uint8Array(await blob.arrayBuffer());let s='';for(const byte of bytes)s+=String.fromCharCode(byte);return btoa(s);
  };
  const controller=new AbortController();controller.abort();
  let abort='not-cancelled';
  try{await SunrisePdfToImages.convert([a],{dpi:96,pages:'1'},{...opts,signal:controller.signal})}
  catch(e){abort=e.name}
  return {png:await b64(png.blob),jpg:await b64(jpeg.blob),equal:equal.report.rows.map(r=>r.status),diffRows:diff.report.rows.map(r=>({status:r.status,changed:r.differentPixels})),diffImageCount:diff.imageCount,diffZip:await b64(diff.blob),missing:missing.report.rows.map(r=>r.status),abort};
 }''',{'same':sample('ONE',2),'changed':sample('DIFFERENT',2),'short':sample('ONE',1)})
 report={'png':None,'jpeg':None,'compare':None}
 for k in ['png','jpg','diffZip']:
  byt=base64.b64decode(result.pop(k)); assert zipfile.is_zipfile(BytesIO(byt)),k
  with zipfile.ZipFile(BytesIO(byt)) as z:
   assert z.testzip() is None,k
   report[k]={'size':len(byt),'entries':z.namelist()}
 assert len(report['png']['entries'])==2
 assert all(x.endswith('.png') for x in report['png']['entries'])
 assert all(x.endswith('.jpg') for x in report['jpg']['entries'])
 assert result['equal']==['same'],result
 assert result['diffImageCount']==2,result
 assert all(x['status']=='different' and x['changed']>0 for x in result['diffRows'])
 assert result['missing']==['same','missing'],result
 assert result['abort']=='AbortError',result
 report.update(result);report['status']='PASS'
 print(json.dumps(report,ensure_ascii=False,indent=2))
 (root/'tests/r09-pdf-browser-results.json').write_text(json.dumps(report,ensure_ascii=False,indent=2))
 b.close()
