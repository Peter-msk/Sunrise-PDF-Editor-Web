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
 let last=performance.now(),lastInteraction=last,sampleAt=last,activeSeconds=0,usageDay=kstDay(),lastErrorAt=0;
 let foreground=document.visibilityState==='visible'&&document.hasFocus();
 function sampleUsage(now){
  const day=kstDay(),elapsed=now-sampleAt;
  if(elapsed<0||elapsed>30000){activeSeconds=0;usageDay=day;sampleAt=now;return}
  let since=sampleAt;
  if(day!==usageDay){activeSeconds=0;usageDay=day;const sinceMidnight=(Date.now()+9*3600000)%86400000;since=Math.max(since,now-sinceMidnight)}
  if(foreground){const until=Math.min(now,lastInteraction+120000);activeSeconds=Math.min(15,activeSeconds+Math.max(0,until-since)/1000)}
  sampleAt=now;
 }
 function presenceChanged(){const now=performance.now();sampleUsage(now);foreground=document.visibilityState==='visible'&&document.hasFocus()}
 for(const name of ['pointerdown','keydown','wheel','touchstart'])document.addEventListener(name,()=>{const now=performance.now();sampleUsage(now);lastInteraction=now},{capture:true,passive:true});
 document.addEventListener('visibilitychange',presenceChanged);
 window.addEventListener('focus',presenceChanged);window.addEventListener('blur',presenceChanged);
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
 const report=category=>{
   const now=Date.now();
   if(now-lastErrorAt<3100)return;
   lastErrorAt=now;
   ensureVisit().then(ok=>{if(ok)send('failure',{feature:category||'기타'});});
 };
 window.addEventListener('error',()=>report('기타'));
 window.addEventListener('unhandledrejection',()=>report('기타'));
 // Explicit operation failures are recorded with fixed diagnostic codes.
 // Warning toasts and the most recently clicked button are not failure evidence.
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
 let operationQueue=Promise.resolve();
 window.sunriseTelemetryOperationStart=feature=>{
   if(!window.SunriseDiagnostics?.OPERATION_FEATURES?.includes(feature))return ()=>{};
   let id;try{id=crypto.randomUUID()}catch{return ()=>{}};
   let recorded=false,ended=false;
   const trace=window.SunriseDiagnostics.createTrace(feature);trace?.mark('operation_start');
   operationQueue=operationQueue.then(async()=>{if(await ensureVisit())recorded=await send('operation',{operationId:id,feature,stage:'started'})}).catch(()=>{});
   const finish=(stage,detail)=>{
     if(ended||!['succeeded','failed','cancelled'].includes(stage))return;
     ended=true;
     // Fallback for every monitored feature; explicit detailed trace wins.
     // Never transmit document bytes, raw exception messages or stack traces.
     let diagnostic;
     if(stage==='failed'){
      diagnostic=window.SunriseDiagnostics.normalize(detail);
      if(!diagnostic){
       diagnostic=window.SunriseDiagnostics.capture(null,{code:'operation_failed',ua:window.navigator?.userAgent||''});
       trace?.mark('operation_failed');
       const safe=trace?.failure('operation_failed');
       if(safe)diagnostic.trace=safe;
      }
     }else trace?.cancel();
     operationQueue=operationQueue.then(()=>recorded?send('operation',{operationId:id,feature,stage,...(diagnostic?{diagnostic}:{})}):false).catch(()=>{});
   };
   // Bounded, allowlisted breadcrumbs attached to the same existing operation.
   finish.mark=step=>{if(!ended)try{return trace?.mark(step)===true}catch{return false}return false};
   finish.structure=flags=>{if(!ended)try{return trace?.structure(flags)===true}catch{return false}return false};
   return finish;
 };
 let pulsePending=false;
 setInterval(async()=>{
   const now=performance.now(),diff=(now-last)/1000;last=now;sampleUsage(now);
   if(diff<8||diff>30){activeSeconds=0;return}
   const seconds=Math.floor(activeSeconds);
   if(seconds<1||pulsePending)return;
   activeSeconds-=seconds;pulsePending=true;
   try{if(await ensureVisit())await send('pulse',{area:'editor',seconds});}
   finally{pulsePending=false;}
 },15000);
})();
