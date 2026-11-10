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
  // A ZIP Blob can be hundreds of MiB. Do not convert it to a second byte
  // array just to download it; bound the lifetime of its object URL instead.
  const pendingBlobs = new Map();
  const MAX_BLOB_DOWNLOADS = 2;
  const MAX_BLOB_BYTES = 256 * 1024 * 1024;
  let pageCleanupInstalled = false;
  function releaseBlobUrl(url) {
    const entry = pendingBlobs.get(url);
    if (!entry) return;
    pendingBlobs.delete(url);
    root.clearTimeout(entry.timer);
    root.URL.revokeObjectURL(url);
  }
  function downloadBlob(blob, filename) {
    if (!(blob instanceof Blob) || !Number.isSafeInteger(blob.size) ||
        blob.size < 1 || blob.size > MAX_BLOB_BYTES)
      throw new Error('다운로드 ZIP의 크기를 확인해 주세요. 최대 256MiB까지 지원합니다.');
    const name = String(filename || '').normalize('NFC')
      .replace(/[\\/:*?"<>|\x00-\x1f\x7f]/g, '_').slice(0, 180);
    if (!name || name === '.' || name === '..') throw new Error('다운로드 파일명을 확인해 주세요.');
    if (typeof root.URL?.createObjectURL !== 'function' ||
        typeof root.URL?.revokeObjectURL !== 'function' || !root.document?.body)
      throw new Error('브라우저 다운로드 기능을 사용할 수 없습니다.');
    const link = root.document.createElement('a');
    const url = root.URL.createObjectURL(blob);
    try {
      while (pendingBlobs.size >= MAX_BLOB_DOWNLOADS ||
        [...pendingBlobs.values()].reduce((sum, entry) => sum + entry.size, blob.size) > MAX_BLOB_BYTES) {
        releaseBlobUrl(pendingBlobs.keys().next().value);
      }
      link.href = url;
      link.download = name;
      root.document.body.append(link);
      link.click();
      const timer = root.setTimeout(() => releaseBlobUrl(url), 60_000);
      pendingBlobs.set(url, {size: blob.size, timer});
      if (!pageCleanupInstalled && typeof root.addEventListener === 'function') {
        root.addEventListener('pagehide', () => {
          for (const url of [...pendingBlobs.keys()]) releaseBlobUrl(url);
        });
        pageCleanupInstalled = true;
      }
    } catch (error) {
      if (pendingBlobs.has(url)) releaseBlobUrl(url);
      else root.URL.revokeObjectURL(url);
      throw error;
    } finally {
      link.remove();
    }
  }
  // The editor's shared modal can be closed from Escape, the backdrop, or a
  // different command. Tool-specific close buttons alone cannot own cleanup.
  function watchModal(anchor, onDismiss) {
    const doc = root.document;
    const backdrop = doc?.getElementById('modalBackdrop');
    const body = doc?.getElementById('modalBody');
    if (!backdrop || !body || typeof root.MutationObserver !== 'function') return () => {};
    let stopped = false;
    const observer = new root.MutationObserver(() => {
      if (stopped || (doc.contains(anchor) && backdrop.classList.contains('open'))) return;
      stopped = true;
      observer.disconnect();
      onDismiss();
    });
    observer.observe(backdrop, {attributes: true, attributeFilter: ['class']});
    observer.observe(body, {childList: true});
    return () => {stopped = true; observer.disconnect();};
  }
  function message(error, fallback) {
    const text = typeof error?.message === 'string' ? error.message.trim() : '';
    return text && text.length <= 240 ? text : (fallback || '작업 중 문제가 발생했습니다.');
  }
  function status(node, text) {
    if (node && 'textContent' in node) node.textContent = String(text ?? '');
  }
  root.SunriseLocalUI = Object.freeze({ download, downloadBlob, watchModal, message, status });
})(typeof window !== 'undefined' ? window : globalThis);
