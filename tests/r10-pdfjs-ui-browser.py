from pathlib import Path
import re, json, zipfile, fitz, tempfile
from playwright.sync_api import sync_playwright
root=Path(__file__).resolve().parents[1];fixtures=Path(tempfile.mkdtemp(prefix='sunrise-r10-'))
doc=fitz.open()
for i in range(4):
 page=doc.new_page(width=595,height=842);page.insert_text((55,75),f'Sunrise R10 sample {i+1}')
doc.save(fixtures/'sample.pdf');doc.close()
html=(root/'src/editor/index.html').read_text()
def swap(m):
 s=m.group(1)
 if not s.startswith('/assets/'):return m.group(0)
 f=root/'dist/assets/pdf-lib/pdf-lib.min.js' if '/pdf-lib/' in s else root/'src/assets'/s.removeprefix('/assets/')
 return '<script>'+f.read_text().replace('</script','<\\/script')+'</script>'
html=re.sub(r'<script src="([^"]+)"></script>',swap,html)
html=re.sub(r'<script type="module">[\s\S]*?</script>','',html,count=1)
html=re.sub(r'<link [^>]*https?://[^>]*>','',html)
res={'runs':[],'errors':[]}
with sync_playwright() as p:
 b=p.chromium.launch(executable_path='/usr/bin/chromium',args=['--no-sandbox','--no-proxy-server'])
 page=b.new_page(viewport={'width':1200,'height':900},accept_downloads=True)
 page.on('pageerror',lambda e:res['errors'].append(str(e)))
 page.set_content(html,wait_until='domcontentloaded',timeout=25000)
 page.evaluate('''async ({main,worker})=>{
  const url=URL.createObjectURL(new Blob([main],{type:'text/javascript'}));
  const pdfjs=await import(url);
  pdfjs.GlobalWorkerOptions.workerSrc=URL.createObjectURL(new Blob([worker],{type:'text/javascript'}));
  window.pdfjsLib=pdfjs;
 }''',{'main':(root/'dist/assets/pdfjs/pdf.min.mjs').read_text(),'worker':(root/'dist/assets/pdfjs/pdf.worker.min.mjs').read_text()})
 try:
  page.evaluate('window.SunrisePdfToImagesLaunch()')
  page.locator('#sunPdfToImagesFile').set_input_files(str(fixtures/'sample.pdf'))
  page.locator('#sunPdfToImagesDpi').select_option('96')
  page.locator('#sunPdfToImagesStart').click()
  page.locator('#sunPdfToImagesDownloads button').wait_for(timeout=18000)
  with page.expect_download(timeout=8000) as d:page.locator('#sunPdfToImagesDownloads button').click()
  file=fixtures/'ui_pdf_images.zip';d.value.save_as(file)
  with zipfile.ZipFile(file) as z:assert z.testzip() is None;names=z.namelist();assert len(names)==4,names
  res['runs'].append({'id':'pdf-to-images-ui','status':'PASS','count':len(names),'name':d.value.suggested_filename})
 except Exception as e:res['runs'].append({'id':'pdf-to-images-ui','status':'FAIL','error':str(e)[:280],'message':page.locator('#sunPdfToImagesStatus').inner_text() if page.locator('#sunPdfToImagesStatus').count() else ''})
 finally:page.evaluate('window.closeModal()')
 try:
  page.evaluate('window.SunrisePdfVisualCompareLaunch()')
  page.locator('#sunCmpSource').set_input_files(str(fixtures/'sample.pdf'))
  page.locator('#sunCmpTarget').set_input_files(str(fixtures/'sample.pdf'))
  page.locator('#sunCmpDpi').select_option('72')
  page.locator('#sunCmpRun').click()
  page.locator('#sunCmpDownload button').wait_for(timeout=18000)
  status=page.locator('#sunCmpStatus').inner_text()
  with page.expect_download(timeout=8000) as d:page.locator('#sunCmpDownload button').click()
  file=fixtures/'ui_compare.zip';d.value.save_as(file)
  with zipfile.ZipFile(file) as z:assert z.testzip() is None;names=z.namelist();assert any(n.endswith('.csv') for n in names),names
  assert '동일 4쪽' in status,status
  res['runs'].append({'id':'visual-compare-ui','status':'PASS','message':status,'files':names})
 except Exception as e:res['runs'].append({'id':'visual-compare-ui','status':'FAIL','error':str(e)[:280],'message':page.locator('#sunCmpStatus').inner_text() if page.locator('#sunCmpStatus').count() else ''})
 finally:page.evaluate('window.closeModal()')
 b.close()
(root/'tests/r10-pdfjs-ui-results.json').write_text(json.dumps(res,ensure_ascii=False,indent=2))
print(json.dumps(res,ensure_ascii=False,indent=2))
