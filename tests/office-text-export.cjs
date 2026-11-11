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
// Excel must preserve a line > 32,767 UTF-16 code units instead of silently truncating.
const longLine='한'.repeat(32766)+'😀'+'가'.repeat(110);
const parts=office.splitExcelText(longLine);
assert(parts.length>=2);
assert.equal(parts.join(''),longLine);
assert(parts.every(x=>x.length<=32767));
assert(!parts.some(x=>/[\uD800-\uDBFF]$/.test(x)),'must not split a surrogate pair');
const longXml=readZip(office.xlsx([longLine]))['xl/worksheets/sheet1.xml'];
for(const part of parts)assert(longXml.includes(part),'full source text must be preserved across rows');
const rowCount=(longXml.match(/<row r=/g)||[]).length;
assert.equal(rowCount,parts.length+1,'page header plus continuation rows');
assert(!longXml.includes('<f>'));
const editor=fs.readFileSync('src/editor/index.html','utf8');
const build=fs.readFileSync('scripts/build-release.cjs','utf8');
for(const id of ['exportWordText','exportExcelText'])assert(editor.includes('case "'+id+'":'));
assert(editor.includes('window.SunriseOfficeExport.docx(pages)'));
assert(editor.includes('window.SunriseOfficeExport.xlsx(pages)'));
assert(editor.includes('원래 PDF의 서식·이미지는 변환되지 않습니다'));
assert(build.includes('sunrise-office-export.js'));
console.log('PASS: text-only ZIP DOCX/XLSX, CRC32, Unicode/XML safety, no Excel formula evaluation, limits and UI wiring');
