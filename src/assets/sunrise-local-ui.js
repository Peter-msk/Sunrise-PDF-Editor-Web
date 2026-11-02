/* Sunrise LOCAL shared UI utilities — browser-only, no PDF content telemetry.
 * Keep compatibility with existing editor's global downloadBytes function.
 */
(function (root) {
  'use strict';
  function kindOf(bytes) {
    return bytes instanceof ArrayBuffer ||
      (ArrayBuffer.isView(bytes) && bytes.BYTES_PER_ELEMENT === 1);
  }
  function download(bytes, filename, mime) {
    if (!kindOf(bytes) || !(bytes.byteLength > 0)) {
      throw new Error('다운로드할 파일 내용이 없습니다.');
    }
    if (typeof root.downloadBytes !== 'function') {
      throw new Error('편집기 다운로드 기능이 연결되지 않았습니다.');
    }
    const name = String(filename || '').normalize('NFC')
      .replace(/[\\/:*?"<>|\x00-\x1f\x7f]/g, '_').slice(0,180);
    if (!name || name === '.' || name === '..') throw new Error('다운로드 파일명을 확인해 주세요.');
    const type = mime || (/\.csv$/i.test(name) ? 'text/csv;charset=utf-8' :
      /\.zip$/i.test(name) ? 'application/zip' : 'application/pdf');
    return root.downloadBytes(bytes, name, type);
  }
  function message(error, fallback) {
    const text = typeof error?.message === 'string' ? error.message.trim() : '';
    return text && text.length <= 240 ? text : (fallback || '작업 중 문제가 발생했습니다.');
  }
  function status(node, text) {
    if (node && 'textContent' in node) node.textContent = String(text ?? '');
  }
  root.SunriseLocalUI = Object.freeze({ download, message, status });
})(typeof window !== 'undefined' ? window : globalThis);
