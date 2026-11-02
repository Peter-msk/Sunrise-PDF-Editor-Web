/* Sunrise R07C — 관리자 공지·업데이트 백업/복원 UI. 서버 승인 정책이 권한의 최종 기준이다.
 * 다운로드/복원/미리보기 요청은 모두 관리자의 명시적인 버튼 동작에서만 실행된다.
 * 로드 시 자동 복원·자동 업로드·자동 네트워크 요청 금지.
 */
(() => {
  'use strict';
  const byId = id => document.getElementById(id);
  const choose = byId('sunRestoreFile'), previewButton = byId('sunRestorePreview');
  const applyButton = byId('sunRestoreApply'), exportButton = byId('sunRestoreExport');
  const phrase = byId('sunRestoreConfirmation'), summary = byId('sunRestoreSummary');
  const status = byId('sunRestoreStatus');
  if (![choose, previewButton, applyButton, exportButton, phrase, summary, status].every(Boolean)) return;

  const REQUIRED = '공지·업데이트 복원 실행';
  const MAX_FILE_BYTES = 6 * 1024 * 1024;
  let record = null, busy = false;

  function announce(message, failed = false) {
    status.textContent = String(message);
    status.dataset.state = failed ? 'error' : 'normal';
  }
  function clearApproval() {
    record = null;
    applyButton.disabled = true;
    phrase.value = '';
  }
  function updateApply() {
    applyButton.disabled = busy || !record || !record.token ||
      !choose.files?.[0] || choose.files[0] !== record.file ||
      phrase.value !== REQUIRED || Date.now() >= record.deadline;
  }
  function setBusy(on) {
    busy = on;
    previewButton.disabled = on;
    exportButton.disabled = on;
    choose.disabled = on;
    updateApply();
  }
  function apiError(payload, response) {
    const err = payload && typeof payload.error === 'string' ? payload.error : '';
    throw Error(err.slice(0,180) || '관리자 요청 실패 (HTTP ' + response.status + ')');
  }
  async function request(path, method, body) {
    const options = {method, credentials:'same-origin',cache:'no-store',headers:{'accept':'application/json'}};
    if (body !== undefined) {
      options.headers['content-type'] = 'application/json';
      options.body = JSON.stringify(body);
    }
    const response = await fetch('/api/admin/publication-restore/' + path, options);
    const result = await response.json().catch(() => null);
    if (!response.ok) apiError(result,response);
    return result;
  }
  async function backupFromFile(file) {
    if (!file || !/\.json$/i.test(file.name || '') || file.size < 2 || file.size > MAX_FILE_BYTES) {
      throw Error('6MB 이하의 공지·업데이트 JSON 백업을 선택해 주세요.');
    }
    const data = JSON.parse(await file.text());
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw Error('백업 JSON 형식이 잘못되었습니다.');
    return data;
  }
  choose.addEventListener('change',() => {
    clearApproval();
    summary.textContent = '';
    announce(choose.files?.[0] ? '백업 파일을 선택했습니다. 먼저 사전검사를 수행해 주세요.' : '백업 파일을 선택해 주세요.');
  });
  phrase.addEventListener('input',updateApply);
  previewButton.addEventListener('click', async () => {
    if (busy) return;
    clearApproval();
    const file = choose.files?.[0];
    setBusy(true);
    try {
      const backup = await backupFromFile(file);
      announce('현재 데이터와 백업 내용을 비교하고 있습니다.');
      const result = await request('preview','POST',{backup});
      const inserted = Number(result.insert || 0), updated = Number(result.update || 0);
      const unchanged = Number(result.unchanged || 0), conflicts = Number(result.totalConflicts || 0);
      if (![inserted,updated,unchanged,conflicts].every(n => Number.isSafeInteger(n) && n >= 0)) {
        throw Error('사전검사 결과가 올바르지 않습니다.');
      }
      summary.textContent = `신규 ${inserted}건 · 변경 ${updated}건 · 동일 ${unchanged}건 · 충돌 ${conflicts}건`;
      if (result.requiresConfirmation === true && typeof result.token === 'string' && result.token) {
        record = {file, backup, token:result.token, deadline:Date.now() + 290000};
        announce('사전검사 완료. 실제 복원을 원하면 확인 문구를 입력하고 복원 버튼을 누르세요. 승인 기한은 약 5분입니다.');
      } else {
        announce(conflicts ? '충돌이 있어 복원을 진행할 수 없습니다. 기존 데이터를 먼저 확인해 주세요.' :
          '변경할 데이터가 없으므로 복원을 실행하지 않습니다.');
      }
    } catch (error) {
      summary.textContent = '';
      announce('백업 사전검사 실패: ' + String(error?.message || '형식 오류').slice(0,180),true);
    } finally {setBusy(false)}
  });
  exportButton.addEventListener('click',async () => {
    if (busy) return;
    setBusy(true);
    try {
      announce('관리자 공지·업데이트 백업을 생성하고 있습니다.');
      const result = await request('export','GET');
      const bytes = new TextEncoder().encode(JSON.stringify(result,null,2));
      if (bytes.byteLength > MAX_FILE_BYTES) throw Error('백업 파일이 허용 크기를 초과했습니다.');
      const blob = new Blob([bytes],{type:'application/json'});
      const url = URL.createObjectURL(blob);
      try {
        const link = document.createElement('a');
        link.href = url;
        link.download = 'sunrise-publications-v2.json';
        document.body.append(link);
        link.click();
        link.remove();
      } finally {setTimeout(() => URL.revokeObjectURL(url), 5000)}
      announce('공지·업데이트 백업 파일의 다운로드를 요청했습니다. 다운로드 완료 여부는 브라우저에서 확인해 주세요.');
    } catch (error) {announce('백업 생성 실패: ' + String(error?.message || '서버 오류').slice(0,180),true)}
    finally {setBusy(false)}
  });
  applyButton.addEventListener('click',async () => {
    if (busy) return;
    updateApply();
    if (applyButton.disabled || !record || phrase.value !== REQUIRED) return;
    if (!window.confirm('운영 데이터베이스의 공지·업데이트 기록을 변경합니다. 현재 백업 파일을 복원하시겠습니까?')) return;
    const approval = record;
    setBusy(true);
    clearApproval();
    try {
      announce('변경 충돌 및 승인 상태를 다시 확인하고 복원 중입니다.');
      const result = await request('apply','POST',{
        backup:approval.backup,
        token:approval.token,
        confirm:REQUIRED
      });
      if (result.ok !== true || result.isRestoreExecuted !== true) throw Error('복원 성공 응답을 확인하지 못했습니다.');
      summary.textContent = `복원 처리 완료 · 신규 ${Number(result.inserted || 0)}건 · 변경 ${Number(result.updated || 0)}건`;
      announce('복원 요청이 성공 처리되었습니다. 최신 관리자 목록을 다시 조회해 주세요.');
    } catch (error) {
      announce('복원이 완료되지 않았습니다: ' + String(error?.message || '서버 오류').slice(0,180) + ' · 새로 미리보기를 실행해 주세요.',true);
    } finally {setBusy(false)}
  });
  clearApproval();
})();
