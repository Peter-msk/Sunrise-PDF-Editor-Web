"""Browser tests: orientation grouping, watermark and numbering setup, mask modal clipping, signature visual label.
External assets are replaced with deterministic PDF reader; output geometry is checked separately with PDF-lib/fitz.
"""
from pathlib import Path
import fitz, tempfile, json, re
from playwright.sync_api import sync_playwright
BASE=Path(__file__).resolve().parent.parent
SIZES=[(420,595),(842,595),(810,595),(860,595),(420,595),(420,595),(842,595),(420,595)]
fixture=Path(tempfile.mkdtemp(prefix='sunrise-r15-browser-'))/'mixed.pdf'
pdf=fitz.open()
for i,(w,h) in enumerate(SIZES):
 page=pdf.new_page(width=w,height=h);page.insert_text((45,60),f'R15 page {i+1}',fontsize=16)
pdf.save(fixture);pdf.close()
html=(BASE/'src/editor/index.html').read_text()
html=re.sub(r'<script[^>]+src="[^"]+"[^>]*></script>','',html)
html=re.sub(r'<script type="module">[\s\S]*?</script>','',html)
sizes_js=json.dumps(SIZES)
mock='''<script>
window.PDFLib={PDFDocument:{load:async()=>({getPageCount:()=>8,getTitle:()=>'',getAuthor:()=>'',getSubject:()=>'',getKeywords:()=>''})}};
window.SunriseEditState={restore:async bytes=>({bytes,overlays:[],warning:null})};
window.SunriseSpecialPdf={exportMaskedPages:async()=>({}),parseMaskPlan:()=>[]};
const testSizes=__SIZES__;
window.pdfjsLib={getDocument:()=>({promise:Promise.resolve({numPages:testSizes.length,
  getPage:async i=>({getViewport:({scale})=>({width:testSizes[i-1][0]*scale,height:testSizes[i-1][1]*scale}),
    render:({canvasContext,viewport})=>{canvasContext.fillStyle='#eee';canvasContext.fillRect(0,0,viewport.width,viewport.height);return {promise:Promise.resolve(),cancel:()=>{}}}}),
  getAttachments:async()=>null,getOutline:async()=>[]
})})};
</script>'''.replace('__SIZES__',sizes_js)
html=html.replace('</head>',mock+'</head>')
results={}
with sync_playwright() as p:
 browser=p.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=['--no-sandbox','--disable-dev-shm-usage'])
 page=browser.new_page(viewport={'width':1440,'height':860})
 errors=[];page.on('pageerror',lambda err:errors.append(str(err)))
 print('STEP '+"page.set_content(html,wait_until='domcontentl",flush=True);page.set_content(html,wait_until='domcontentloaded',timeout=40000)
 print('STEP '+"page.locator('#openPdfInput').set_input_files",flush=True);page.locator('#openPdfInput').set_input_files(str(fixture))
 print('STEP '+'page.wait_for_function("document.querySelecto',flush=True);page.wait_for_function("document.querySelector('#pageStatusBanner')?.textContent.includes('전체: 8') && document.querySelector('#pageStage canvas')?.width > 20",timeout=40000)
 for view in ['2','3']:
  print('STEP '+"page.locator('#pageViewMode').select_option(v",flush=True);page.locator('#pageViewMode').select_option(view)
  page.wait_for_timeout(250)
  groups=page.evaluate('''() => Array.from(document.querySelectorAll('#pagesFlow > .page-orientation-row')).map(r=>({orientation:r.dataset.orientation,pages:Array.from(r.querySelectorAll('.page-slot')).map(x=>Number(x.dataset.pageIndex)+1)}))''')
  assert groups==[{'orientation':'portrait','pages':[1]}, {'orientation':'landscape','pages':[2,3] if view=='2' else [2,3,4]},*([{'orientation':'landscape','pages':[4]}] if view=='2' else []), {'orientation':'portrait','pages':[5,6]}, {'orientation':'landscape','pages':[7]}, {'orientation':'portrait','pages':[8]}],groups
  # Physical direction must not appear together in a row.
  for g in groups:
   for i in g['pages']:
    assert (SIZES[i-1][0]>SIZES[i-1][1])==(g['orientation']=='landscape')
  results['spreads_'+view]=groups
 # numbering: page 2 starts at 10 and skips pages 3 and 6
 print('STEP '+'page.evaluate("executeCommand(\'insertPageNumb',flush=True);page.evaluate("executeCommand('insertPageNumber')")
 page.locator('#pgNumFromPage').fill('2')
 page.locator('#pgNumFirstValue').fill('10')
 page.locator('#pgNumSkipPages').fill('3,6')
 page.locator('#pgNumConfirmBtn').click()
 marks=page.evaluate('''() => activeDoc().overlays.filter(x=>x.type==='PageNumber').map(x=>({page:x.pageIndex+1,text:x.text}))''')
 assert marks==[{'page':2,'text':'- 10 / 5 -'},{'page':4,'text':'- 11 / 5 -'},{'page':5,'text':'- 12 / 5 -'},{'page':7,'text':'- 13 / 5 -'},{'page':8,'text':'- 14 / 5 -'}],marks
 results['numbering']=marks
 print('STEP '+'page.evaluate("executeCommand(\'insertWatermar',flush=True);page.evaluate("executeCommand('insertWatermark')")
 page.locator('#insTextInput').fill('CONFIDENTIAL')
 page.locator('#insScopeSelect').select_option('all')
 page.locator('#insConfirmBtn').click()
 wm=page.evaluate('''() => activeDoc().overlays.filter(x=>x.type==='Watermark').map(x=>({page:x.pageIndex+1,x:x.x,y:x.y,width:x.width,height:x.height}))''')
 assert len(wm)==8
 for m in wm:
  size=SIZES[m['page']-1];assert abs(m['x']+m['width']/2-size[0]/2)<1.1 and abs(m['y']+m['height']/2-size[1]/2)<1.1,m
 results['watermarkCenters']=wm
 print('STEP '+'page.evaluate("executeCommand(\'insertVisualSi',flush=True);page.evaluate("executeCommand('insertVisualSignature')")
 page.locator('#insTextInput').fill('김만성')
 assert '전자서명·인증서 서명 아님' in page.locator('#modalBody').inner_text()
 page.locator('#insConfirmBtn').click()
 signatures=page.evaluate("() => activeDoc().overlays.filter(x=>x.type==='VisualSignature').map(x=>x.text)")
 assert signatures==['김만성']
 # Must render the compact stamp on the selected page.
 page.evaluate('''() => { const d=activeDoc(); d.currentPage=d.overlays.find(x=>x.type==='VisualSignature').pageIndex; renderCurrentPageCanvas(); }''')
 page.wait_for_timeout(220)
 visible=page.locator('#annotationOverlay [data-overlay-id]',has_text='[전자서명 : 김만성]')
 assert visible.count()==1
 results['signature']='[전자서명 : 김만성]'
 print('STEP '+'page.evaluate("executeCommand(\'maskedPageExpo',flush=True);page.evaluate("executeCommand('maskedPageExport')")
 page.locator('#maskPlanLines').wait_for(state='visible',timeout=10000)
 box=page.locator('#maskPlanLines').bounding_box();assert box and box['height']>=105,box
 results['maskDesktopHeight']=box['height']
 page.set_viewport_size({'width':390,'height':844});page.wait_for_timeout(160)
 box2=page.locator('#maskPlanLines').bounding_box();assert box2 and box2['height']>=105,box2
 results['maskMobileHeight']=box2['height']
 results['pageErrors']=errors;assert not errors,errors
 browser.close()
print(json.dumps(results,ensure_ascii=False,indent=2))
(BASE/'tests/r15-browser-results.json').write_text(json.dumps(results,ensure_ascii=False,indent=2))
