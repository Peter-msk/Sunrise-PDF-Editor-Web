/* Sunrise PDF Editor — LOCAL-12 visual PDF comparison.
 * Browser-only pixel comparison through the project's PDF.js renderer.
 * Visual differences are NOT semantic edits, OCR, signature validation,
 * metadata comparison, or a proof that visually identical PDFs are equivalent.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.SunrisePdfVisualCompare = api;
})(typeof globalThis !== 'undefined' ? globalThis : undefined, function () {
  'use strict';

  const MAX_PAGES = 60;
  const MAX_SOURCE_BYTES = 120 * 1024 * 1024;
  // Keep accumulated PNG buffers below the shared 256MiB ZIP limit before
  // the final pack step. Reserve space for reports, ZIP headers and the browser.
  const MAX_REPORT_IMAGE_BYTES = 240 * 1024 * 1024;
  const MAX_CANVAS_PIXELS = 8_000_000;
  const MAX_CANVAS_SIDE = 8192;
  const DPI = Object.freeze([72, 96, 144, 200]);
  const encoder = new TextEncoder();

  function abortError() {
    const error = new Error('PDF 비교가 취소되었습니다. 부분 결과는 제공하지 않습니다.');
    error.name = 'AbortError';
    return error;
  }
  function checkCancel(opts) {
    if (opts?.signal?.aborted || opts?.cancelled?.()) throw abortError();
  }
  function fileCheck(file, label) {
    if (!file || typeof file.name !== 'string' || !/\.pdf$/i.test(file.name) ||
        !Number.isSafeInteger(file.size) || file.size <= 0 ||
        typeof file.arrayBuffer !== 'function')
      throw new Error(`${label} PDF를 올바르게 선택해 주세요.`);
    return file;
  }
  function normalizeSettings(raw) {
    const data = raw || {};
    const dpi = data.dpi === undefined ? 96 : Number(data.dpi);
    const tolerance = data.tolerance === undefined ? 28 : Number(data.tolerance);
    const pages = String(data.pages ?? 'all').trim().toLowerCase();
    const createImages = data.createImages !== false;
    if (!DPI.includes(dpi)) throw new Error('비교 해상도는 72/96/144/200 DPI 중에서 선택해 주세요.');
    if (!Number.isSafeInteger(tolerance) || tolerance < 0 || tolerance > 96)
      throw new Error('픽셀 색상 허용 오차는 0~96 사이의 정수여야 합니다.');
    if (pages.length > 200 || (pages !== 'all' && !/^[0-9\s,-]+$/.test(pages)))
      throw new Error('페이지는 all 또는 1-4,7,9 형식으로 입력해 주세요.');
    return Object.freeze({dpi, tolerance, pages, createImages});
  }
  function parsePageNumbers(selection, total) {
    if (!Number.isSafeInteger(total) || total < 1) throw new Error('두 PDF의 페이지 수가 올바르지 않습니다.');
    if (selection === 'all') {
      if (total > MAX_PAGES) throw new Error(`한 번에 최대 ${MAX_PAGES}쪽만 비교합니다. 비교 범위를 선택해 주세요.`);
      return Array.from({length: total}, (_, index) => index + 1);
    }
    const pages = [];
    const seen = new Set();
    for (const range of selection.split(',')) {
      const match = /^\s*(\d+)\s*(?:-\s*(\d+)\s*)?$/.exec(range);
      if (!match) throw new Error('페이지 범위는 1-3,5,7 형식으로 입력해 주세요.');
      const start = Number(match[1]);
      const end = match[2] === undefined ? start : Number(match[2]);
      if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 1 ||
          end < start || end > total) throw new Error(`페이지 범위 ${range.trim()}가 1~${total}쪽을 벗어납니다.`);
      if (end - start + 1 > MAX_PAGES) throw new Error(`한 번에 최대 ${MAX_PAGES}쪽까지 비교할 수 있습니다.`);
      for (let page = start; page <= end; page++) {
        if (!seen.has(page)) { seen.add(page); pages.push(page); }
        if (pages.length > MAX_PAGES) throw new Error(`비교 페이지는 최대 ${MAX_PAGES}쪽입니다.`);
      }
    }
    if (!pages.length) throw new Error('비교할 페이지를 선택해 주세요.');
    return pages;
  }
  async function readBytes(file, opts) {
    checkCancel(opts);
    const raw = typeof opts.readFile === 'function' ? await opts.readFile(file) : await file.arrayBuffer();
    checkCancel(opts);
    const bytes = raw instanceof ArrayBuffer ? new Uint8Array(raw) : raw;
    if (!(bytes instanceof Uint8Array) || bytes.byteLength !== file.size || !bytes.length)
      throw new Error(`${file.name}: PDF 바이트를 온전히 읽지 못했습니다.`);
    // PDF.js can transfer its input ArrayBuffer to a worker and detach it.
    return new Uint8Array(bytes);
  }
  function pageDimensions(page, dpi) {
    const viewport = page.getViewport({scale: dpi / 72});
    const width = Math.ceil(viewport.width);
    const height = Math.ceil(viewport.height);
    if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) ||
        width < 1 || height < 1 || width > MAX_CANVAS_SIDE || height > MAX_CANVAS_SIDE ||
        width * height > MAX_CANVAS_PIXELS)
      throw new Error(`${width}×${height}px 페이지가 렌더링 보호 한도를 초과합니다. DPI를 낮춰 주세요.`);
    return {viewport, width, height};
  }
  function prepareCanvas(canvas, width, height) {
    if (!canvas || typeof canvas.getContext !== 'function') throw new Error('Canvas를 생성할 수 없습니다.');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d', {willReadFrequently: true, alpha: false});
    if (!context) throw new Error('Canvas 2D 이미지 처리가 지원되지 않습니다.');
    context.fillStyle = '#fff';
    context.fillRect(0, 0, width, height);
    return context;
  }
  async function renderPage(page, viewport, canvas, opts) {
    checkCancel(opts);
    const context = prepareCanvas(canvas, Math.ceil(viewport.width), Math.ceil(viewport.height));
    const task = page.render({canvasContext: context, viewport, background: 'rgb(255,255,255)'});
    const onAbort = () => { try {task.cancel();} catch { /* already completed */ } };
    opts.signal?.addEventListener('abort', onAbort, {once:true});
    if (opts.signal?.aborted) onAbort();
    try {
      await task.promise;
      checkCancel(opts);
      return context.getImageData(0, 0, canvas.width, canvas.height);
    } catch (error) {
      if (opts.signal?.aborted || opts.cancelled?.()) throw abortError();
      throw error;
    } finally {
      opts.signal?.removeEventListener('abort', onAbort);
    }
  }
  function diffPixels(imageA, imageB, tolerance, createImage = true) {
    if (imageA.width !== imageB.width || imageA.height !== imageB.height)
      throw new Error('비교할 페이지의 렌더링 크기가 다릅니다.');
    const {width, height} = imageA;
    const a = imageA.data, b = imageB.data;
    const output = createImage ? new Uint8ClampedArray(a.length) : null;
    let different = 0;
    let minX = width, minY = height, maxX = -1, maxY = -1;
    for (let pixel = 0; pixel < width * height; pixel++) {
      const p = pixel * 4;
      const delta = Math.max(Math.abs(a[p] - b[p]), Math.abs(a[p + 1] - b[p + 1]),
        Math.abs(a[p + 2] - b[p + 2]));
      if (delta > tolerance) {
        different++;
        const x = pixel % width, y = Math.floor(pixel / width);
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
      if (output) {
        // The right-hand document is drawn in pale grayscale; changed pixels in red.
        const grayscale = Math.round((b[p] * 0.299 + b[p + 1] * 0.587 + b[p + 2] * 0.114) * 0.35 + 165);
        output[p] = delta > tolerance ? 237 : grayscale;
        output[p + 1] = delta > tolerance ? 52 : grayscale;
        output[p + 2] = delta > tolerance ? 58 : grayscale;
        output[p + 3] = 255;
      }
    }
    const total = width * height;
    return {width, height, differentPixels: different, totalPixels: total,
      percent: 100 * different / total,
      bounds: different ? {x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1} : null,
      data: output};
  }
  function pngBlob(canvas) {
    return new Promise((resolve, reject) => {
      if (typeof canvas.toBlob !== 'function') return reject(new Error('PNG 이미지 저장 기능이 지원되지 않습니다.'));
      canvas.toBlob(blob => blob?.size && (!blob.type || blob.type === 'image/png')
        ? resolve(blob) : reject(new Error('차이 강조 PNG를 생성하지 못했습니다.')), 'image/png');
    });
  }
  const simpleName = name => String(name).replace(/^.*[\\/]/, '').replace(/[\u0000-\u001f\u007f]/g, '_').slice(0, 150);
  function safeCsvCell(value) {
    let raw = String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, 1800);
    if (/^[\s\u200b-\u200d\ufeff]*[=+\-@]/u.test(raw)) raw = "'" + raw;
    return '"' + raw.replace(/"/g, '""') + '"';
  }
  function makeCsv(report) {
    const rows = [
      ['구분','페이지','결과','차이 픽셀','비교 픽셀','차이 비율(%)','이미지 폭(px)','이미지 높이(px)','설명'],
      ['기준 PDF','','','','','','','',report.sources[0].fileName],
      ['비교 PDF','','','','','','','',report.sources[1].fileName],
      ['요약','','동일',report.summary.same,'','','','',''],
      ['요약','','차이 감지',report.summary.different,'','','','',''],
      ['요약','','크기 다름',report.summary.geometry,'','','','',''],
      ['요약','','페이지 없음',report.summary.missing,'','','','',''],
      ...report.rows.map(row => ['페이지',row.page, row.status, row.differentPixels ?? '', row.totalPixels ?? '',
        row.percent === null ? '' : row.percent.toFixed(4), row.width ?? '', row.height ?? '', row.note ?? ''])
    ];
    return '\ufeff' + rows.map(row => row.map(safeCsvCell).join(',')).join('\r\n') + '\r\n';
  }
  function makeReport(files, settings, rows, sourcePages) {
    const totals = {same:0, different:0, geometry:0, missing:0};
    for (const row of rows) totals[row.status]++;
    return {
      format: 'Sunrise Visual PDF Compare v1',
      createdAt: new Date().toISOString(),
      sources: files.map((file, i) => ({fileName:simpleName(file.name), fileSize:file.size, pages:sourcePages[i]})),
      settings, pageCountCompared:rows.length, summary:totals, rows,
      limitations:'픽셀 시각 비교이며 콘텐츠 의미·텍스트 변경 내역·OCR·암호·서명·첨부·메타데이터·접근성 동등성을 검증하지 않습니다. 화면 렌더링, 글꼴 및 안티앨리어싱 차이로 오차가 발생할 수 있습니다.'
    };
  }
  async function convert(fileA, fileB, rawSettings, opts) {
    const files=[fileCheck(fileA,'원본'),fileCheck(fileB,'비교 대상')];
    if (!Number.isSafeInteger(files[0].size + files[1].size) ||
        files[0].size + files[1].size > MAX_SOURCE_BYTES)
      throw new Error('두 PDF의 합산 크기는 최대 120MiB까지 지원합니다.');
    const settings=normalizeSettings(rawSettings);
    if (!opts?.pdfjsLib?.getDocument || typeof opts.createCanvas !== 'function')
      throw new Error('기존 PDF.js 렌더러 또는 Canvas 기능이 준비되지 않았습니다.');
    if (typeof opts.createZip !== 'function')
      throw new Error('LOCAL-08 Sunrise ZIP 유틸리티가 필요합니다.');
    checkCancel(opts);
    const tasks=[],docs=[];
    const onAbort=()=>tasks.forEach(task=>{try{void Promise.resolve(task.destroy()).catch(()=>{});}catch{/* closed */}});
    opts.signal?.addEventListener('abort',onAbort,{once:true});
    try {
      for (let i=0; i<files.length; i++) {
        checkCancel(opts);
        const bytes=await readBytes(files[i],opts);
        const task=opts.pdfjsLib.getDocument({data:bytes,useSystemFonts:true});
        tasks.push(task);
        if (opts.signal?.aborted) onAbort();
        try {docs.push(await task.promise);} catch (error) {
          if (opts.signal?.aborted || opts.cancelled?.()) throw abortError();
          throw new Error(`${files[i].name}: PDF를 열지 못했습니다. ${error?.message || ''}`);
        }
      }
      const maxPages=Math.max(docs[0].numPages, docs[1].numPages);
      const pages=parsePageNumbers(settings.pages,maxPages);
      const images=[],rows=[];
      let accumulatedImageBytes=0;
      const canvasA=opts.createCanvas(),canvasB=opts.createCanvas(),canvasDiff=opts.createCanvas();
      try {
        for (let index=0; index<pages.length; index++) {
          checkCancel(opts);
          const pageNo=pages[index];
          opts.onProgress?.({stage:'page',page:pageNo,done:index,total:pages.length});
          if (pageNo>docs[0].numPages || pageNo>docs[1].numPages) {
            rows.push({page:pageNo,status:'missing',differentPixels:null,totalPixels:null,percent:null,
              note:pageNo>docs[0].numPages?'원본에 해당 페이지가 없습니다.':'비교 대상에 해당 페이지가 없습니다.'});
            opts.onProgress?.({stage:'done',page:pageNo,done:index+1,total:pages.length});
            await new Promise(resolve=>setTimeout(resolve,0));
            continue;
          }
          let pageA, pageB;
          try {
            pageA=await docs[0].getPage(pageNo);
            pageB=await docs[1].getPage(pageNo);
            checkCancel(opts);
            const a=pageDimensions(pageA,settings.dpi),b=pageDimensions(pageB,settings.dpi);
            if (a.width!==b.width || a.height!==b.height ||
                Math.abs(a.viewport.width-b.viewport.width)>0.5 ||
                Math.abs(a.viewport.height-b.viewport.height)>0.5) {
              rows.push({page:pageNo,status:'geometry',differentPixels:null,totalPixels:null,percent:null,
                width:a.width,height:a.height,
                note:`페이지 표시 크기 불일치: 원본 ${a.width}×${a.height}px / 비교 ${b.width}×${b.height}px. 이미지 픽셀 비교는 수행하지 않았습니다.`});
            } else {
              const imageA=await renderPage(pageA,a.viewport,canvasA,opts);
              const imageB=await renderPage(pageB,b.viewport,canvasB,opts);
              checkCancel(opts);
              const diff=diffPixels(imageA,imageB,settings.tolerance,settings.createImages);
              const changed=diff.differentPixels>0;
              const name=changed&&settings.createImages ? `diff_page_${String(pageNo).padStart(4,'0')}.png`:null;
              if (name) {
                const ctx=prepareCanvas(canvasDiff,diff.width,diff.height);
                ctx.putImageData(new ImageData(diff.data,diff.width,diff.height),0,0);
                const blob=await pngBlob(canvasDiff);
                checkCancel(opts);
                // Reject oversized output BEFORE allocating another ArrayBuffer.
                if (blob.size > MAX_REPORT_IMAGE_BYTES-accumulatedImageBytes)
                  throw new Error('비교 이미지 ZIP이 브라우저 메모리 보호 한도를 초과합니다. DPI 또는 페이지 범위를 줄여 주세요.');
                const bytes=new Uint8Array(await blob.arrayBuffer());
                checkCancel(opts);
                if (bytes.byteLength !== blob.size)
                  throw new Error('비교 이미지가 완전하게 읽히지 않았습니다.');
                accumulatedImageBytes += bytes.byteLength;
                images.push({name,bytes});
              }
              rows.push({page:pageNo,status:changed?'different':'same',
                width:diff.width,height:diff.height,differentPixels:diff.differentPixels,
                totalPixels:diff.totalPixels,percent:diff.percent,bounds:diff.bounds,
                image:name,note:changed?'차이 강조 PNG: 빨간색 픽셀이 허용 오차 초과 구간입니다.':'선택 허용 오차 범위에서 픽셀 차이가 없습니다.'});
            }
          } finally {
            try {pageA?.cleanup?.();} catch { /* already disposed */ }
            try {pageB?.cleanup?.();} catch { /* already disposed */ }
            // Drop large canvas backing stores before moving to the next page.
            canvasA.width=canvasA.height=0;
            canvasB.width=canvasB.height=0;
            canvasDiff.width=canvasDiff.height=0;
          }
          opts.onProgress?.({stage:'done',page:pageNo,done:index+1,total:pages.length});
          await new Promise(resolve=>setTimeout(resolve,0));
        }
      } finally {
        for (const canvas of [canvasA,canvasB,canvasDiff]) {
          try {canvas.width=canvas.height=0;} catch {/* browser disposing */}
        }
      }
      checkCancel(opts);
      const report=makeReport(files,settings,rows,docs.map(doc=>doc.numPages));
      const json=JSON.stringify(report,null,2)+'\n';
      const csv=makeCsv(report);
      const entries=[{name:'comparison_report.json',bytes:encoder.encode(json)},
        {name:'comparison_report.csv',bytes:encoder.encode(csv)},...images];
      opts.onProgress?.({stage:'packing',done:pages.length,total:pages.length});
      const blob=opts.createZip(entries);
      checkCancel(opts);
      return {report,blob,fileName:'Sunrise_PDF_Visual_Comparison.zip',imageCount:images.length};
    } finally {
      opts.signal?.removeEventListener('abort',onAbort);
      for (const task of tasks) {try{await task.destroy();}catch{/* already destroyed */}}
    }
  }
  return {convert,normalizeSettings,parsePageNumbers,diffPixels,makeCsv,
    MAX_PAGES,MAX_SOURCE_BYTES,MAX_CANVAS_PIXELS,DPI};
});
