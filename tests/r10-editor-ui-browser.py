"""R10 isolated full editor UI smoke; uses real source JS via inline injection, not hosted routing."""
import json,re,tempfile
from pathlib import Path
import fitz
from PIL import Image
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1]
FIX=Path(tempfile.mkdtemp(prefix='sunrise-r10-'))
DOC=fitz.open()
for i in range(4):
 p=DOC.new_page(width=595,height=842);p.insert_text((55,75),f'Sunrise R10 sample {i+1}')
DOC.save(FIX/'sample.pdf');DOC.close()
Image.new('RGB',(150,90),(110,150,190)).save(FIX/'sample.png')
html=(ROOT/'src/editor/index.html').read_text(encoding='utf-8')
# Inject actual project code in original DOM, not stub launchers. No network dependency.
def insert_script(m):
 u=m.group(1)
 if not u.startswith('/assets/'): return m.group()
 f=(ROOT/'dist/assets/pdf-lib/pdf-lib.min.js') if '/pdf-lib/' in u else ROOT/'src/assets'/u.removeprefix('/assets/')
 return '<script>\n'+f.read_text(encoding='utf-8').replace('</script','<\\/script')+'\n</script>'
html=re.sub(r'<script src="([^"]+)"></script>',insert_script,html)
html=re.sub(r'<script type="module">[\s\S]*?</script>','',html,count=1)
html=re.sub(r'<link [^>]*https?://[^>]*>','',html)
results={'scope':'Chromium isolated DOM, real R09 JS/PDFLib; no live routing/auth, no pdf.js rendering, no official build', 'tools':[], 'runs':[], 'errors':[]}
with sync_playwright() as p:
 b=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox','--no-proxy-server'])
 page=b.new_page(viewport={'width':1280,'height':900},accept_downloads=True)
 page.on('pageerror',lambda e:results['errors'].append(str(e)))
 page.set_content(html,wait_until='domcontentloaded',timeout=25000)
 page.wait_for_timeout(300)
 assert page.evaluate('typeof window.SunriseToolHub')=='object'
 # The renderer prerequisite is stubbed ONLY to verify modal wiring; not rendering or exporting.
 page.evaluate('window.pdfjsLib={getDocument:()=>{throw Error("renderer stub is modal-only");}}')
 hub=page.locator('#sunriseToolHubQuick')
 assert hub.count()==1
 catalog=page.evaluate('window.SunriseToolHub.getCatalog().map(t=>({id:t.id,label:t.label}))')
 expected=['organize','form','watermark','number','metadata','batch-preflight','images-to-pdf','pdf-to-images','crop-pdf','resize-pdf','pdf-nup','overlay-pdf','pdf-visual-compare']
 for tid in expected:
  name=next(x['label'] for x in catalog if x['id']==tid)
  try:
   page.evaluate('window.closeModal()');hub.click(timeout=2500)
   button=page.locator('#sunriseToolDirectory button.sunrise-tool-launch').filter(has_text=name).first
   assert button.count()==1
   button.click(timeout=2500)
   page.wait_for_timeout(100)
   visible=page.evaluate("() => !!document.getElementById('modalBackdrop')?.classList.contains('open')")
   actual=page.locator('#modalTitle').inner_text()
   assert visible and '모든 도구' not in actual,actual
   inputs=page.locator('#modalBody input[type=file]').count()
   assert inputs>0,(tid,actual)
   results['tools'].append({'id':tid,'result':'PASS','title':actual,'fileInputs':inputs})
  except Exception as e:
   results['tools'].append({'id':tid,'result':'FAIL','reason':str(e)[:280]})
  finally: page.evaluate('window.closeModal()')
 # Nup UI: upload PDF, run and click resulting download
 try:
  page.evaluate('window.SunrisePdfNupLaunch()')
  page.locator('#sunNupFiles').set_input_files(str(FIX/'sample.pdf'))
  page.locator('#sunNupCount').select_option('4')
  page.locator('#sunNupRun').click()
  page.locator('#sunNupResult button').wait_for(timeout=18000)
  with page.expect_download(timeout=10000) as ev:page.locator('#sunNupResult button').click()
  dl=ev.value;out=FIX/'r10_nup_download.pdf';dl.save_as(out)
  check=fitz.open(out);count=check.page_count;check.close()
  assert count==1,(count,dl.suggested_filename)
  results['runs'].append({'id':'pdf-nup','result':'PASS','outputPages':count,'downloadName':dl.suggested_filename,'bytes':out.stat().st_size})
 except Exception as e: results['runs'].append({'id':'pdf-nup','result':'FAIL','reason':str(e)[:450], 'status':page.locator('#sunNupStatusText').inner_text() if page.locator('#sunNupStatusText').count() else ''})
 finally:page.evaluate('window.closeModal()')
 # Image -> PDF UI full create/download
 try:
  page.evaluate('window.SunriseImagesToPdfLaunch()')
  page.locator('#sunImagesInput').set_input_files(str(FIX/'sample.png'))
  page.locator('#sunImagesMake').click()
  page.locator('#sunImagesDownload button').wait_for(timeout=13000)
  with page.expect_download(timeout=10000) as ev:page.locator('#sunImagesDownload button').click()
  dl=ev.value;out=FIX/'r10_images_download.pdf';dl.save_as(out)
  check=fitz.open(out);count=check.page_count;check.close()
  assert count==1,count
  results['runs'].append({'id':'images-to-pdf','result':'PASS','outputPages':count,'downloadName':dl.suggested_filename,'bytes':out.stat().st_size})
 except Exception as e:results['runs'].append({'id':'images-to-pdf','result':'FAIL','reason':str(e)[:400],'status':page.locator('#sunImagesStatus').inner_text() if page.locator('#sunImagesStatus').count() else ''})
 finally:page.evaluate('window.closeModal()')
 # metadata UI form inspect and save
 try:
  page.evaluate('window.SunrisePdfMetadataLaunch()')
  assert page.locator('input[type=file]').count()>0
  results['runs'].append({'id':'metadata-ui','result':'PASS','fileInput':True,'fields':page.locator('[id^="sunMeta_"]').count()})
 except Exception as e:results['runs'].append({'id':'metadata-ui','result':'FAIL','reason':str(e)[:240]})
 finally:page.evaluate('window.closeModal()')
 # Mobile UI smoke on same rendered source
 page.set_viewport_size({'width':390,'height':844})
 page.evaluate('window.SunrisePdfNupLaunch()')
 css=page.evaluate("()=>({vw:window.innerWidth,box:document.querySelector('#modalBox').getBoundingClientRect().width,scroll:document.querySelector('#modalBody').scrollHeight > document.querySelector('#modalBody').clientHeight})")
 results['mobile']=css
 page.evaluate('window.closeModal()')
 b.close()
print(json.dumps(results,ensure_ascii=False,indent=2))
(ROOT/'tests/r10-editor-ui-results.json').write_text(json.dumps(results,ensure_ascii=False,indent=2),encoding='utf-8')
