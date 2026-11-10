/* Sunrise PDF Editor — LOCAL-08, PDF page rendering to PNG/JPEG ZIP.
 * Reuses PDF.js, requires no OCR or server upload. Source-only development.
 * The output ZIP holds rasterized pages, not embedded source images.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.SunrisePdfToImages = api;
})(typeof globalThis !== 'undefined' ? globalThis : undefined, function () {
  'use strict';

  const MAX_FILES = 5;
  const MAX_INPUT_FILE_BYTES = 60 * 1024 * 1024;
  const MAX_TOTAL_INPUT_BYTES = 120 * 1024 * 1024;
  const MAX_OUTPUT_PAGES = 100;
  const MAX_CANVAS_PIXELS = 24_000_000;
  const MAX_CANVAS_SIDE = 16_384;
  const MAX_ZIP_BYTES = 256 * 1024 * 1024; // Browser memory guard; not an input MB quota.
  const DPI_OPTIONS = Object.freeze([96, 150, 200, 300]);
  const MAX_FILE_NAME = 240;
  const UTF8_FLAG = 0x0800;
  const encoder = new TextEncoder();

  function abortError() {
    const e = new Error('PDF 이미지 변환을 취소했습니다. 부분 ZIP을 제공하지 않습니다.');
    e.name = 'AbortError';
    return e;
  }
  function checkCancel(opts) {
    if (opts?.signal?.aborted || opts?.cancelled?.()) throw abortError();
  }
  function normalizeFiles(input) {
    if (!input || typeof input[Symbol.iterator] !== 'function')
      throw new Error('PDF 파일을 선택해 주세요.');
    const files = Array.from(input);
    if (files.length < 1 || files.length > MAX_FILES)
      throw new Error(`한 번에 PDF 1~${MAX_FILES}개를 선택해 주세요.`);
    let total = 0;
    for (const [i, f] of files.entries()) {
      if (!f || typeof f.name !== 'string' || !f.name.trim() || f.name.length > MAX_FILE_NAME ||
        !/\.pdf$/i.test(f.name) || !Number.isSafeInteger(f.size) || f.size <= 0 ||
        typeof f.arrayBuffer !== 'function')
        throw new Error(`${i + 1}번째 PDF 파일의 이름·크기 또는 읽기 기능이 올바르지 않습니다.`);
      if (f.size > MAX_INPUT_FILE_BYTES)
        throw new Error(`${i + 1}번째 PDF는 최대 60MiB까지 변환할 수 있습니다.`);
      if (!Number.isSafeInteger(total + f.size) || total + f.size > MAX_TOTAL_INPUT_BYTES)
        throw new Error('선택한 PDF의 합산 파일 크기는 최대 120MiB입니다.');
      total += f.size;
    }
    return files;
  }
  function normalizeSettings(input) {
    const s = input || {};
    const format = s.format || 'png';
    const dpi = s.dpi === undefined ? 150 : Number(s.dpi);
    const quality = s.quality === undefined ? 0.88 : Number(s.quality);
    const range = String(s.pages === undefined ? 'all' : s.pages).trim();
    if (!['png', 'jpeg'].includes(format)) throw new Error('출력 형식은 PNG 또는 JPG여야 합니다.');
    if (!DPI_OPTIONS.includes(dpi)) throw new Error('DPI는 96, 150, 200, 300 중에서 선택해 주세요.');
    if (!Number.isFinite(quality) || quality < 0.5 || quality > 1)
      throw new Error('JPG 품질은 50~100% 사이로 선택해 주세요.');
    if (range.length > 250 || (!range || (range.toLowerCase() !== 'all' && !/^[\d\s,-]+$/.test(range))))
      throw new Error('페이지 범위는 전체 또는 1-3,5,7처럼 입력해 주세요.');
    return Object.freeze({format, dpi, quality, pages: range.toLowerCase()});
  }
  function parsePages(range, pageCount) {
    if (!Number.isSafeInteger(pageCount) || pageCount < 1) throw new Error('페이지 수를 확인할 수 없습니다.');
    if (range === 'all') {
      if (pageCount > MAX_OUTPUT_PAGES) throw new Error(`한 번에 최대 ${MAX_OUTPUT_PAGES}쪽까지 이미지로 변환할 수 있습니다.`);
      return Array.from({length:pageCount}, (_, i) => i + 1);
    }
    const selections = [], seen = new Set();
    for (const section of range.split(',')) {
      const match = /^\s*(\d+)\s*(?:-\s*(\d+)\s*)?$/.exec(section);
      if (!match) throw new Error('페이지 범위를 1-3,5,7 형식으로 입력해 주세요.');
      const start = Number(match[1]), end = match[2] === undefined ? start : Number(match[2]);
      if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 1 || end < start || end > pageCount)
        throw new Error(`입력 범위 ${section.trim()}는 문서의 1~${pageCount}쪽을 벗어납니다.`);
      if (end - start + 1 > MAX_OUTPUT_PAGES || selections.length + end - start + 1 > MAX_OUTPUT_PAGES * 2)
        throw new Error('한 번에 선택할 수 있는 페이지 수가 너무 많습니다.');
      for (let page = start; page <= end; page++) {
        if (seen.has(page)) continue;
        seen.add(page);selections.push(page);
        if (selections.length > MAX_OUTPUT_PAGES)
          throw new Error(`전체 작업은 최대 ${MAX_OUTPUT_PAGES}쪽까지 변환할 수 있습니다.`);
      }
    }
    if (!selections.length) throw new Error('변환할 페이지를 선택해 주세요.');
    return selections;
  }
  // Keep zip entry names relative and unambiguous. Never trust filenames as paths.
  function safeBase(name) {
    const base = String(name).replace(/^.*[\\/]/, '').replace(/\.pdf$/i, '');
    return (base.normalize('NFC').replace(/[\u0000-\u001f\u007f<>:"|?*\\/]/g, '_')
      .replace(/^\.+/, '').trim().slice(0, 72) || 'document');
  }
  function entryName(fileIndex, fileName, page, format) {
    return `${String(fileIndex+1).padStart(2,'0')}_${safeBase(fileName)}_page-${String(page).padStart(4,'0')}.${format==='jpeg'?'jpg':'png'}`;
  }
  // ZIP32 "stored" entries: PNG/JPG already compressed; no third-party ZIP library.
  const CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let i=0; i<256; i++) {
      let c=i;
      for (let j=0; j<8; j++) c=(c&1)?(0xedb88320^(c>>>1)):(c>>>1);
      t[i]=c>>>0;
    }
    return t;
  })();
  function crc32(data) {
    let crc=0xffffffff;
    for (let i=0; i<data.length; i++) crc=CRC_TABLE[(crc^data[i])&255]^(crc>>>8);
    return (crc^0xffffffff)>>>0;
  }
  function dosDateTime(date) {
    const year=Math.max(1980,Math.min(2107,date.getFullYear()));
    return {date:((year-1980)<<9)|((date.getMonth()+1)<<5)|date.getDate(),
      time:(date.getHours()<<11)|(date.getMinutes()<<5)|Math.floor(date.getSeconds()/2)};
  }
  class LocalZip {
    constructor() {
      this.parts=[];this.records=[];this.offset=0;
      this.size=0;this.time=dosDateTime(new Date());
    }
    add(name, bytes) {
      if (!(bytes instanceof Uint8Array) || !bytes.byteLength)
        throw new Error('변환된 이미지가 비어 있거나 유효하지 않습니다.');
      if (this.records.length >= MAX_OUTPUT_PAGES) throw new Error('ZIP 안의 이미지 수 제한을 초과했습니다.');
      const filename=encoder.encode(name);
      if (filename.byteLength>65535) throw new Error('이미지 이름이 ZIP 규격의 길이 제한을 초과했습니다.');
      // Conservative accounting: central directory + footer also need space.
      const overhead=30+46+2*filename.length+22;
      if (this.size+bytes.byteLength+overhead>MAX_ZIP_BYTES ||
          this.offset+30+filename.length+bytes.byteLength>0xffffffff)
        throw new Error('결과 ZIP의 총 용량이 브라우저 보호 한도 256MiB를 초과합니다. DPI 또는 JPG 품질을 낮춰 주세요.');
      const crc=crc32(bytes), header=new Uint8Array(30+filename.length), v=new DataView(header.buffer);
      v.setUint32(0,0x04034b50,true);v.setUint16(4,20,true);v.setUint16(6,UTF8_FLAG,true);
      v.setUint16(8,0,true);v.setUint16(10,this.time.time,true);v.setUint16(12,this.time.date,true);
      v.setUint32(14,crc,true);v.setUint32(18,bytes.byteLength,true);v.setUint32(22,bytes.byteLength,true);
      v.setUint16(26,filename.byteLength,true);v.setUint16(28,0,true);header.set(filename,30);
      this.parts.push(header,bytes);
      this.records.push({name:filename,crc,bytes:bytes.byteLength,offset:this.offset});
      this.offset+=header.byteLength+bytes.byteLength;
      this.size+=header.byteLength+bytes.byteLength+46+filename.length;
    }
    finish() {
      if (!this.records.length) throw new Error('생성된 이미지가 없습니다.');
      const centralOffset=this.offset, entries=[];
      for (const e of this.records) {
        const header=new Uint8Array(46+e.name.length), v=new DataView(header.buffer);
        v.setUint32(0,0x02014b50,true);v.setUint16(4,20,true);v.setUint16(6,20,true);
        v.setUint16(8,UTF8_FLAG,true);v.setUint16(10,0,true);
        v.setUint16(12,this.time.time,true);v.setUint16(14,this.time.date,true);
        v.setUint32(16,e.crc,true);v.setUint32(20,e.bytes,true);v.setUint32(24,e.bytes,true);
        v.setUint16(28,e.name.length,true);v.setUint16(30,0,true);v.setUint16(32,0,true);
        v.setUint16(34,0,true);v.setUint16(36,0,true);v.setUint32(38,0,true);
        v.setUint32(42,e.offset,true);header.set(e.name,46);
        entries.push(header);
      }
      const centralSize=entries.reduce((s,x)=>s+x.length,0);
      if (centralOffset+centralSize+22>MAX_ZIP_BYTES || centralOffset+centralSize+22>0xffffffff)
        throw new Error('ZIP을 완성할 수 있는 메모리 한도를 초과했습니다.');
      const end=new Uint8Array(22),v=new DataView(end.buffer);
      v.setUint32(0,0x06054b50,true);v.setUint16(4,0,true);v.setUint16(6,0,true);
      v.setUint16(8,entries.length,true);v.setUint16(10,entries.length,true);
      v.setUint32(12,centralSize,true);v.setUint32(16,centralOffset,true);v.setUint16(20,0,true);
      const blob=new Blob([...this.parts,...entries,end],{type:'application/zip'});
      this.parts=[];this.records=[];
      return blob;
    }
  }
  async function readBytes(file,opts) {
    checkCancel(opts);
    const raw=typeof opts.readFile==='function' ? await opts.readFile(file) : await file.arrayBuffer();
    checkCancel(opts);
    const bytes=raw instanceof ArrayBuffer?new Uint8Array(raw):raw;
    if (!(bytes instanceof Uint8Array) || bytes.byteLength!==file.size || !bytes.byteLength)
      throw new Error('PDF 파일이 완전히 읽히지 않았거나 PDF 바이트 형식이 올바르지 않습니다.');
    // PDF.js may transfer and detach its input buffer to a worker.
    return new Uint8Array(bytes);
  }
  function ensureCanvas(canvas, viewport) {
    const width=Math.ceil(viewport.width), height=Math.ceil(viewport.height);
    if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width<=0 || height<=0 ||
        width>MAX_CANVAS_SIDE || height>MAX_CANVAS_SIDE || width*height>MAX_CANVAS_PIXELS)
      throw new Error(`선택 DPI의 이미지 크기 ${width}×${height}px가 안전 제한을 초과합니다. DPI를 낮춰 주세요.`);
    canvas.width=width;canvas.height=height;
    const context=canvas.getContext('2d',{alpha:false});
    if (!context) throw new Error('이 브라우저에서 이미지 렌더링 Canvas를 사용할 수 없습니다.');
    return context;
  }
  function canvasBlob(canvas,type,quality) {
    return new Promise((resolve,reject) => {
      try {
        if (typeof canvas.toBlob !== 'function') throw new Error('이미지 저장 기능이 지원되지 않습니다.');
        canvas.toBlob(blob=>blob?.size?resolve(blob):reject(new Error('이미지 인코딩에 실패했습니다.')),
          type,quality);
      } catch(error) {reject(error);}
    });
  }
  async function renderPage(document,pageNumber,settings,opts) {
    checkCancel(opts);
    const page=await document.getPage(pageNumber);
    let canvas, renderTask,abortListener;
    try {
      const viewport=page.getViewport({scale:settings.dpi/72});
      canvas=opts.createCanvas();
      if (!canvas || typeof canvas.getContext!=='function')
        throw new Error('Canvas를 준비할 수 없습니다.');
      const ctx=ensureCanvas(canvas,viewport);
      checkCancel(opts);
      renderTask=page.render({canvasContext:ctx,viewport,background:'rgb(255,255,255)',intent:'display'});
      abortListener=()=>{try {renderTask.cancel();} catch { /* cancelling */ }};
      opts.signal?.addEventListener('abort',abortListener,{once:true});
      if (opts.signal?.aborted) abortListener();
      try {await renderTask.promise;}
      catch (error) {if(opts.signal?.aborted || opts.cancelled?.()) throw abortError();throw error;}
      checkCancel(opts);
      const mime=settings.format==='png'?'image/png':'image/jpeg';
      const blob=await canvasBlob(canvas,mime,settings.quality);
      checkCancel(opts);
      if (blob.type && blob.type!==mime)
        throw new Error('브라우저가 요청한 이미지 형식으로 저장하지 못했습니다.');
      const bytes=new Uint8Array(await blob.arrayBuffer());
      checkCancel(opts);
      return {bytes,width:canvas.width,height:canvas.height};
    } finally {
      if (abortListener) opts.signal?.removeEventListener('abort',abortListener);
      if (canvas) {canvas.width=0;canvas.height=0;}
      try {page.cleanup?.();} catch {/* renderer already destroyed */}
    }
  }
  /**
   * @param {Iterable<File>} inputs
   * @param {{format?:string,dpi?:number,quality?:number,pages?:string}} settingsInput
   * @param {{pdfjsLib:object,readFile?:(file:File)=>Promise<Uint8Array>,createCanvas:()=>HTMLCanvasElement,
   *   signal?:AbortSignal,cancelled?:()=>boolean,onProgress?:(event:object)=>void}} opts
   */
  async function convert(inputs,settingsInput,opts) {
    const files=normalizeFiles(inputs),settings=normalizeSettings(settingsInput);
    if (!opts?.pdfjsLib?.getDocument || typeof opts.createCanvas!=='function')
      throw new Error('기존 PDF.js 렌더러 또는 Canvas 기능을 사용할 수 없습니다.');
    checkCancel(opts);
    const zip=new LocalZip(),results=[];
    let converted=0,total=0;
    for (let fileIndex=0;fileIndex<files.length;fileIndex++) {
      checkCancel(opts);
      const file=files[fileIndex];
      opts.onProgress?.({phase:'opening',fileIndex:fileIndex+1,files:files.length,done:converted,total});
      const bytes=await readBytes(file,opts);
      let loadingTask,doc,abortListener;
      try {
        loadingTask=opts.pdfjsLib.getDocument({data:bytes,useSystemFonts:true});
        abortListener=()=>{try{void Promise.resolve(loadingTask.destroy()).catch(()=>{});}catch{/* destroyed */}};
        opts.signal?.addEventListener('abort',abortListener,{once:true});
        if (opts.signal?.aborted) abortListener();
        try {doc=await loadingTask.promise;}
        catch (error) {if (opts.signal?.aborted || opts.cancelled?.()) throw abortError();throw error;}
        checkCancel(opts);
        const pages=parsePages(settings.pages,doc.numPages);
        if (total+pages.length>MAX_OUTPUT_PAGES)
          throw new Error(`전체 선택 페이지는 최대 ${MAX_OUTPUT_PAGES}쪽까지 지원합니다. 범위를 줄여 주세요.`);
        total+=pages.length;
        for (let pos=0;pos<pages.length;pos++) {
          checkCancel(opts);
          const pageNumber=pages[pos];
          opts.onProgress?.({phase:'rendering',fileIndex:fileIndex+1,files:files.length,page:pageNumber,done:converted,total});
          const {bytes:imageBytes,width,height}=await renderPage(doc,pageNumber,settings,opts);
          checkCancel(opts);
          zip.add(entryName(fileIndex,file.name,pageNumber,settings.format),imageBytes);
          converted++;
          opts.onProgress?.({phase:'encoded',fileIndex:fileIndex+1,files:files.length,page:pageNumber,done:converted,total,width,height});
          // Allow cancel clicks to be processed between pages.
          await new Promise(resolve=>setTimeout(resolve,0));
        }
        results.push({fileName:file.name,sourcePages:doc.numPages,convertedPages:pages.length});
      } catch(error) {
        if (opts.signal?.aborted || opts.cancelled?.()) throw abortError();
        throw new Error(`${file.name}: ${error?.message||'PDF를 이미지로 변환하지 못했습니다.'}`);
      } finally {
        if (abortListener) opts.signal?.removeEventListener('abort',abortListener);
        if (loadingTask) {try {await loadingTask.destroy();}catch{/* clean up */}}
      }
    }
    checkCancel(opts);
    opts.onProgress?.({phase:'packing',done:converted,total,files:files.length});
    const blob=zip.finish();
    checkCancel(opts);
    return {blob,outputName:files.length===1?`${safeBase(files[0].name)}_images.zip`:'Sunrise_PDF_images.zip',
      count:converted,format:settings.format,dpi:settings.dpi,results};
  }
  // Shared local ZIP packaging for other Sunrise page-based tools (LOCAL-12).
  // Entries are generated by the calling tool; enforce safe flat archive names.
  function packEntries(entries) {
    if (!Array.isArray(entries) || !entries.length || entries.length > MAX_OUTPUT_PAGES)
      throw new Error('ZIP 파일 개수가 안전 제한을 초과합니다.');
    const zip = new LocalZip(), names = new Set();
    for (const entry of entries) {
      if (typeof entry?.name !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,120}$/.test(entry.name) ||
          entry.name === '.' || entry.name === '..' || names.has(entry.name))
        throw new Error('ZIP 내부 파일 이름이 잘못되었거나 중복되었습니다.');
      names.add(entry.name);
      zip.add(entry.name,entry.bytes);
    }
    return zip.finish();
  }
  return {convert,normalizeFiles,normalizeSettings,parsePages,packEntries,MAX_FILES,MAX_OUTPUT_PAGES,
    MAX_CANVAS_PIXELS,MAX_ZIP_BYTES};
});
