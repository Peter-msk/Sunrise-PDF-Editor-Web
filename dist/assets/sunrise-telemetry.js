/* Sunrise telemetry: no PDF bytes, text, filename, search term, IP or error messages. */
(() => {
 if(location.pathname.startsWith('/admin'))return;
 const area=location.pathname.startsWith('/editor')?'editor':'home';
 let sid;
 try {
   sid=sessionStorage.getItem('sunrise_anon_tab');
   if(!sid){sid=crypto.randomUUID();sessionStorage.setItem('sunrise_anon_tab',sid)}
 }catch{sid=crypto.randomUUID()}
 const send=(type,extra={})=>{
   const data=JSON.stringify({type,session:sid,...extra});
   fetch('/api/telemetry',{method:'POST',credentials:'same-origin',keepalive:true,headers:{'content-type':'application/json'},body:data}).catch(()=>{});
 };
 send('visit');
 if(area!=='editor')return;
 let last=performance.now(),lastFeature='기타',lastErrorAt=0;
 const classify=s=>{
   s=String(s||'').toLowerCase().slice(0,100);
   if(/compress|압축/.test(s))return '압축';
   if(/bookmark|북마크/.test(s))return '북마크';
   if(/search|검색/.test(s))return '검색';
   if(/save|저장|download/.test(s))return '저장';
   if(/note|annotation|stamp|주석|스탬프|형광펜/.test(s))return '주석';
   if(/page|rotate|페이지|회전|분할/.test(s))return '페이지';
   if(/open|upload|파일 열기|문서 열기|merge|병합/.test(s))return '문서 열기';
   return '기타';
 };
 document.addEventListener('click',e=>{
   const el=e.target.closest('button,[data-command],a');
   if(el){const v=el.dataset.command||el.dataset.action||el.id||el.title||el.textContent;lastFeature=classify(v)}
 },{capture:true,passive:true});
 const report=category=>{
   const now=Date.now();
   if(now-lastErrorAt<3100)return;
   lastErrorAt=now;
   send('failure',{feature:category||lastFeature});
 };
 window.addEventListener('error',()=>report(lastFeature));
 window.addEventListener('unhandledrejection',()=>report(lastFeature));
 window.sunriseTelemetryFeatureError=feature=>report(classify(feature)); // future explicit integration
 setInterval(()=>{
   const now=performance.now(),diff=(now-last)/1000;last=now;
   if(document.visibilityState==='visible'&&document.hasFocus()&&diff>=8&&diff<=30){
     send('pulse',{area:'editor',seconds:Math.min(15,Math.round(diff))});
   }
 },15000);
 document.addEventListener('visibilitychange',()=>{last=performance.now()});
})();
