/* Sunrise LOCAL operations telemetry. No document content, names or input values.
 * Run only for actual PDF processing, not for opening a tool dialog.
 * Success means an output/report was produced in memory, NOT downloaded.
 * The existing anonymous telemetry sender remains the only network owner.
 */
(function(root){
  'use strict';
  const features=new Set(["local_page_compose", "local_form_edit", "local_stamp", "local_metadata", "local_batch_preflight", "local_images_to_pdf", "local_pdf_to_images", "local_page_crop", "local_page_resize", "local_nup", "local_pdf_overlay", "local_visual_compare"]);
  function track(feature, job, isCancelled){
    if(!features.has(feature) || typeof job!=='function')
      throw new TypeError('지원되지 않는 작업 계측 요청입니다.');
    // Analytics are best-effort: an unavailable/broken sender must not break PDF work.
    let finish=()=>{};
    try{
      const sender=root.sunriseTelemetryOperationStart;
      if(typeof sender==='function'){
        const callback=sender(feature);
        if(typeof callback==='function')finish=callback;
      }
    }catch{/* local action still proceeds */}
    const mark=step=>{try{finish.mark?.(step)}catch{/* non-critical diagnostics */}};
    let ended=false;
    const complete=stage=>{
      if(ended)return;
      ended=true;
      try{finish(stage)}catch{/* telemetry is never a PDF operation dependency */}
    };
    const cancelled=()=>{
      try{return Boolean(isCancelled?.())}catch{return true}
    };
    // Call the handler inside the tracker so synchronous PDF engine exceptions
    // also produce a terminal status and do not create a dangling 'started'.
    return Promise.resolve().then(()=>{mark('input_ok');mark('engine_start');return job()}).then(result=>{
      mark('engine_ok');complete(cancelled()?'cancelled':'succeeded');
      return result;
    },error=>{
      if(!cancelled()&&error?.name!=='AbortError')mark('engine_failed');
      complete(cancelled()||error?.name==='AbortError'?'cancelled':'failed');
      throw error;
    });
  }
  root.SunriseLocalMetrics=Object.freeze({track, featureIds:Object.freeze([...features])});
})(typeof window!=='undefined'?window:globalThis);
