'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs');
const office=require('../src/assets/sunrise-office-export.js');
const readZip=bytes=>{
 const b=Buffer.from(bytes),found={};let pos=0;
 while(pos<b.length&&b.readUInt32LE(pos)===0x04034b50){
  const method=b.readUInt16LE(pos+8),crc=b.readUInt32LE(pos+14),size=b.readUInt32LE(pos+18);
  const nameSize=b.readUInt16LE(pos+26),extraSize=b.readUInt16LE(pos+28);
  assert.equal(method,0,'text ZIP must use STORE');
  const name=b.subarray(pos+30,pos+30+nameSize).toString('utf8');
  const raw=b.subarray(pos+30+nameSize+extraSize,pos+30+nameSize+extraSize+size);
  let c=0xffffffff;
  for(const v of raw){c^=v;for(let j=0;j<8;j++)c=(c&1)?(0xedb88320^(c>>>1)):(c>>>1)}
  assert.equal((c^0xffffffff)>>>0,crc,'ZIP data CRC32');
  found[name]=raw.toString('utf8');
  pos+=30+nameSize+extraSize+size;
 }
 assert.equal(b.readUInt32LE(pos),0x02014b50,'ZIP central directory must follow file contents');
 assert(b.includes(Buffer.from('PK\x05\x06','binary')),'ZIP EOCD required');
 return found;
};
const sample=['안녕 & <PDF>','수질=정상\n=SUM(1,2)'];
const doc=readZip(office.docx(sample));
assert(doc['word/document.xml']?.includes('안녕 &amp; &lt;PDF&gt;'));
assert(doc['word/document.xml']?.includes('w:type="page"'));
assert(doc['word/document.xml']?.includes('수질=정상'));
assert(doc['_rels/.rels']?.includes('word/document.xml'));
const excel=readZip(office.xlsx(sample));
assert(excel['xl/workbook.xml']?.includes('PDF Text'));
assert(excel['xl/worksheets/sheet1.xml']?.includes('안녕 &amp; &lt;PDF&gt;'));
assert(excel['xl/worksheets/sheet1.xml']?.includes('=SUM(1,2)'));
assert(!excel['xl/worksheets/sheet1.xml'].includes('<f>'),'input must not execute Excel formulas');
assert.equal((excel['xl/worksheets/sheet1.xml'].match(/<row r=/g)||[]).length,4);
assert.throws(()=>office.docx(Array(121).fill('hello')),/120/);
assert.throws(()=>office.xlsx(['too long'.repeat(300000)]),/2 MiB/);
// PDF.js item boundaries: explicit EOL and different text baselines preserve lines.
const geometry=[
 {str:'검토',width:22,transform:[12,0,0,12,50,600],hasEOL:false},
 {str:'결과',width:22,transform:[12,0,0,12,74,600],hasEOL:true},
 {str:'정상',width:22,transform:[12,0,0,12,50,580],hasEOL:false},
 {str:'검증',width:22,transform:[12,0,0,12,90,580],hasEOL:false}
];
assert.equal(office.pageTextFromItems(geometry),'검토결과\n정상 검증');
assert.equal(office.pageTextFromItems([
 {str:'첫 줄',width:30,transform:[12,0,0,12,50,600]},
 {str:'둘째 줄',width:36,transform:[12,0,0,12,50,576]}
]),'첫 줄\n둘째 줄');
assert.equal(office.pageTextFromItems([{str:'한글',hasEOL:true}]),'한글\n');
assert.throws(()=>office.pageTextFromItems(null),/텍스트 레이어/);
assert.throws(()=>office.pageTextFromItems(Array(100001).fill({str:'x'})),/텍스트 레이어/);
assert.throws(()=>office.xlsx(['x'.repeat(32768)]),/32,767/,'Excel must not truncate a long cell');
assert(readZip(office.xlsx(['x'.repeat(32767)]))['xl/worksheets/sheet1.xml'].includes('x'.repeat(32767)),
 'Excel must preserve exact content at cell limit');
assert.throws(()=>office.docx(['abc\u0001def']),/제어 문자/,'invalid XML may not silently disappear');
assert.throws(()=>office.xlsx(['\ud800']),/Unicode/,'lone surrogate may not silently be replaced');
assert(readZip(office.docx(['줄1\r줄2']))['word/document.xml'].includes('줄2'));
assert.equal((readZip(office.xlsx(['줄1\r줄2']))['xl/worksheets/sheet1.xml'].match(/<row r=/g)||[]).length,3);

const editor=fs.readFileSync('src/editor/index.html','utf8');
const build=fs.readFileSync('scripts/build-release.cjs','utf8');
for(const id of ['exportWordText','exportExcelText'])assert(editor.includes('case "'+id+'":'));
assert(editor.includes('window.SunriseOfficeExport.docx(pages)'));
assert(editor.includes('window.SunriseOfficeExport.xlsx(pages)'));
assert(editor.includes('window.SunriseOfficeExport.pageTextFromItems(content?.items)'));
assert(editor.includes('불완전한 Office 파일을 생성하지 않았습니다'));
assert(editor.includes('원래 PDF의 서식·이미지는 변환되지 않습니다'));
assert(build.includes('sunrise-office-export.js'));
console.log('PASS: PDF.js line breaks, safe Word/Excel text and ZIP, strict 32767-char/no-silent-loss, XML Unicode, limits and UI wiring');
