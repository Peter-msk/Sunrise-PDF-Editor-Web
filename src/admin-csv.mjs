/**
 * Sunrise PDF Editor — private administrator aggregate CSV serializer.
 *
 * Accepts only pre-approved rows from the authenticated admin API. This
 * utility never reads a PDF or fetches data, and is not a CSV importer.
 *
 * Security: spreadsheet applications can evaluate strings beginning with
 * =, +, -, or @ as formulas, including after invisible/space prefixes.
 * Encode every cell, even presently numeric/allowlisted values, so future
 * additions to administrator reports cannot accidentally regress safety.
 */
const FORMULA_START = /^[\s\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]*[=+\-@]/u;
const MAX_CELL_LENGTH = 4096;
const MAX_ROWS = 100000;

/** @param {unknown} value */
export function csvCell(value) {
  if (value !== null && value !== undefined &&
      typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') {
    throw new TypeError('CSV 데이터 종류를 확인해 주세요.');
  }
  if (typeof value === 'number' && !Number.isFinite(value)) {
    throw new RangeError('CSV에 유효하지 않은 숫자를 기록할 수 없습니다.');
  }
  let text = String(value ?? '');
  if (text.length > MAX_CELL_LENGTH || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(text)) {
    throw new RangeError('CSV 값의 길이 또는 제어 문자를 확인해 주세요.');
  }
  if (FORMULA_START.test(text)) text = '\'' + text;
  return '"' + text.replaceAll('"', '""') + '"';
}

/**
 * @param {unknown[][]} rows - trusted, aggregated administrative data only
 * @returns {string} UTF-8 CSV with a BOM for Excel Korean text compatibility
 */
export function toAdminCsv(rows) {
  if (!Array.isArray(rows) || rows.length === 0 || rows.length > MAX_ROWS ||
      !Array.isArray(rows[0]) || rows[0].length === 0 || rows[0].length > 32) {
    throw new TypeError('CSV 표 형식을 확인해 주세요.');
  }
  const columns = rows[0].length;
  return '\ufeff' + rows.map(row => {
    if (!Array.isArray(row) || row.length !== columns) {
      throw new TypeError('CSV 열 개수가 일치하지 않습니다.');
    }
    return row.map(csvCell).join(',');
  }).join('\r\n') + '\r\n';
}
