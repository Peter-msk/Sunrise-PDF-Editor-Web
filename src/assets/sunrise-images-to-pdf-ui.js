/* Sunrise PDF Editor — LOCAL-07 images -> PDF browser UI.
 * One image per page. JPEG/PNG embedded as-is where possible; WebP and
 * non-upright EXIF JPEG normalized by browser canvas, then embedded as PNG.
 * No uploads. Original files never altered. Integration/tests pending.
 */
(function (root) {
  'use strict';
  // B09: shared download validation / MIME handling; old bridge still works if absent.
  const downloadLocal = (...args) => typeof root.SunriseLocalUI?.download === 'function'
    ? root.SunriseLocalUI.download(...args) : root.downloadBytes(...args);
  // Optional telemetry: local PDF work still runs without the telemetry script.
  const runTracked = typeof root.SunriseLocalMetrics?.track === 'function'
    ? root.SunriseLocalMetrics.track
    : (_feature, operation) => Promise.resolve().then(operation);
  if (!root?.document) return;
  const doc = root.document;
  const $ = id => doc.getElementById(id);
  const make = (tag, content, cls) => {
    const el = doc.createElement(tag);
    if (content !== undefined) el.textContent = content;
    if (cls) el.className = cls;
    return el;
  };

  function notify(message) {
    if (typeof root.showToast === 'function') root.showToast(message, 'fa-circle-exclamation');
    else root.console?.warn('[Sunrise Images PDF]', message);
  }

  function style() {
    if ($('sunriseImagesPdfStyle')) return;
    const el = make('style');
    el.id = 'sunriseImagesPdfStyle';
    el.textContent = `
      .sun-images-order { list-style:none; max-height:250px; overflow:auto; border:1px solid var(--border,#c7d1da); border-radius:9px; margin:9px 0; padding:0; }
      .sun-images-order li { display:flex; align-items:center; gap:8px; padding:7px 9px; border-bottom:1px solid var(--border-soft,#dce3e9); }
      .sun-images-order li:last-child { border:0; }
      .sun-images-order li[draggable=true] { cursor:grab; }
      .sun-images-order .sun-image-name { flex:1; overflow-wrap:anywhere; min-width:0; }
      .sun-images-order .sun-image-number { min-width:23px; color:var(--text-muted,#647687); }
      .sun-images-order button { width:36px; height:36px; flex-shrink:0; border:1px solid var(--border,#c7d1da); border-radius:7px; background:var(--surface,#fff); cursor:pointer; }
      .sun-image-options { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:10px; margin:12px 0; }
      .sun-image-options label { font-size:12px; display:block; margin-bottom:5px; }
      .sun-image-options select,.sun-image-options input { width:100%; min-height:42px; padding:7px; border:1px solid var(--border,#c7d1da); border-radius:8px; background:var(--surface,#fff); color:var(--text,#263746); font-size:14px; }
      .sun-images-status { padding:10px; background:var(--surface-soft,#f7f9fb); border:1px solid var(--border,#c7d1da); border-radius:8px; min-height:45px; line-height:1.5; overflow-wrap:anywhere; }
      .sun-images-note { color:var(--text-muted,#647687); font-size:12px; line-height:1.6; margin:10px 0; }
      .sun-images-status progress { width:100%; margin-top:8px; }
      .sun-images-pdf-link { display:block; border:1px solid var(--border,#c7d1da); border-radius:10px; padding:14px; margin:10px 0 16px; background:var(--primary-soft,#dceaf5); text-decoration:none; color:var(--text,#263746); }
      @media(max-width:620px){ .sun-image-options { grid-template-columns:1fr; } .sun-images-order li { gap:4px; padding:6px; } }
    `;
    doc.head.append(el);
  }

  // Browser-local conversion is needed for WebP and EXIF-rotated JPEG.
  // createImageBitmap's from-image orientation avoids manually handling EXIF
  // transforms and keeps browser pixel decoding as the single source of truth.
  async function browserConvert(file) {
    if (typeof root.createImageBitmap !== 'function')
      throw new Error('이 브라우저는 사진 방향 보정/WebP 변환에 필요한 이미지 디코더를 지원하지 않습니다.');
    let bitmap;
    try {
      bitmap = await root.createImageBitmap(file, {imageOrientation:'from-image'});
      const width = bitmap.width, height = bitmap.height;
      if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) ||
          width < 1 || height < 1 || width > 32767 || height > 32767 ||
          width * height > 48000000)
        throw new Error('브라우저에서 변환할 이미지 해상도가 너무 큽니다. 원본 해상도를 낮춘 후 다시 시도하세요.');
      const canvas = doc.createElement('canvas');
      try {
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('이미지 변환에 필요한 Canvas 컨텍스트를 생성하지 못했습니다.');
        ctx.drawImage(bitmap, 0, 0);
        const blob = await new Promise((resolve, reject) => {
          canvas.toBlob(b => b ? resolve(b) : reject(new Error('이미지를 PNG로 변환하지 못했습니다.')), 'image/png');
        });
        if (blob.size > (root.SunriseImagesToPdf?.MAX_IMAGE_BYTES || 32 * 1024 * 1024))
          throw new Error('변환된 PNG 용량이 32MB를 초과했습니다. 원본 이미지 크기를 줄여 주세요.');
        return new Uint8Array(await blob.arrayBuffer());
      } finally {
        canvas.width = canvas.height = 0; // release graphics storage even on encode errors.
      }
    } finally { bitmap?.close?.(); }
  }

  function launch() {
    if (!root.SunriseImagesToPdf?.create || !root.PDFLib?.PDFDocument ||
        typeof root.openModal !== 'function' || typeof root.closeModal !== 'function' ||
        typeof root.downloadBytes !== 'function') {
      notify('이미지 PDF 변환 모듈 또는 편집기 연결을 확인해 주세요.');
      return;
    }
    style();
    root.openModal({
      title:'이미지를 PDF로',icon:'fa-images',width:'780px',
      bodyHtml:`<p>JPG·PNG·WebP 이미지를 선택한 순서대로 PDF 한 파일로 묶습니다. 이미지는 서버로 전송하지 않습니다.</p>
        <label for="sunImagesInput">이미지 파일 선택 (최대 60개 · 파일당 32MB · 합계 120MB)</label>
        <input id="sunImagesInput" type="file" accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp" multiple style="display:block;width:100%;margin:9px 0;min-height:44px">
        <p class="sun-images-note">파일 순서는 아래의 ↑ ↓ 버튼으로 변경할 수 있습니다. 데스크톱에서는 드래그로도 순서를 바꿀 수 있습니다.</p>
        <ol id="sunImagesOrder" class="sun-images-order" aria-label="PDF 이미지 페이지 순서"></ol>
        <div class="sun-image-options">
          <div><label for="sunImagesSize">페이지 크기</label><select id="sunImagesSize"><option value="a4">A4</option><option value="letter">Letter</option><option value="original">이미지 크기(96dpi 기준)</option></select></div>
          <div><label for="sunImagesOrientation">페이지 방향</label><select id="sunImagesOrientation"><option value="auto">이미지에 맞춤</option><option value="portrait">세로</option><option value="landscape">가로</option></select></div>
          <div><label for="sunImagesMargin">여백 (mm, 0~40)</label><input id="sunImagesMargin" type="number" min="0" max="40" step="1" value="8"></div>
        </div>
        <div id="sunImagesStatus" class="sun-images-status" role="status" aria-live="polite">이미지를 선택해 주세요.<progress id="sunImagesProgress" value="0" max="1" hidden></progress></div>
        <div id="sunImagesDownload"></div>
        <p class="sun-images-note">JPG/PNG는 가능하면 원본 이미지를 그대로 포함합니다. WebP 및 회전 정보가 있는 JPEG는 브라우저에서 PNG로 바꿀 수 있어 용량이 커질 수 있습니다. HEIC·GIF·TIFF·SVG는 현재 지원하지 않습니다.</p>`,
      footerHtml:`<div></div><div class="modal-footer-right">
        <button id="sunImagesMake" class="dialog-btn primary" type="button" disabled>PDF 만들기</button>
        <button id="sunImagesCancel" class="dialog-btn" type="button">닫기</button>
      </div>`,
      onMount:() => {
        const input = $('sunImagesInput'), list = $('sunImagesOrder'), status = $('sunImagesStatus');
        const progress = $('sunImagesProgress'), makeButton = $('sunImagesMake');
        const cancel = $('sunImagesCancel'), download = $('sunImagesDownload');
        const size = $('sunImagesSize'), orientation = $('sunImagesOrientation'), margin = $('sunImagesMargin');
        let files = [], validSelection = false, running = false, stopped = false, serial = 0;
        const visible = () => doc.contains(makeButton);
        const invalidate = () => { serial++; download.replaceChildren(); status.firstChild && (status.firstChild.textContent = '설정을 확인하고 PDF 만들기를 누르세요.'); };
        const redraw = () => {
          list.replaceChildren();
          files.forEach((file,index) => {
            const row = make('li');row.draggable = !running;
            const num = make('span',String(index+1),'sun-image-number');
            const name = make('span',file.name,'sun-image-name');
            const up = make('button','↑');const down = make('button','↓');
            up.type = down.type = 'button';
            up.title = '이전으로 이동';down.title = '다음으로 이동';
            up.setAttribute('aria-label',`${file.name} 위로 이동`);
            down.setAttribute('aria-label',`${file.name} 아래로 이동`);
            up.disabled = running || index===0;down.disabled = running || index===files.length-1;
            const move = (from,to) => {
              if (running || from===to || to<0 || to>=files.length) return;
              const [item] = files.splice(from,1);files.splice(to,0,item);
              invalidate();redraw();
            };
            up.addEventListener('click',()=>move(index,index-1));
            down.addEventListener('click',()=>move(index,index+1));
            row.addEventListener('dragstart',ev => {
              if (running) { ev.preventDefault(); return; }
              ev.dataTransfer?.setData('text/plain',String(index));
            });
            row.addEventListener('dragover',ev => { if (!running) ev.preventDefault(); });
            row.addEventListener('drop',ev => {
              ev.preventDefault();
              const from=Number(ev.dataTransfer?.getData('text/plain'));
              if (Number.isInteger(from)) move(from,index);
            });
            row.append(num,name,up,down);list.append(row);
          });
          makeButton.disabled = running || !validSelection;
        };
        input.addEventListener('change', () => {
          if (running) return;
          files = Array.from(input.files || []);
          download.replaceChildren();serial++;validSelection=false;
          try {
            root.SunriseImagesToPdf.normalizeFiles(files);
            validSelection=true;
            status.firstChild.textContent = `${files.length}개 이미지가 선택되었습니다.`;
          } catch (error) { status.firstChild.textContent = error?.message || '이미지를 확인해 주세요.'; }
          redraw();
        });
        for (const control of [size,orientation,margin]) control.addEventListener('change',invalidate);
        cancel.addEventListener('click',()=>{
          if (!running) { root.closeModal();return; }
          stopped=true;cancel.disabled=true;
          status.firstChild.textContent='취소를 요청했습니다. 현재 처리 중인 이미지가 끝나면 중단됩니다.';
        });
        makeButton.addEventListener('click',async()=>{
          if (running) return;
          let selected, settings;
          try {
            selected=root.SunriseImagesToPdf.normalizeFiles(files);
            settings=root.SunriseImagesToPdf.normalizeSettings({page:size.value,orientation:orientation.value,marginMm:margin.value});
          } catch(error) { status.firstChild.textContent=error?.message||'입력값을 확인해 주세요.';return; }
          const runSerial=++serial;
          running=true;stopped=false;makeButton.disabled=true;cancel.textContent='작업 취소';
          input.disabled=size.disabled=orientation.disabled=margin.disabled=true;
          download.replaceChildren();progress.hidden=false;progress.max=selected.length;progress.value=0;
          redraw();
          try {
            const output = await runTracked('local_images_to_pdf', () => root.SunriseImagesToPdf.create(selected,settings,{
              PDFLib:root.PDFLib,browserConvert,
              cancelled:()=>stopped||!visible()||runSerial!==serial,
              onProgress:({done,total,name,phase})=>{
                if (!visible()||stopped) return;
                progress.value=done;
                const phaseText={reading:'파일 읽기',converting:'방향/형식 변환',embedding:'PDF 페이지 생성',done:'페이지 작성',saving:'PDF 저장',verifying:'저장 결과 확인'}[phase]||phase;
                status.firstChild.textContent=`${done}/${total}장 · ${name||''} · ${phaseText}`;
              }
            }), () => stopped || !visible() || runSerial!==serial);
            if (stopped||!visible()||runSerial!==serial) return;
            const downloadButton=make('button',`PDF 다운로드 (${output.pages}쪽)`,'dialog-btn primary');
            downloadButton.type='button';
            downloadButton.addEventListener('click',()=>downloadLocal(output.bytes,output.outputName));
            download.append(downloadButton);
            status.firstChild.textContent=`${output.pages}쪽 PDF를 생성하고 페이지 수·크기를 재열기 확인했습니다. 다운로드 버튼으로 별도 저장하세요.`;
          } catch(error) {
            if (visible()) status.firstChild.textContent = error?.name==='AbortError'?
              '취소되었습니다. 부분 PDF는 제공하지 않습니다.':error?.message||'PDF를 생성하지 못했습니다.';
          } finally {
            running=false;
            if (visible()) {
              input.disabled=size.disabled=orientation.disabled=margin.disabled=false;
              cancel.disabled=false;cancel.textContent='닫기';
              progress.hidden=true;redraw();
            }
          }
        });
      }
    });
  }

  function mount() {
    style();
    const anchor = $('quickOpenBtn') || $('workspaceCommandBar');
    if (anchor && !$('sunriseImagesPdfQuick')) {
      const button = make('button',undefined,'quick-icon-btn');
      button.id='sunriseImagesPdfQuick';button.type='button';
      button.title='이미지를 PDF로';button.setAttribute('aria-label','이미지를 PDF로');
      const icon = make('i',undefined,'fa-solid fa-images');icon.setAttribute('aria-hidden','true');
      button.append(icon);button.addEventListener('click',launch);
      if (anchor.id==='workspaceCommandBar') anchor.append(button);
      else anchor.insertAdjacentElement('afterend',button);
    }
    const mob=$('mobFileBtn');
    if (mob) mob.addEventListener('click',()=>root.queueMicrotask?.(()=>{
      const menu=$('mobileFileMerge');
      if (!menu||$('sunriseImagesPdfMobile')) return;
      const button=make('button','이미지를 PDF로','dialog-btn');
      button.type='button';button.id='sunriseImagesPdfMobile';
      button.addEventListener('click',()=>{root.closeModal();launch();});
      menu.insertAdjacentElement('afterend',button);
    }));
    const listing=$('sunriseToolDirectoryLanding');
    if (listing&&!$('sunriseImagesPdfLandingLink')) {
      const link=make('a','이미지를 PDF로 변환 · JPG / PNG / WebP','sun-images-pdf-link');
      link.id='sunriseImagesPdfLandingLink';
      link.href='/editor/?sunriseTool=images-to-pdf';
      listing.insertAdjacentElement('beforebegin',link);
    }
    const selected=new URLSearchParams(root.location?.search||'').get('sunriseTool');
    if (selected==='images-to-pdf' && anchor && !root.SunriseToolHub) {
      root.addEventListener('load',()=>root.setTimeout(launch,0),{once:true});
      if (doc.readyState==='complete') root.setTimeout(launch,0);
    }
  }
  root.SunriseImagesToPdfLaunch=launch;
  if (doc.readyState==='loading') doc.addEventListener('DOMContentLoaded',mount,{once:true});
  else mount();
})(typeof window!=='undefined'?window:undefined);
