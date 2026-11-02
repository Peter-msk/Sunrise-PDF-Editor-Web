from pathlib import Path
import re,json,fitz,csv,tempfile
from playwright.sync_api import sync_playwright
root=Path(__file__).resolve().parents[1]; f=Path(tempfile.mkdtemp(prefix='sunrise-r10-'))
doc=fitz.open()
for i in range(4):
 page=doc.new_page(width=595,height=842);page.insert_text((55,75),f'Sunrise R10 sample {i+1}')
doc.save(f/'sample.pdf');doc.close()
s=(root/'src/editor/index.html').read_text()
def inject(m):
 u=m.group(1)
 if not u.startswith('/assets/'):return m.group(0)
 p=root/'dist/assets/pdf-lib/pdf-lib.min.js' if '/pdf-lib/' in u else root/'src/assets'/u.removeprefix('/assets/')
 return '<script>'+p.read_text().replace('</script','<\\/script')+'</script>'
s=re.sub(r'<script src="([^"]+)"></script>',inject,s)
s=re.sub(r'<script type="module">[\s\S]*?</script>','',s,count=1);s=re.sub(r'<link [^>]*https?://[^>]*>','',s)
out={'runs':[],'errors':[]}
with sync_playwright() as p:
 b=p.chromium.launch(executable_path='/usr/bin/chromium',args=['--no-sandbox','--no-proxy-server'])
 page=b.new_page(viewport={'width':1280,'height':900},accept_downloads=True)
 page.on('pageerror',lambda e:out['errors'].append(str(e)))
 page.set_content(s,wait_until='domcontentloaded',timeout=23000)
 def run(id,openFn,uploads,setup,runid,output,outputfile,pages=4):
  try:
   page.evaluate(openFn)
   for selector in uploads:page.locator(selector).set_input_files(str(f/'sample.pdf'))
   if setup:setup()
   page.locator(runid).click()
   page.locator(output).wait_for(timeout=10000)
   with page.expect_download(timeout=10000) as ev:page.locator(output).click()
   dl=ev.value;dest=f/outputfile;dl.save_as(dest)
   if dest.suffix=='.pdf':
    doc=fitz.open(dest);n=doc.page_count;doc.close();assert n==pages,n
   else:
    raw=dest.read_text(encoding='utf-8-sig');assert 'sample.pdf' in raw,raw[:200];n=len(raw)
   out['runs'].append({'id':id,'status':'PASS','download':dl.suggested_filename,'bytes':dest.stat().st_size,'pagesOrChars':n})
  except Exception as e:
   out['runs'].append({'id':id,'status':'FAIL','message':str(e)[:250],'statusText':page.locator('#sunrisePreflightProgress').inner_text() if id=='preflight' and page.locator('#sunrisePreflightProgress').count() else page.locator('#sunOvStatusText').inner_text() if id=='overlay' and page.locator('#sunOvStatusText').count() else page.locator('#pageComposeStatus').inner_text() if id=='compose' and page.locator('#pageComposeStatus').count() else ''})
  finally:page.evaluate('window.closeModal()')
 run('compose','window.SunrisePageComposerLaunch()',['#pageComposeFiles'],None,'#pageComposeStart','#pageComposeResult button','ui_compose.pdf',4)
 run('overlay','window.SunrisePdfOverlayLaunch()',['#sunOverlayBase','#sunOverlayLayer'],None,'#sunOvStart','#sunOvResult button','ui_overlay.pdf',4)
 run('preflight','window.SunriseBatchPreflightLaunch()',['#sunrisePreflightFiles'],None,'#sunrisePreflightRun','#sunrisePreflightCsv','ui_preflight.csv')
 try:
  page.evaluate('window.SunrisePdfFormToolsLaunch()')
  page.locator('#sunFormInput').set_input_files(str(f/'sample.pdf'))
  page.locator('#sunFormInspect').click()
  page.wait_for_timeout(300)
  page.locator('#sunFormName').fill('full_name')
  page.locator('#sunFormValue').fill('Sunrise')
  page.locator('#sunFormQueueAdd').click()
  page.locator('#sunFormApply').click()
  page.locator('#sunFormOutput button').wait_for(timeout=11000)
  with page.expect_download(timeout=10000) as ev:page.locator('#sunFormOutput button').click()
  dest=f/'ui_form.pdf';ev.value.save_as(dest)
  doc=fitz.open(dest); count=doc.page_count; widgets=list(doc[0].widgets() or []);doc.close()
  assert count==4 and len(widgets)>=1, (count,len(widgets))
  out['runs'].append({'id':'form','status':'PASS','pages':count,'fields':len(widgets)})
 except Exception as e:out['runs'].append({'id':'form','status':'FAIL','message':str(e)[:300], 'statusText':page.locator('#sunFormStatus').inner_text() if page.locator('#sunFormStatus').count() else ''})
 finally:page.evaluate('window.closeModal()')
 b.close()
print(json.dumps(out,ensure_ascii=False,indent=2));(root/'tests/r10-remaining-ui-results.json').write_text(json.dumps(out,ensure_ascii=False,indent=2))
