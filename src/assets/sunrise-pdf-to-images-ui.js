/* Sunrise PDF Editor — LOCAL-08 PDF -> PNG/JPG ZIP browser UI.
 * Uses existing Sunrise editor modal and PDF.js. Source-only, not integrated.
 */
(function (root) {
  'use strict';
  // Optional telemetry: local PDF work still runs without the telemetry script.
  const runTracked = typeof root.SunriseLocalMetrics?.track === 'function'
    ? root.SunriseLocalMetrics.track
    : (_feature, operation) => Promise.resolve().then(operation);
  if (!root?.document) return;
  const doc=root.document;
  const $=id=>doc.getElementById(id);
  const make=(tag,text,cls)=>{
    const e=doc.createElement(tag);
    if(text!==undefined)e.textContent=text;
    if(cls)e.className=cls;
    return e;
  };
  function notify(message){
    if(typeof root.showToast==='function')root.showToast(message,'fa-circle-exclamation');
    else root.console?.warn('[Sunrise PDF image export]',message);
  }
  function style(){
    if($('sunrisePdfToImagesStyle'))return;
    const s=make('style');s.id='sunrisePdfToImagesStyle';
    s.textContent=`
      .sun-pdf-image-drop {border:2px dashed var(--border,#c7d1da);border-radius:10px;min-height:75px;
        display:flex;align-items:center;justify-content:center;padding:12px;margin:9px 0;background:var(--surface-soft,#f7f9fb);cursor:pointer;}
      .sun-pdf-image-drop:focus-visible {outline:2px solid var(--primary,#1f6f9f);outline-offset:2px;}
      .sun-pdf-image-files {list-style:none;max-height:105px;overflow:auto;padding:0;margin:8px 0;}
      .sun-pdf-image-files li {padding:5px 8px;border-bottom:1px solid var(--border-soft,#dce3e9);overflow-wrap:anywhere;}
      .sun-pdf-image-options {display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:9px;margin:11px 0;}
      .sun-pdf-image-options label {display:block;margin-bottom:4px;font-size:12px;font-weight:600;}
      .sun-pdf-image-options select,.sun-pdf-image-options input {width:100%;min-height:42px;padding:8px;
        background:var(--surface,#fff);color:var(--text,#263746);border:1px solid var(--border,#c7d1da);border-radius:8px;}
      .sun-pdf-image-status {padding:11px;min-height:56px;line-height:1.55;border:1px solid var(--border,#c7d1da);
        background:var(--surface-soft,#f7f9fb);border-radius:8px;overflow-wrap:anywhere;}
      .sun-pdf-image-status progress {display:block;width:100%;margin-top:8px;}
      .sun-pdf-image-help {font-size:12px;line-height:1.6;color:var(--text-muted,#647687);margin:8px 0;}
      .sun-pdf-image-download {min-height:42px;margin:11px 0;padding:9px 12px;border:1px solid var(--primary,#1f6f9f);
        border-radius:8px;color:var(--text,#263746);background:var(--primary-soft,#dceaf5);cursor:pointer;}
      #sunrisePdfToImagesQuick {min-width:38px;min-height:38px;}
      @media(max-width:575px){.sun-pdf-image-options{grid-template-columns:1fr;}}
    `;
    doc.head.append(s);
  }
  function ready(){
    return typeof root.openModal==='function' && typeof root.closeModal==='function' &&
      typeof root.SunrisePdfToImages?.convert==='function' &&
      typeof root.pdfjsLib?.getDocument==='function' && typeof root.URL?.createObjectURL==='function';
  }
  function launch(){
    if(!ready()){notify('PDF.js 렌더러 또는 PDF 이미지 변환 기능이 아직 준비되지 않았습니다.');return;}
    style();
    root.openModal({title:'PDF를 이미지로 변환',icon:'fa-file-image',width:'710px',
      bodyHtml:`<p>여러 PDF를 선택해 각 페이지를 PNG 또는 JPG 이미지로 변환하고 하나의 ZIP으로 저장합니다. 문서는 서버에 업로드하지 않습니다.</p>
        <input id="sunPdfToImagesFile" type="file" multiple accept=".pdf,application/pdf" style="display:block;width:100%;margin:9px 0;">
        <div id="sunPdfToImagesDrop" role="button" tabindex="0" class="sun-pdf-image-drop" aria-label="PDF 파일을 이곳에 끌어놓거나 파일 선택 열기">PDF 1~5개를 이곳에 끌어놓거나 눌러서 선택</div>
        <ul id="sunPdfToImagesFiles" class="sun-pdf-image-files" aria-live="polite"></ul>
        <div class="sun-pdf-image-options">
          <div><label for="sunPdfToImagesFormat">이미지 형식</label><select id="sunPdfToImagesFormat"><option value="png">PNG (무손실)</option><option value="jpeg">JPG (압축)</option></select></div>
          <div><label for="sunPdfToImagesDpi">이미지 해상도 (DPI)</label><select id="sunPdfToImagesDpi"><option value="96">96 · 화면 공유</option><option value="150" selected>150 · 일반 문서</option><option value="200">200 · 상세 문서</option><option value="300">300 · 인쇄용</option></select></div>
          <div><label for="sunPdfToImagesPages">페이지 범위</label><input id="sunPdfToImagesPages" type="text" value="all" placeholder="all 또는 1-3,5,8" maxlength="250" autocomplete="off"></div>
          <div><label for="sunPdfToImagesQuality">JPG 품질: <output id="sunPdfToImagesQualityLabel">88%</output></label><input id="sunPdfToImagesQuality" type="range" min="50" max="100" value="88" step="1" disabled></div>
        </div>
        <p class="sun-pdf-image-help">페이지 범위는 모든 입력 파일에 동일하게 적용됩니다. 선택한 페이지 합계 최대 100쪽. 고해상도 페이지는 브라우저 메모리 보호를 위해 제한됩니다. PNG에는 JPG 품질 설정이 적용되지 않습니다.</p>
        <div class="sun-pdf-image-status"><div id="sunPdfToImagesStatus" role="status" aria-live="polite">PDF를 선택해 주세요.</div><progress id="sunPdfToImagesProgress" max="100" value="0" hidden></progress></div>
        <div id="sunPdfToImagesDownloads"></div>
        <p class="sun-pdf-image-help">텍스트 선택 기능이 없는 페이지 이미지가 만들어집니다. 이미지 추출(내장 원본 이미지만 추출)과 다른 기능이며 OCR은 수행하지 않습니다. 결과 ZIP에는 변환된 이미지가 포함됩니다.</p>`,
      footerHtml:`<div></div><div class="modal-footer-right"><button id="sunPdfToImagesStart" type="button" class="dialog-btn primary" disabled>이미지 변환</button><button id="sunPdfToImagesCancel" type="button" class="dialog-btn">닫기</button></div>`,
      onMount:()=>{
        const input=$('sunPdfToImagesFile'),drop=$('sunPdfToImagesDrop'),filesHost=$('sunPdfToImagesFiles');
        const format=$('sunPdfToImagesFormat'),dpi=$('sunPdfToImagesDpi'),pages=$('sunPdfToImagesPages');
        const quality=$('sunPdfToImagesQuality'),qualityLabel=$('sunPdfToImagesQualityLabel');
        const start=$('sunPdfToImagesStart'),cancel=$('sunPdfToImagesCancel');
        const progress=$('sunPdfToImagesProgress'),status=$('sunPdfToImagesStatus'),downloads=$('sunPdfToImagesDownloads');
        let files=[],running=false,controller=null,serial=0;
        const visible=()=>doc.contains(start) && $('modalBackdrop')?.classList.contains('open')!==false;
        const invalidate=()=>{serial++;downloads.replaceChildren();if(!running)status.textContent='옵션을 확인하고 이미지 변환을 누르세요.';};
        function displayFiles(){
          filesHost.replaceChildren();
          files.forEach((file,index)=>filesHost.append(make('li',`${index+1}. ${file.name} · ${(file.size/1048576).toFixed(1)}MiB`)));
          start.disabled=running||!files.length;
        }
        function selectFiles(items){
          if(running)return;
          const next=Array.from(items||[]);
          invalidate();files=next;
          try{root.SunrisePdfToImages.normalizeFiles(next);status.textContent=`${next.length}개 PDF 선택 완료. 옵션을 설정해 주세요.`;}
          catch(e){status.textContent=e.message||'PDF 파일을 확인해 주세요.';}
          displayFiles();
        }
        input.addEventListener('change',()=>selectFiles(input.files));
        drop.addEventListener('click',()=>{if(!running)input.click();});
        drop.addEventListener('keydown',event=>{
          if((event.key==='Enter'||event.key===' ')&&!running){event.preventDefault();input.click();}
        });
        drop.addEventListener('dragover',event=>{if(!running)event.preventDefault();});
        drop.addEventListener('drop',event=>{event.preventDefault();if(!running)selectFiles(event.dataTransfer?.files);});
        for(const control of [format,dpi,pages,quality])control.addEventListener('change',()=>{
          if(control===format)quality.disabled=control.value!=='jpeg';
          if(control===quality)qualityLabel.textContent=`${quality.value}%`;
          invalidate();
        });
        quality.addEventListener('input',()=>{qualityLabel.textContent=`${quality.value}%`;invalidate();});
        cancel.addEventListener('click',()=>{
          if(!running){root.closeModal();return;}
          controller?.abort();cancel.disabled=true;status.textContent='변환을 취소하고 있습니다. 부분 결과는 제공하지 않습니다.';
        });
        start.addEventListener('click',async()=>{
          if(running)return;
          let selected,settings;
          try{
            selected=root.SunrisePdfToImages.normalizeFiles(files);
            settings=root.SunrisePdfToImages.normalizeSettings({format:format.value,dpi:dpi.value,quality:Number(quality.value)/100,pages:pages.value});
          }catch(e){status.textContent=e?.message||'선택한 옵션을 확인해 주세요.';return;}
          running=true;const thisRun=++serial;controller=new AbortController();
          start.disabled=true;cancel.textContent='변환 취소';cancel.disabled=false;
          for(const control of [input,format,dpi,pages,quality])control.disabled=true;
          downloads.replaceChildren();progress.hidden=false;progress.value=0;
          const state={done:0};
          try{
            const result=await runTracked('local_pdf_to_images', () => root.SunrisePdfToImages.convert(selected,settings,{
              pdfjsLib:root.pdfjsLib,
              readFile:typeof root.readPdfInputFile==='function'?root.readPdfInputFile:undefined,
              createCanvas:()=>doc.createElement('canvas'),signal:controller.signal,
              onProgress:info=>{
                if(!visible()||controller.signal.aborted)return;
                state.done=Math.max(state.done,info.done||0);
                progress.max=Math.max(1,info.total||100);progress.value=state.done;
                const phase={opening:'PDF 파일 열기',rendering:'페이지 화면 변환',encoded:'이미지 저장',packing:'ZIP 묶기'}[info.phase]||'처리 중';
                status.textContent=`${phase} · ${state.done}쪽 완료${info.page?` · 현재 ${info.page}쪽`:''} · ${info.fileIndex?`파일 ${info.fileIndex}/${info.files}`:''}`;
              }
            }), () => controller.signal.aborted || !visible() || thisRun!==serial);
            if(controller.signal.aborted||!visible()||serial!==thisRun)return;
            const button=make('button',`ZIP 다운로드 · ${result.count}개 이미지 · ${(result.blob.size/1048576).toFixed(1)}MiB`,'sun-pdf-image-download');
            button.type='button';
            button.addEventListener('click',()=>{
              const url=root.URL.createObjectURL(result.blob);
              const anchor=make('a');anchor.href=url;anchor.download=result.outputName;
              doc.body.append(anchor);anchor.click();anchor.remove();
              root.setTimeout(()=>root.URL.revokeObjectURL(url),60_000);
            });
            downloads.append(button);
            status.textContent=`완료: PDF ${result.results.length}개에서 이미지 ${result.count}개를 만들었습니다. ZIP으로 별도 저장하세요.`;
          }catch(error){
            if(visible())status.textContent=error?.name==='AbortError'?'변환 취소 완료. 부분 파일은 저장하지 않았습니다.':error?.message||'이미지 변환에 실패했습니다.';
          }finally{
            running=false;controller=null;
            if(visible()){
              cancel.textContent='닫기';cancel.disabled=false;
              for(const control of [input,format,dpi,pages])control.disabled=false;
              quality.disabled=format.value!=='jpeg';
              progress.hidden=true;displayFiles();
            }
          }
        });
      }
    });
  }
  function mount(){
    style();
    const anchor=$('quickOpenBtn')||$('workspaceCommandBar');
    if(anchor&&!$('sunrisePdfToImagesQuick')){
      const button=make('button',undefined,'quick-icon-btn');button.id='sunrisePdfToImagesQuick';
      button.type='button';button.title='PDF를 PNG·JPG로';button.setAttribute('aria-label','PDF를 이미지로 변환');
      const icon=make('i',undefined,'fa-solid fa-file-image');icon.setAttribute('aria-hidden','true');button.append(icon);
      button.addEventListener('click',launch);
      if(anchor.id==='workspaceCommandBar')anchor.append(button);
      else anchor.insertAdjacentElement('afterend',button);
    }
    const mobile=$('mobFileBtn');
    if(mobile)mobile.addEventListener('click',()=>root.queueMicrotask?.(()=>{
      const menu=$('mobileFileMerge');if(!menu||$('sunrisePdfToImagesMobile'))return;
      const button=make('button','PDF를 이미지로','dialog-btn');button.id='sunrisePdfToImagesMobile';button.type='button';
      button.addEventListener('click',()=>{root.closeModal?.();launch();});
      menu.insertAdjacentElement('afterend',button);
    }));
    const landing=$('sunriseToolDirectoryLanding');
    if(landing&&!$('sunrisePdfToImagesLandingLink')){
      const link=make('a','PDF를 PNG/JPG 이미지로 변환 · ZIP 다운로드','sun-pdf-image-download');
      link.id='sunrisePdfToImagesLandingLink';link.href='/editor/?sunriseTool=pdf-to-images';
      link.style.display='block';link.style.textDecoration='none';
      landing.insertAdjacentElement('beforebegin',link);
    }
    if(!root.SunriseToolHub && new URLSearchParams(root.location?.search||'').get('sunriseTool')==='pdf-to-images'&&anchor){
      if(doc.readyState==='complete')root.setTimeout(launch,0);
      else root.addEventListener('load',()=>root.setTimeout(launch,0),{once:true});
    }
  }
  root.SunrisePdfToImagesLaunch=launch;
  if(doc.readyState==='loading')doc.addEventListener('DOMContentLoaded',mount,{once:true});
  else mount();
})(typeof window!=='undefined'?window:undefined);
