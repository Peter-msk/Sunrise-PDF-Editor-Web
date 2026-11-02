from pathlib import Path
import re, json, fitz, tempfile
from playwright.sync_api import sync_playwright
root=Path(__file__).resolve().parents[1]; folder=Path(tempfile.mkdtemp(prefix='sunrise-r10-'));html=(root/'src/editor/index.html').read_text()
doc=fitz.open()
for i in range(4):
 page=doc.new_page(width=595,height=842);page.insert_text((55,75),f'Sunrise R10 sample {i+1}')
doc.save(folder/'sample.pdf');doc.close()
def swap(m):
 s=m.group(1)
 if not s.startswith('/assets/'):return m.group(0)
 f=root/'dist/assets/pdf-lib/pdf-lib.min.js' if '/pdf-lib/' in s else root/'src/assets'/s.removeprefix('/assets/')
 return '<script>\n'+f.read_text().replace('</script','<\\/script')+'</script>'
html=re.sub(r'<script src="([^"]+)"></script>',swap,html)
html=re.sub(r'<script type="module">[\s\S]*?</script>','',html,count=1)
html=re.sub(r'<link [^>]*https?://[^>]*>','',html)
output=[]
with sync_playwright() as p:
 b=p.chromium.launch(executable_path='/usr/bin/chromium',args=['--no-sandbox','--no-proxy-server'])
 page=b.new_page(viewport={'width':1200,'height':900},accept_downloads=True)
 errors=[];page.on('pageerror',lambda x:errors.append(str(x)))
 page.set_content(html,wait_until='domcontentloaded',timeout=25000)
 def run(label,open_fn,src,runner,outsel,outputfile,verify):
  try:
   page.evaluate(open_fn)
   page.locator(src).set_input_files(str(folder/'sample.pdf'))
   if label=='metadata':
    page.locator('#sunMetaInspect').click()
    page.locator('#sunMeta_title').wait_for(timeout=9000)
    page.locator('#sunMeta_title').fill('R10 metadata validated')
   page.locator(runner).click()
   page.locator(outsel).wait_for(timeout=9000)
   with page.expect_download(timeout=12000) as d:page.locator(outsel).click()
   download=d.value;path=folder/outputfile;download.save_as(path)
   doc=fitz.open(path);props={'pages':doc.page_count,'metadataTitle':doc.metadata.get('title'),'box':list(doc[0].rect),'text':doc[0].get_text()[:120]};doc.close()
   assert verify(props),props
   output.append({'id':label,'status':'PASS','file':download.suggested_filename,'bytes':path.stat().st_size,'details':props})
  except Exception as e:
   output.append({'id':label,'status':'FAIL','error':str(e)[:280], 'statusText':page.locator('#sunMetaStatus').inner_text() if label=='metadata' and page.locator('#sunMetaStatus').count() else page.locator('#sunGeoStatus').inner_text() if label in ['crop','resize'] and page.locator('#sunGeoStatus').count() else page.locator('#sunStampStatus').inner_text() if page.locator('#sunStampStatus').count() else ''})
  finally:page.evaluate('window.closeModal()')
 run('crop','window.SunrisePdfPageCropLaunch()','#sunGeoFile','#sunGeoRun','#sunGeoOutput button','ui_crop.pdf',lambda x:x['pages']==4)
 run('resize','window.SunrisePdfPageResizeLaunch()','#sunGeoFile','#sunGeoRun','#sunGeoOutput button','ui_resize.pdf',lambda x:x['pages']==4)
 run('metadata','window.SunrisePdfMetadataLaunch()','#sunMetaFile','#sunMetaApply','#sunMetaDownload button','ui_metadata.pdf',lambda x:x['pages']==4 and x['metadataTitle']=='R10 metadata validated')
 run('stamp','window.SunrisePdfStampLaunch("watermark")','#sunStampFile','#sunStampApply','#sunStampOutput button','ui_stamp.pdf',lambda x:x['pages']==4)
 b.close()
print(json.dumps({'runs':output,'errors':errors},ensure_ascii=False,indent=2));(root/'tests/r10-extra-ui-results.json').write_text(json.dumps({'runs':output,'errors':errors},ensure_ascii=False,indent=2))
