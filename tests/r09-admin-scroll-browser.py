"""R09: real Chromium DOM test for admin publication scrolling with mocked API.
No server, login, network, or production D1 is touched.
Run: python tests/r09-admin-scroll-browser.py
"""
from pathlib import Path
from playwright.sync_api import sync_playwright
import json
root=Path(__file__).resolve().parents[1]
html=(root/'dist/admin/index.html').read_text(encoding='utf-8')
mock='''<script>
window.__r09Requests=[];
const row=(i)=>({id:i,revision:0,title:'공지사항 '+i,body:'테스트 공지 내용 '+i,level:'info',is_active:1,first_published_at:'2026-11-03',published_at:'2026-11-03',visibility:'published'});
window.fetch=async url=>{
  const path=String(url),u=new URL(path,'https://test.local');let d={};
  if(u.pathname==='/api/admin/site-updates'){
   const cursor=u.searchParams.get('before_announcement');window.__r09Requests.push(cursor);
   d=cursor===null ? {today:'2026-11-03',announcements:Array.from({length:50},(_,i)=>row(100-i)),releases:[],next:{announcement:51,release:null}} :
     {today:'2026-11-03',announcements:Array.from({length:30},(_,i)=>row(50-i)),releases:[],next:{announcement:null,release:null}};
  }else if(u.pathname==='/api/admin/health')d={status:'ready',services:{worker:'responsive',database:'ready'},version:{application:'1.0'},checkedAt:new Date().toISOString(),probeMs:1};
  else if(u.pathname==='/api/admin/deployments')d={source:'signed-pipeline-report',items:[]};
  else if(u.pathname==='/api/admin/quality')d={windowDays:14,sessions:{total:0,withErrors:0,percent:null},trend:[],overdueInquiries:0,alerts:[]};
  else if(u.pathname==='/api/admin/inquiries')d={items:[],next:null};
  else if(u.pathname==='/api/admin/readiness')d={schema:{ready:true},configuration:{adminVerifier:true,deploymentReporting:true}};
  else if(u.pathname==='/api/admin/retention')d={pending:{inquiries:0,sessions:0},execution:null,checkedAt:new Date().toISOString()};
  else if(u.pathname==='/api/auth/sessions')d={active:1};
  else d={items:[],versions:[],sessions:0,visits:{},usage:{},operations:[],inquiries:{},trend:[],errors:[],total:0};
  return new Response(JSON.stringify(d),{status:200,headers:{'content-type':'application/json'}});
};
</script>'''
html=html.replace('<script type="module">',mock+'\n<script type="module">',1)
with sync_playwright() as playwright:
 browser=playwright.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox','--no-proxy-server'])
 page=browser.new_page(viewport={'width':1200,'height':900})
 errors=[];page.on('pageerror',lambda error:errors.append(str(error)))
 page.set_content(html,wait_until='load',timeout=15000)
 page.wait_for_function("document.querySelectorAll('#publicationList button').length===50",timeout=7000)
 def scroll_info():
  return page.evaluate('''()=>{const el=document.getElementById('publicationList'),style=getComputedStyle(el);return {
   height:el.clientHeight,fullHeight:el.scrollHeight,position:el.scrollTop,
   overflow:style.overflowY,count:el.querySelectorAll('button').length,
   nextDisabled:document.getElementById('publicationsMore').disabled,
   requests:window.__r09Requests.slice(),
   selected:el.querySelectorAll('[aria-pressed="true"]').length};}''')
 initial=scroll_info()
 assert initial['count']==50 and initial['overflow']=='scroll' and initial['height']<initial['fullHeight'],initial
 page.evaluate('''()=>{const el=document.getElementById('publicationList');el.scrollTop=el.scrollHeight;el.dispatchEvent(new Event('scroll'))}''')
 page.wait_for_function("document.querySelectorAll('#publicationList button').length===80",timeout=7000)
 appended=scroll_info()
 assert appended['requests']==[None,'51'] and appended['count']==80 and appended['nextDisabled'],appended
 before=appended['position']
 page.evaluate('''()=>document.querySelectorAll('#publicationList button')[45].click()''')
 chosen=scroll_info()
 assert chosen['position']==before and chosen['selected']==1,chosen
 page.set_viewport_size({'width':390,'height':844});page.wait_for_timeout(200)
 mobile=scroll_info()
 assert mobile['overflow']=='scroll' and mobile['height']<240 and mobile['position']==before,mobile
 assert not errors,errors
 summary={'status':'PASS','desktop':initial,'autoLoaded':appended,'afterSelection':chosen,'mobile':mobile,'pageErrors':errors,
  'scope':'local Chromium DOM with mocked API, not authenticated hosted application'}
 (root/'tests/r09-admin-scroll-browser-results.json').write_text(json.dumps(summary,ensure_ascii=False,indent=2),encoding='utf-8')
 print(json.dumps(summary,ensure_ascii=False,indent=2));browser.close()
