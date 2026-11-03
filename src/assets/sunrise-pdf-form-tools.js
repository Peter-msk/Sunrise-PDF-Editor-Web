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
  const SAFE_FIELD_TYPES = ['text', 'checkbox', 'dropdown'];
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
  function kindOf(field, lib) {
    if (field instanceof lib.PDFTextField) return 'text';
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
    if (type === 'text') value = field.getText() ?? '';
    if (type === 'checkbox') value = field.isChecked();
    if (type === 'dropdown') {
      options = field.getOptions();
      value = field.getSelected().slice();
    }
    return { name: field.getName(), type, value, options, readOnly: field.isReadOnly() };
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
  async function selectAppearanceFont(pdf, lib, opts) {
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
    if (type === 'text') {
      const value = textValue(raw);
      ensureFontCanRender(value, font, hasCustomFont);
      field.setText(value);
      field.updateAppearances(font);
    } else if (type === 'checkbox') {
      if (typeof raw !== 'boolean') throw new Error('체크박스는 참 또는 거짓 값이어야 합니다.');
      if (raw) field.check(); else field.uncheck();
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
    if (!SAFE_FIELD_TYPES.includes(type)) throw new Error('새 필드는 텍스트·체크박스·드롭다운만 지원합니다.');
    const pageNumber = Number(op.page);
    if (!Number.isSafeInteger(pageNumber) || pageNumber < 1 || pageNumber > pages.length)
      throw new Error(`${name}: PDF 페이지 번호가 범위를 벗어났습니다.`);
    if (form.getFields().some(f => f.getName() === name)) throw new Error(`${name}: 이미 존재하는 필드 이름입니다.`);
    const location = validatePosition(op, pages[pageNumber - 1]);
    if (type === 'text') {
      const field = form.createTextField(name);
      if (op.multiline === true) field.enableMultiline();
      field.addToPage(pages[pageNumber - 1], { ...location, font, fontSize: 11, borderWidth: 1 });
      setValue(field, type, textValue(op.value ?? ''), font, hasCustomFont);
      if (op.readOnly === true) field.enableReadOnly();
    } else if (type === 'checkbox') {
      const field = form.createCheckBox(name);
      field.addToPage(pages[pageNumber - 1], { ...location, borderWidth: 1 });
      setValue(field, type, op.value === true, font, hasCustomFont);
      if (op.readOnly === true) field.enableReadOnly();
    } else {
      const field = form.createDropdown(name);
      const options = stringOptions(op.options);
      for (const option of options) ensureFontCanRender(option, font, hasCustomFont);
      field.addOptions(options);
      field.addToPage(pages[pageNumber - 1], { ...location, font, fontSize: 11, borderWidth: 1 });
      if (op.value !== undefined && op.value !== '') setValue(field, type, op.value, font, hasCustomFont);
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
    const font = await selectAppearanceFont(pdf, lib, opts);
    const hasCustomFont = Boolean(opts.fontBytes);
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
  return { inspect, apply, MAX_OPERATIONS, FORM_SCOPE,
    SUPPORTED_FIELD_TYPES: Object.freeze([...SAFE_FIELD_TYPES]) };
});
