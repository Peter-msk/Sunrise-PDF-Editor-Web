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
   const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),5000);
   return fetch('/api/telemetry',{method:'POST',credentials:'same-origin',keepalive:true,headers:{'content-type':'application/json'},body:data,signal:controller.signal})
     .then(response=>response.ok).catch(()=>false).finally(()=>clearTimeout(timer));
 };
 const kstDay=()=>new Date(Date.now()+9*3600000).toISOString().slice(0,10);
 let visitDay=kstDay(),visited=false,visitPromise=null;
 function ensureVisit(){
   const day=kstDay();
   if(day!==visitDay){visitDay=day;visited=false;visitPromise=null;}
   if(visited)return Promise.resolve(true);
   if(!visitPromise)visitPromise=send('visit').then(ok=>{
     if(visitDay===day){visited=ok;visitPromise=null;}
     return ok;
   });
   return visitPromise;
 }
 ensureVisit();
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
   ensureVisit().then(ok=>{if(ok)send('failure',{feature:category||lastFeature});});
 };
 window.addEventListener('error',()=>report(lastFeature));
 window.addEventListener('unhandledrejection',()=>report(lastFeature));
 // Count handled operation failures shown by the editor without transmitting their details.
 const toastRoot=document.getElementById('toastContainer');
 if(toastRoot){
   const observer=new MutationObserver(changes=>{
     for(const change of changes)for(const item of change.addedNodes){
       if(item.nodeType!==1||!item.classList?.contains('sunrise-toast'))continue;
       const visible=item.textContent||'';
       if(item.querySelector('.fa-circle-exclamation')||/실패|오류|처리하지 못/.test(visible)){
         const inferred=classify(visible);report(inferred==='기타'?lastFeature:inferred);
       }
     }
   });
   observer.observe(toastRoot,{childList:true});
 }

 window.sunriseTelemetryFeatureError=feature=>report(classify(feature)); // future explicit integration
 // Save preparation only. No file details or error messages are transmitted.
 // A missing network event is never presented as a confirmed outcome.
 let saveQueue=Promise.resolve();
 window.sunriseTelemetrySaveStart=retryOf=>{
   let id;try{id=crypto.randomUUID()}catch{return ()=>{}};
   let recorded=false;
   saveQueue=saveQueue.then(async()=>{if(await ensureVisit())recorded=await send('save_operation',{operationId:id,stage:'started',...(retryOf?{retryOf}:{})})}).catch(()=>{});
   let ended=false;
   const finish=stage=>{
     if(ended||!['ready','failed','cancelled'].includes(stage))return;
     ended=true;saveQueue=saveQueue.then(()=>recorded?send('save_operation',{operationId:id,stage}):false).catch(()=>{});
   };
   finish.id=id;return finish;
 };
 let pulsePending=false;
 setInterval(async()=>{
   const now=performance.now(),diff=(now-last)/1000;last=now;
   if(document.visibilityState==='visible'&&document.hasFocus()&&diff>=8&&diff<=30&&!pulsePending){
     pulsePending=true;
     try{if(await ensureVisit())await send('pulse',{area:'editor',seconds:Math.min(15,Math.round(diff))});}
     finally{pulsePending=false;}
   }
 },15000);
 document.addEventListener('visibilitychange',()=>{last=performance.now()});
})();
