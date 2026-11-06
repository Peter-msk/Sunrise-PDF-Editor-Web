/* Sunrise PDF Editor — local AcroForm creation, fill and maintenance.
 * No OCR, server upload, source overwrite or certificate signature editing.
 * Browser UMD module, PDFLib supplied by the host application.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.SunrisePdfFormTools = api;
})(typeof globalThis !== 'undefined' ? globalThis : undefined, function () {
  'use strict';
  const MAX_OPERATIONS = 150;
  const MAX_FIELD_NAME = 180;
  const MAX_VALUE_LENGTH = 5000;
  const SAFE_FIELD_TYPES = ['text', 'date', 'checkbox', 'dropdown', 'radio', 'optionlist'];
  // Standard active-document AcroForm belongs to the host editor.
  // This module owns only isolated, file-input based batch changes.
  const FORM_SCOPE = Object.freeze({
    owner: 'local-standalone-file',
    hostOwner: 'editor-active-document',
    affectsActiveDocument: false,
    overwritesSource: false,
    supportsXFA: false,
    supportsDigitalSignatures: false
  });
  const specialCatalogNames = ['Perms', 'DSS'];
  const PAGE_BOX_GETTERS = Object.freeze([
    'getMediaBox', 'getCropBox', 'getBleedBox', 'getTrimBox', 'getArtBox'
  ]);

  // A form-only edit must never alter any page's rotation or printable boxes.
  // This snapshot is independent of the original mutable PDFPage objects.
  function snapshotPageGeometry(page) {
    const rotation = page.getRotation().angle;
    if (!Number.isFinite(rotation)) throw new Error('원본 페이지 회전값이 잘못되었습니다.');
    const boxes = PAGE_BOX_GETTERS.map(getter => {
      const box = page[getter]();
      const values = ['x', 'y', 'width', 'height'].map(key => box[key]);
      if (!values.every(Number.isFinite) || values[2] <= 0 || values[3] <= 0) {
        throw new Error('원본 페이지의 MediaBox·CropBox 등 구조가 잘못되었습니다.');
      }
      return values;
    });
    return { rotation, boxes };
  }
  function verifyPageGeometry(expected, savedPages) {
    if (expected.length !== savedPages.length) {
      throw new Error('양식 저장 중 PDF 페이지 수가 변경되었습니다.');
    }
    for (const [index, page] of savedPages.entries()) {
      const actual = snapshotPageGeometry(page);
      if (Math.abs(actual.rotation - expected[index].rotation) > 0.01) {
        throw new Error(`양식 저장 후 ${index + 1}쪽 회전값이 변경되었습니다.`);
      }
      for (let b = 0; b < PAGE_BOX_GETTERS.length; b++) {
        if (actual.boxes[b].some((value, n) =>
          Math.abs(value - expected[index].boxes[b][n]) > 0.01)) {
          throw new Error(`양식 저장 후 ${index + 1}쪽 ${PAGE_BOX_GETTERS[b]} 구조가 변경되었습니다.`);
        }
      }
    }
  }
  function snapshotFormFields(form, lib) {
    return form.getFields().map(field => fieldState(field, lib));
  }
  function verifyFormFields(expected, savedForm, lib) {
    const actual = snapshotFormFields(savedForm, lib);
    if (expected.length !== actual.length) {
      throw new Error('저장 후 양식 필드 수가 일치하지 않습니다.');
    }
    for (let i = 0; i < expected.length; i++) {
      // Compare all field names, types, values, dropdown choices and readonly flags.
      // Values stay in local memory; never disclose form data in error messages.
      if (JSON.stringify(expected[i]) !== JSON.stringify(actual[i])) {
        throw new Error(`저장 후 ${i + 1}번째 양식 필드 값·속성이 일치하지 않습니다.`);
      }
    }
  }

  function abortIfRequested(cancelled) {
    if (cancelled?.()) {
      const error = new Error('작업을 취소했습니다. 출력 파일은 제공되지 않습니다.');
      error.name = 'AbortError';
      throw error;
    }
  }
  async function yieldToUI() { await new Promise(resolve => setTimeout(resolve, 0)); }
  function validName(name) {
    if (typeof name !== 'string' || !name.trim() || name.length > MAX_FIELD_NAME ||
        /[\u0000-\u001f]/.test(name) || name.split('.').some(x => !x.trim())) {
      throw new Error('필드 이름은 1~180자이며 빈 계층명과 제어문자를 포함할 수 없습니다.');
    }
    return name.trim();
  }
  function textValue(value) {
    if (typeof value !== 'string' || value.length > MAX_VALUE_LENGTH || /\u0000/.test(value)) {
      throw new Error('양식 값은 널 문자가 없는 최대 5000자 문자열이어야 합니다.');
    }
    return value;
  }
  // PDF does not define a native date widget. Use an ordinary text field so
  // all compliant viewers can display/edit it. SunriseDateISO only instructs
  // our editor to validate a real YYYY-MM-DD date before saving.
  function dateValue(value) {
    const text = textValue(value);
    if (!text) return text;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) throw new Error('날짜는 YYYY-MM-DD 형식이어야 합니다.');
    const [year,month,day] = text.split('-').map(Number);
    const actual=new Date(0); actual.setUTCFullYear(year,month-1,day); actual.setUTCHours(0,0,0,0);
    if(year<1||actual.getUTCFullYear()!==year||actual.getUTCMonth()!==month-1||actual.getUTCDate()!==day)
      throw new Error('존재하지 않는 날짜입니다.');
    return text;
  }
  function kindOf(field, lib) {
    if (field instanceof lib.PDFTextField) return field.acroField?.dict?.get(lib.PDFName.of('SunriseDateISO'))?.toString()==='true'?'date':'text';
    if (field instanceof lib.PDFCheckBox) return 'checkbox';
    if (field instanceof lib.PDFDropdown) return 'dropdown';
    if (lib.PDFRadioGroup && field instanceof lib.PDFRadioGroup) return 'radio';
    if (lib.PDFOptionList && field instanceof lib.PDFOptionList) return 'optionlist';
    if (lib.PDFSignature && field instanceof lib.PDFSignature) return 'signature';
    return 'other';
  }
  function guardPdf(pdf, lib) {
    const n = lib.PDFName.of;
    for (const key of specialCatalogNames) {
      if (pdf.catalog.get(n(key))) {
        throw new Error(`보안·서명 구조 ${key}가 있는 PDF는 수정하지 않습니다.`);
      }
    }
    for(const [,object] of pdf.context.enumerateIndirectObjects()){
      if(object?.get?.(n('ByteRange'))||object?.get?.(n('Type'))?.toString()==='/Sig')throw Error('전자서명이 있는 PDF는 다시 작성하지 않습니다.');
    }
    const acroForm = pdf.catalog.get(n('AcroForm'));
    if (acroForm) {
      const obj = pdf.context.lookup(acroForm);
      if (obj?.get?.(n('XFA'))) {
        throw new Error('XFA 양식은 무손실 편집을 보장할 수 없어 제외합니다.');
      }
      const sigFlags = pdf.context.lookup(obj?.get?.(n('SigFlags')));
      if (sigFlags?.asNumber?.() & 1) {
        throw new Error('전자서명 표시가 있는 PDF는 수정하지 않습니다.');
      }
    }
    for (const field of pdf.getForm().getFields()) {
      if (kindOf(field, lib) === 'signature') {
        throw new Error('전자서명 필드가 있는 PDF는 서명 손상 위험 때문에 수정하지 않습니다.');
      }
    }
    const pages = pdf.getPages();
    if (!pages.length || pages.length > 500) throw new Error('지원 페이지 범위는 1~500쪽입니다.');
    return pages;
  }
  function fieldState(field, lib) {
    const type = kindOf(field, lib);
    let value = null;
    let options = [];
    if (type === 'text' || type === 'date') value = field.getText() ?? '';
    if (type === 'checkbox') value = field.isChecked();
    if (type === 'radio') {options=field.getOptions();value=field.getSelected()??null;}
    if (type === 'optionlist') {options=field.getOptions();value=field.getSelected().slice();}
    if (type === 'dropdown') {
      options = field.getOptions();
      value = field.getSelected().slice();
    }
    return { name: field.getName(), type, value, options, readOnly: field.isReadOnly(),...(type==='optionlist'?{multiselect:field.isMultiselect()}: {}) };
  }
  async function loadSource(file, opts) {
    const lib = opts?.PDFLib;
    if (!lib?.PDFDocument || !lib.PDFName || !lib.PDFTextField ||
        typeof opts.readFile !== 'function') {
      throw new Error('양식 PDF 엔진이 준비되지 않았습니다.');
    }
    if (!file || !Number.isSafeInteger(file.size) || file.size <= 0) {
      throw new Error('비어 있지 않은 PDF 파일을 선택해 주세요.');
    }
    const bytes = await opts.readFile(file);
    if (!ArrayBuffer.isView(bytes) || bytes.BYTES_PER_ELEMENT !== 1 ||
        bytes.byteLength !== file.size) {
      throw new Error('원본 PDF의 크기 또는 읽기 결과가 올바르지 않습니다.');
    }
    const pdf = await lib.PDFDocument.load(bytes, { updateMetadata: false });
    const pages = guardPdf(pdf, lib);
    return { pdf, pages, lib };
  }
  async function inspect(file, opts) {
    abortIfRequested(opts?.cancelled);
    const { pdf, pages, lib } = await loadSource(file, opts);
    abortIfRequested(opts?.cancelled);
    return {
      pageCount: pages.length,
      fields: pdf.getForm().getFields().map(field => fieldState(field, lib))
    };
  }
  function requireSupportedField(form, name, lib) {
    const field = form.getFields().find(f => f.getName() === validName(name));
    if (!field) throw new Error(`존재하지 않는 양식 필드입니다: ${name}`);
    const type = kindOf(field, lib);
    if (!SAFE_FIELD_TYPES.includes(type)) {
      throw new Error(`${name}: ${type} 유형은 자동 변경을 지원하지 않습니다.`);
    }
    return { field, type };
  }
  function validatePosition(op, page) {
    const box = page.getMediaBox();
    const x = Number(op.x), y = Number(op.y), width = Number(op.width), height = Number(op.height);
    if (![x, y, width, height].every(Number.isFinite) ||
        x < box.x || y < box.y || width < 12 || height < 12 ||
        x + width > box.x + box.width || y + height > box.y + box.height) {
      throw new Error('양식 필드가 PDF 페이지의 MediaBox 영역 안에 들어와야 합니다.');
    }
    return { x, y, width, height };
  }
  function stringOptions(list) {
    if (!Array.isArray(list) || !list.length || list.length > 100 ||
        !list.every(s => typeof s === 'string' && s.length >= 1 && s.length <= 200)) {
      throw new Error('드롭다운 선택지는 1~100개, 각 항목은 1~200자여야 합니다.');
    }
    if (new Set(list).size !== list.length) throw new Error('중복된 드롭다운 선택지가 있습니다.');
    return list;
  }
  async function selectAppearanceFont(pdf, lib, opts, changes) {
    if(typeof opts?.fontProvider==='function'){
      const strings=[];for(const op of changes){if(typeof op.value==='string')strings.push(op.value);if(Array.isArray(op.value))strings.push(...op.value);if(Array.isArray(op.options))strings.push(...op.options);}
      for(const field of pdf.getForm().getFields()){if(field instanceof lib.PDFTextField)strings.push(field.getText()||'');if(field.getOptions)strings.push(...field.getOptions());}
      if(strings.some(v=>typeof v!=='string')||strings.reduce((n,v)=>n+v.length,0)>250000)throw Error('양식 글꼴 처리 텍스트가 너무 많습니다.');
      return opts.fontProvider(pdf,strings);
    }
    const fontBytes = opts?.fontBytes;
    if (fontBytes) {
      if (!ArrayBuffer.isView(fontBytes) || !fontBytes.byteLength ||
          typeof pdf.registerFontkit !== 'function' || !opts.fontkit) {
        throw new Error('한글 등 유니코드 양식에는 선택한 글꼴과 fontkit이 모두 필요합니다.');
      }
      pdf.registerFontkit(opts.fontkit);
      return pdf.embedFont(fontBytes, { subset: true });
    }
    return pdf.embedFont(lib.StandardFonts.Helvetica);
  }
  function ensureFontCanRender(value, font, customFont) {
    if (customFont) return;
    // Standard Helvetica does not cover Hangul. Do not save invisible or
    // broken text appearances and silently claim an editable filled form.
    if (/[\u0100-\uffff]/u.test(value)) {
      throw new Error('한글·유니코드 양식 값은 사용자 글꼴 파일과 fontkit 연동이 필요합니다.');
    }
    font.encodeText(value);
  }
  function setValue(field, type, raw, font, hasCustomFont) {
    if (type === 'text' || type === 'date') {
      const value = type === 'date' ? dateValue(raw) : textValue(raw);
      ensureFontCanRender(value, font, hasCustomFont);
      field.setText(value);
      field.updateAppearances(font);
    } else if (type === 'checkbox') {
      if (typeof raw !== 'boolean') throw new Error('체크박스는 참 또는 거짓 값이어야 합니다.');
      if (raw) field.check(); else field.uncheck();
    } else if(type==='radio'){
      if(raw===null||raw===''){field.clear();return;}
      const value=textValue(raw);if(!field.getOptions().includes(value))throw Error('등록되지 않은 라디오 선택지입니다.');field.select(value);
    } else if(type==='optionlist'){
      if(!Array.isArray(raw)||raw.length>100||raw.some(v=>typeof v!=='string'||!field.getOptions().includes(v))||new Set(raw).size!==raw.length)throw Error('선택 목록 값이 올바르지 않습니다.');
      if(raw.length>1&&!field.isMultiselect())throw Error('이 필드는 복수 선택을 허용하지 않습니다.');
      raw.forEach(v=>ensureFontCanRender(v,font,hasCustomFont));field.clear();if(raw.length)field.select(raw);field.updateAppearances(font);
    } else if (type === 'dropdown') {
      const value = textValue(raw);
      ensureFontCanRender(value, font, hasCustomFont);
      if (!field.getOptions().includes(value)) throw new Error('등록되지 않은 드롭다운 선택지입니다.');
      field.select(value);
      field.updateAppearances(font);
    }
  }
  function createField(pdf, pages, form, op, lib, font, hasCustomFont) {
    const name = validName(op.name);
    const type = op.type;
    if (!SAFE_FIELD_TYPES.includes(type)) throw new Error('지원하는 양식 필드 종류를 선택하세요.');
    const pageNumber = Number(op.page);
    if (!Number.isSafeInteger(pageNumber) || pageNumber < 1 || pageNumber > pages.length)
      throw new Error(`${name}: PDF 페이지 번호가 범위를 벗어났습니다.`);
    if (form.getFields().some(f => f.getName() === name)) throw new Error(`${name}: 이미 존재하는 필드 이름입니다.`);
    const location = validatePosition(op, pages[pageNumber - 1]);
    if (type === 'text' || type === 'date') {
      const field = form.createTextField(name);
      if (type === 'date') {
        if (op.multiline === true) throw new Error('날짜 필드는 여러 줄로 만들 수 없습니다.');
        field.setMaxLength(10);
        field.acroField.dict.set(lib.PDFName.of('SunriseDateISO'), lib.PDFBool.True);
      } else if (op.multiline === true) field.enableMultiline();
      field.addToPage(pages[pageNumber - 1], { ...location, font, fontSize: 11, borderWidth: 1 });
      setValue(field, type, op.value ?? '', font, hasCustomFont);
      if (op.readOnly === true) field.enableReadOnly();
    } else if (type === 'checkbox') {
      const field = form.createCheckBox(name);
      field.addToPage(pages[pageNumber - 1], { ...location, borderWidth: 1 });
      setValue(field, type, op.value === true, font, hasCustomFont);
      if (op.readOnly === true) field.enableReadOnly();
    } else if(type==='radio'){
      const values=stringOptions(op.options);if(location.height/values.length<12)throw Error('라디오 선택지마다 세로 12pt 이상이 필요합니다.');
      const field=form.createRadioGroup(name),size=Math.min(18,location.height/values.length);
      values.forEach((value,i)=>field.addOptionToPage(value,pages[pageNumber-1],{x:location.x,y:location.y+location.height-(i+1)*location.height/values.length,width:size,height:size}));
      if(op.value!==undefined&&op.value!=='')setValue(field,type,op.value,font,hasCustomFont);
      if(op.readOnly===true)field.enableReadOnly();
    } else {
      const field = type==='optionlist'?form.createOptionList(name):form.createDropdown(name);
      if(type==='optionlist'&&op.multiselect===true)field.enableMultiselect();
      const options = stringOptions(op.options);
      for (const option of options) ensureFontCanRender(option, font, hasCustomFont);
      field.addOptions(options);
      field.addToPage(pages[pageNumber - 1], { ...location, font, fontSize: 11, borderWidth: 1 });
      if (op.value !== undefined && op.value !== '') setValue(field, type, type==='optionlist'&&typeof op.value==='string'?[op.value]:op.value, font, hasCustomFont);
      if (op.readOnly === true) field.enableReadOnly();
    }
  }
  /**
   * Changes are applied to a newly loaded document, never the input File.
   * Operations: {action:'add', type, name, page, x, y, width, height,...},
   * {action:'set', name, value}, {action:'delete', name},
   * {action:'readonly', name, value:boolean}.
   */
  async function apply(file, changes, opts) {
    if (!Array.isArray(changes) || !changes.length || changes.length > MAX_OPERATIONS) {
      throw new Error(`양식 수정 작업은 1~${MAX_OPERATIONS}개여야 합니다.`);
    }
    const { pdf, pages, lib } = await loadSource(file, opts);
    const originalGeometry = pages.map(snapshotPageGeometry);
    const form = pdf.getForm();
    const font = await selectAppearanceFont(pdf, lib, opts, changes);
    const hasCustomFont = Boolean(opts.fontBytes||opts.fontProvider);
    for (let i = 0; i < changes.length; i++) {
      abortIfRequested(opts?.cancelled);
      const op = changes[i];
      if (!op || typeof op !== 'object') throw new Error(`${i + 1}번째 양식 작업을 읽을 수 없습니다.`);
      if (op.action === 'add') createField(pdf, pages, form, op, lib, font, hasCustomFont);
      else if (op.action === 'delete') {
        const { field } = requireSupportedField(form, op.name, lib);
        form.removeField(field);
      } else if (op.action === 'set') {
        const { field, type } = requireSupportedField(form, op.name, lib);
        if (field.isReadOnly()) throw new Error(`${op.name}: 읽기 전용 필드는 변경할 수 없습니다.`);
        setValue(field, type, op.value, font, hasCustomFont);
      } else if (op.action === 'readonly') {
        const { field } = requireSupportedField(form, op.name, lib);
        if (typeof op.value !== 'boolean') throw new Error('읽기 전용 설정은 참 또는 거짓이어야 합니다.');
        if (op.value) field.enableReadOnly(); else field.disableReadOnly();
      } else throw new Error(`지원하지 않는 양식 작업입니다: ${op.action}`);
      opts.onProgress?.({ done: i + 1, total: changes.length });
      if ((i + 1) % 5 === 0) await yieldToUI();
    }
    abortIfRequested(opts?.cancelled);
    const expectedFields = snapshotFormFields(form, lib);
    const bytes = await pdf.save({ updateFieldAppearances: false });
    abortIfRequested(opts?.cancelled);
    const saved = await lib.PDFDocument.load(bytes, { updateMetadata: false });
    abortIfRequested(opts?.cancelled);
    verifyPageGeometry(originalGeometry, saved.getPages());
    verifyFormFields(expectedFields, saved.getForm(), lib);
    abortIfRequested(opts?.cancelled);
    return { bytes, pageCount: pages.length, fieldCount: expectedFields.length };
  }
  function flattenForTransfer(pdf,lib){
    guardPdf(pdf,lib);
    const form=pdf.getForm(),fields=form.getFields(),n=lib.PDFName.of;
    for(const field of fields){
      const widgets=field.acroField.getWidgets();
      if(!widgets.length)throw Error('표시 영역이 없는 양식 필드는 평탄화할 수 없습니다.');
      for(const widget of widgets){
        const appearances=pdf.context.lookup(widget.dict.get(n('AP'))),normal=pdf.context.lookup(appearances?.get?.(n('N')));
        if(normal instanceof lib.PDFRawStream)continue;
        const state=widget.dict.get(n('AS'));
        if(normal instanceof lib.PDFDict&&state&&pdf.context.lookup(normal.get(state)) instanceof lib.PDFRawStream)continue;
        throw Error('현재 보이는 모양을 확인할 수 없는 양식입니다. 평탄화를 중단했습니다.');
      }
    }
    form.flatten({updateFieldAppearances:false});
    if(form.getFields().length)throw Error('양식 평탄화 후 필드가 남아 있습니다.');
    return {flattenedFields:fields.length};
  }

  // Preserve viewer-visible page labels through reorder, extraction and merge.
  // Each transferred page starts a fresh label range so a skipped page does not
  // silently inherit the wrong source /St or a previous document's prefix.
  // The name tree and automatic numbering are copied as data, never as actions.
  function readPageLabels(pdf, lib) {
    const n=lib.PDFName.of,ctx=pdf.context,tree=pdf.catalog.get(n('PageLabels'));
    if(!tree)return null;
    const records=[],visited=new Set();
    const visit=(raw,depth)=>{
      const node=ctx.lookup(raw);
      if(!(node instanceof lib.PDFDict)||visited.has(node)||depth>16||visited.size>2000)
        throw Error('페이지 번호 레이블 트리 구조가 올바르지 않습니다.');
      visited.add(node);
      const nums=ctx.lookup(node.get(n('Nums'))),kids=ctx.lookup(node.get(n('Kids')));
      if(Boolean(nums)===Boolean(kids))throw Error('페이지 번호 레이블 트리의 Nums/Kids 구조를 읽을 수 없습니다.');
      if(nums){
        if(!(nums instanceof lib.PDFArray)||nums.size()%2||nums.size()>2000)throw Error('페이지 번호 레이블 항목 수가 올바르지 않습니다.');
        for(let i=0;i<nums.size();i+=2){
          const index=ctx.lookup(nums.get(i))?.asNumber?.(),dict=ctx.lookup(nums.get(i+1));
          if(!Number.isSafeInteger(index)||index<0||index>=pdf.getPageCount()||!(dict instanceof lib.PDFDict))
            throw Error('페이지 번호 레이블 시작값 또는 사전이 올바르지 않습니다.');
          if(dict.keys().some(key=>!['S','P','St'].includes(key.decodeText())))throw Error('지원하지 않는 페이지 번호 레이블 속성이 있습니다.');
          const style=dict.get(n('S'))?.toString(),prefix=ctx.lookup(dict.get(n('P'))),start=ctx.lookup(dict.get(n('St')))?.asNumber?.()??1;
          if(style!==undefined&&!['/D','/R','/r','/A','/a'].includes(style))throw Error('지원하지 않는 페이지 번호 레이블 스타일입니다.');
          if(prefix&&!(prefix instanceof lib.PDFString||prefix instanceof lib.PDFHexString))throw Error('페이지 번호 레이블 접두사가 올바르지 않습니다.');
          if(!Number.isSafeInteger(start)||start<1||start>2147483647)throw Error('페이지 번호 레이블 시작 번호가 올바르지 않습니다.');
          records.push({index,style,prefix:prefix?.decodeText()??null,start});
        }
      }else{
        if(!(kids instanceof lib.PDFArray)||!kids.size()||kids.size()>2000)throw Error('페이지 번호 레이블 하위 트리가 올바르지 않습니다.');
        for(let i=0;i<kids.size();i++)visit(kids.get(i),depth+1);
      }
    };
    visit(tree,0); records.sort((a,b)=>a.index-b.index);
    for(let i=1;i<records.length;i++)if(records[i].index===records[i-1].index)
      throw Error('페이지 번호 레이블 시작 위치가 중복되었습니다.');
    return records;
  }
  function transferPageLabels(source,target,indices,lib){
    const n=lib.PDFName.of,dst=target.context,sourceLabels=readPageLabels(source,lib);
    const existingLabels=readPageLabels(target,lib);
    if(!sourceLabels&&!existingLabels)return;
    const originalCount=target.getPageCount()-indices.length;
    const records=(existingLabels||[]).map(x=>({...x}));
    for(let i=0;i<indices.length;i++){
      const pageIndex=indices[i];let label={index:pageIndex,style:'/D',prefix:null,start:pageIndex+1};
      if(sourceLabels){
        const chosen=sourceLabels.findLast?sourceLabels.findLast(r=>r.index<=pageIndex):sourceLabels.filter(r=>r.index<=pageIndex).at(-1);
        if(chosen){
          const value=chosen.start+pageIndex-chosen.index;
          if(value>2147483647)throw Error('페이지 번호 레이블이 PDF 정수 범위를 초과했습니다.');
          label={...chosen,start:value};
        }
      }
      records.push({...label,index:originalCount+i});
    }
    const values=[];
    for(const r of records){
      const dict=dst.obj({});
      if(r.style)dict.set(n('S'),n(r.style.slice(1)));
      if(r.prefix!==null)dict.set(n('P'),lib.PDFHexString.fromText(r.prefix));
      dict.set(n('St'),dst.obj(r.start));
      values.push(dst.obj(r.index),dict);
    }
    target.catalog.set(n('PageLabels'),dst.register(dst.obj({Nums:values})));
  }

  // One copier owns pages and the form tree together. Separate copyPages calls
  // create unrelated widget instances and leave the catalog Fields tree behind.
  async function transferPages(source, target, indices, lib) {
    const n=lib.PDFName.of,src=source.context,dst=target.context;
    if(source===target||!Array.isArray(indices)||!indices.length||indices.length>500||
       new Set(indices).size!==indices.length||indices.some(i=>!Number.isSafeInteger(i)||i<0||i>=source.getPageCount()))
      throw Error('양식 보존 페이지 선택이 올바르지 않습니다.');
    for(const key of ['StructTreeRoot','MarkInfo','OCProperties','OpenAction','AA','Collection'])
      if(source.catalog.has(n(key)))throw Error(key+' 문서 구조는 페이지 이식 중 보존할 수 없습니다.');
    const form=src.lookup(source.catalog.get(n('AcroForm')));
    if(form&&!(form instanceof lib.PDFDict))throw Error('양식 사전 구조가 올바르지 않습니다.');
    if(form?.has(n('CO')))throw Error('자동 계산 순서가 있는 양식은 페이지 이식하지 않습니다.');
    const selected=new Set(indices.map(i=>source.getPage(i).ref.toString())),widgets=new Set();
    const sourcePages=indices.map(i=>source.getPage(i));
    const selectedAnnotations=new Set();
    for(const page of sourcePages){const annots=src.lookup(page.node.get(n('Annots')));if(annots instanceof lib.PDFArray)for(let i=0;i<annots.size();i++)selectedAnnotations.add(annots.get(i).toString());}
    for(const page of sourcePages){
      const annots=src.lookup(page.node.get(n('Annots')));
      if(annots&&!(annots instanceof lib.PDFArray))throw Error('페이지 주석 배열이 올바르지 않습니다.');
      for(let i=0;i<(annots?.size()||0);i++){
        const ref=annots.get(i),a=src.lookup(ref);
        if(!(ref instanceof lib.PDFRef)||!(a instanceof lib.PDFDict))throw Error('주석은 간접 참조 사전이어야 합니다.');
        for(const relation of ['IRT','Popup',...(a.get(n('Subtype'))?.toString()==='/Popup'?['Parent']:[])])if(a.has(n(relation))&&!selectedAnnotations.has(a.get(n(relation)).toString()))throw Error('선택하지 않은 페이지의 답글·팝업 연결이 있습니다. 관련 페이지를 함께 선택하세요.');
        if(a.has(n('AA')))throw Error('자동 동작이 있는 주석은 이식하지 않습니다.');
        if(a.get(n('Subtype'))?.toString()==='/Widget')widgets.add(ref.toString());
        const action=src.lookup(a.get(n('A')));
        if(action&&(!(action instanceof lib.PDFDict)||action.has(n('Next'))||!['/URI','/GoTo'].includes(action.get(n('S'))?.toString())))
          throw Error('지원하지 않는 주석 동작이 있습니다.');
        const dest=src.lookup(a.get(n('Dest'))||(action?.get(n('S'))?.toString()==='/GoTo'?action.get(n('D')):undefined));
        if(dest&&(!(dest instanceof lib.PDFArray)||!selected.has(dest.get(0)?.toString())))
          throw Error('선택하지 않은 페이지 또는 이름 목적지로 향하는 링크가 있습니다. 관련 페이지를 함께 선택하세요.');
      }
    }
    const fields=src.lookup(form?.get(n('Fields'))),retained=new Set(),seen=new Set();
    const collect=(raw,depth)=>{
      const dict=src.lookup(raw);
      if(!(raw instanceof lib.PDFRef)||!(dict instanceof lib.PDFDict)||seen.has(dict)||depth>24||seen.size>4000)
        throw Error('양식 필드 트리에 순환 또는 구조 오류가 있습니다.');
      seen.add(dict);
      if(dict.has(n('AA'))||dict.has(n('A')))throw Error('자동 동작이 있는 양식은 이식하지 않습니다.');
      const kids=src.lookup(dict.get(n('Kids')));
      if(kids&&!(kids instanceof lib.PDFArray))throw Error('양식 하위 필드 배열이 올바르지 않습니다.');
      let keep=widgets.has(raw.toString());
      if(kids)for(let i=0;i<kids.size();i++)keep=collect(kids.get(i),depth+1)||keep;
      // Keep hidden terminal fields only for a complete document transfer.
      if(!kids&&dict.get(n('Subtype'))?.toString()!=='/Widget'&&indices.length===source.getPageCount())keep=true;
      if(keep)retained.add(raw.toString());
      return keep;
    };
    if(fields){
      if(!(fields instanceof lib.PDFArray)||fields.size()>1000)throw Error('양식 루트 필드 배열을 읽을 수 없습니다.');
      for(let i=0;i<fields.size();i++)collect(fields.get(i),0);
    }
    guardPdf(source,lib);
    for(const widget of widgets)if(!retained.has(widget))throw Error('문서 양식 트리에 연결되지 않은 입력칸이 있습니다.');
    await source.flush();
    const copier=lib.PDFObjectCopier.for(src,dst);
    const copied=sourcePages.map(page=>{
      const ref=copier.copy(page.ref),node=dst.lookup(ref);
      const result=lib.PDFPage.of(node,ref,target);target.addPage(result);return result;
    });
    // Page label number-tree insertion happens after all pages have a target index.
    transferPageLabels(source,target,indices,lib);
    // References copied via /Parent and /P resolve to the very same page/widget.
    sourcePages.forEach((page,i)=>{
      const annots=src.lookup(page.node.get(n('Annots')));
      for(let j=0;j<(annots?.size()||0);j++)dst.lookup(copier.copy(annots.get(j))).set(n('P'),copied[i].ref);
    });

    // Keep document attachments when producing a new document. Tree keys are
    // made unique on merge; the embedded file bytes and file spec stay intact.
    const sourceNames=src.lookup(source.catalog.get(n('Names')));
    if(sourceNames){
      if(!(sourceNames instanceof lib.PDFDict)||sourceNames.keys().some(key=>!['Dests','EmbeddedFiles'].includes(key.decodeText())))throw Error('이름 트리에 지원하지 않는 문서 동작이 있습니다.');
      const files=sourceNames.get(n('EmbeddedFiles'));
      if(files){
        const outNames=dst.lookup(target.catalog.get(n('Names')))||dst.obj({});
        const outTree=dst.lookup(outNames.get(n('EmbeddedFiles'))),old=outTree?dst.lookup(outTree.get(n('Names'))):dst.obj([]);
        if(!(old instanceof lib.PDFArray)||old.size()%2||old.size()>2000)throw Error('결과 첨부파일 트리를 읽을 수 없습니다.');
        const entries=[];for(let i=0;i<old.size();i+=2)entries.push([old.get(i).decodeText(),old.get(i+1)]);
        const keys=new Set(entries.map(pair=>pair[0])),seenTrees=new Set();
        const visit=(raw,depth)=>{
          const node=src.lookup(raw);
          if(!(node instanceof lib.PDFDict)||seenTrees.has(node)||depth>20||seenTrees.size>2000)throw Error('첨부파일 이름 트리에 순환 또는 구조 오류가 있습니다.');seenTrees.add(node);
          const pairs=src.lookup(node.get(n('Names'))),kids=src.lookup(node.get(n('Kids')));
          if(pairs){
            if(!(pairs instanceof lib.PDFArray)||pairs.size()%2||pairs.size()>2000)throw Error('첨부파일 이름 목록이 올바르지 않습니다.');
            for(let i=0;i<pairs.size();i+=2){
              const label=src.lookup(pairs.get(i)),spec=src.lookup(pairs.get(i+1));
              if(!(label instanceof lib.PDFString||label instanceof lib.PDFHexString)||!(spec instanceof lib.PDFDict)||!spec.has(n('EF')))throw Error('첨부파일 명세가 올바르지 않습니다.');
              const original=label.decodeText();let unique=original,suffix=2;while(keys.has(unique))unique=original+' ('+(suffix++)+')';
              keys.add(unique);entries.push([unique,copier.copy(pairs.get(i+1))]);if(entries.length>1000)throw Error('첨부파일 수가 1000개를 초과했습니다.');
            }
          }
          if(kids){if(!(kids instanceof lib.PDFArray)||kids.size()>2000)throw Error('첨부파일 하위 트리가 올바르지 않습니다.');for(let i=0;i<kids.size();i++)visit(kids.get(i),depth+1);}
        };
        visit(files,0);
        // PDF name trees compare the encoded string bytes, not locale order.
        entries.sort((a,b)=>{const x=lib.PDFHexString.fromText(a[0]).asBytes(),y=lib.PDFHexString.fromText(b[0]).asBytes();for(let i=0;i<Math.min(x.length,y.length);i++)if(x[i]!==y[i])return x[i]-y[i];return x.length-y.length;});
        outNames.set(n('EmbeddedFiles'),dst.register(dst.obj({Names:entries.flatMap(([key,ref])=>[lib.PDFHexString.fromText(key),ref])})));
        target.catalog.set(n('Names'),outNames);
      }
    }
    const associated=src.lookup(source.catalog.get(n('AF')));
    if(associated){
      if(!(associated instanceof lib.PDFArray)||associated.size()>1000)throw Error('문서 연결 첨부파일 배열이 올바르지 않습니다.');
      const existingAF=dst.lookup(target.catalog.get(n('AF')))||dst.obj([]);
      if(!(existingAF instanceof lib.PDFArray)||existingAF.size()+associated.size()>1000)throw Error('결과 연결 첨부파일 수가 너무 많습니다.');
      for(let i=0;i<associated.size();i++){
        const spec=src.lookup(associated.get(i));if(!(spec instanceof lib.PDFDict)||!spec.has(n('EF')))throw Error('연결 첨부파일 명세가 올바르지 않습니다.');
        existingAF.push(copier.copy(associated.get(i)));
      }
      target.catalog.set(n('AF'),existingAF);
    }
    if(!retained.size)return copied;
    const existing=dst.lookup(target.catalog.get(n('AcroForm'))),outForm=existing||dst.obj({Fields:[]});
    if(!(outForm instanceof lib.PDFDict))throw Error('결과 양식 구조를 읽을 수 없습니다.');
    const outFields=dst.lookup(outForm.get(n('Fields')));
    if(!(outFields instanceof lib.PDFArray))throw Error('결과 양식 필드 목록이 올바르지 않습니다.');
    let sequence=1,namespace;
    const names=new Set(Array.from({length:outFields.size()},(_,i)=>dst.lookup(outFields.get(i)).get(n('T'))?.decodeText?.()));
    do{namespace='Document'+sequence++;}while(names.has(namespace));
    // Resource names in the form default appearance must be unique across
    // documents. Appearance streams retain their own resources unchanged.
    const outDR=dst.lookup(outForm.get(n('DR')))||dst.obj({}),renamed=new Map();
    const dr=src.lookup(form?.get(n('DR')));
    if(dr){
      if(!(dr instanceof lib.PDFDict))throw Error('양식 기본 리소스가 올바르지 않습니다.');
      for(const [kind,raw] of dr.entries()){
        const values=src.lookup(raw);if(!(values instanceof lib.PDFDict))throw Error('양식 리소스 사전을 읽을 수 없습니다.');
        const output=dst.lookup(outDR.get(kind))||dst.obj({});
        for(const [key,value] of values.entries()){
          const unique=n(namespace+'_'+key.decodeText());
          renamed.set(key.toString(),unique.toString());output.set(unique,copier.copy(value));
        }
        outDR.set(kind,output);
      }
    }
    outForm.set(n('DR'),outDR);
    const appearance=raw=>{
      const value=src.lookup(raw);
      if(!value)return null;
      if(!(value instanceof lib.PDFString||value instanceof lib.PDFHexString))throw Error('양식 기본 외관 문자열을 읽을 수 없습니다.');
      return lib.PDFString.of(value.decodeText().replace(/\/(?:#[0-9a-fA-F]{2}|[^\s\[\]()<>/%])+/g,key=>renamed.get(key)||key));
    };
    const prune=raw=>{
      const original=src.lookup(raw),ref=copier.copy(raw),dict=dst.lookup(ref),kids=src.lookup(original.get(n('Kids')));
      if(kids){
        const list=[];for(let i=0;i<kids.size();i++)if(retained.has(kids.get(i).toString()))list.push(prune(kids.get(i)));
        dict.set(n('Kids'),dst.obj(list));
      }
      const da=appearance(original.get(n('DA')));if(da)dict.set(n('DA'),da);
      return ref;
    };
    const roots=[];
    for(let i=0;i<fields.size();i++)if(retained.has(fields.get(i).toString()))roots.push(prune(fields.get(i)));
    const group=dst.obj({T:lib.PDFString.of(namespace),Kids:roots}),groupRef=dst.register(group);
    const da=appearance(form.get(n('DA')));if(da)group.set(n('DA'),da);
    const q=form.get(n('Q'));if(q)group.set(n('Q'),copier.copy(q));
    roots.forEach(ref=>dst.lookup(ref).set(n('Parent'),groupRef));
    outFields.push(groupRef);outForm.set(n('Fields'),outFields);
    outForm.set(n('NeedAppearances'),lib.PDFBool.False);
    if(!existing)target.catalog.set(n('AcroForm'),dst.register(outForm));
    // Invalidate no cached form objects: callers must not inspect target.getForm()
    // until all source documents have been transferred.
    return copied;
  }

  return { inspect, apply, flattenForTransfer, transferPages, MAX_OPERATIONS, FORM_SCOPE,
    SUPPORTED_FIELD_TYPES: Object.freeze([...SAFE_FIELD_TYPES]) };
});
