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

// R23: opt-in geometric table export keeps actual Excel columns, page
// numbering, missing columns and literal formula-like values.
const entry=(str,x,y,width=26)=>({str,width,transform:[10,0,0,10,x,y],hasEOL:false});
const tabular=[
 entry('사업명',40,700,50),entry('계약금액',220,700,70),
 entry('A구역',40,677,55),entry('1000',220,677,45),
 entry('B구역',40,654,55),entry('=2+3',220,654,45)
];
// PDF.js inserts space-only, wide text spans between text columns.
const spaced=readZip(office.xlsxColumns([[
 ...tabular,entry(' ',90,700,130),entry(' ',95,677,125),entry(' ',95,654,125)
]]))['xl/worksheets/sheet1.xml'];
assert(spaced.includes('<c r="C4" t="inlineStr"><is><t xml:space="preserve">=2+3'));
assert(!spaced.includes('<c r="D4"'),'large PDF.js spaces cannot create extra Excel columns');
const table=readZip(office.xlsxColumns([tabular]))['xl/worksheets/sheet1.xml'];
assert(table.includes('<c r="A2" t="inlineStr">'),'page number column must persist');
assert(table.includes('<c r="B2" t="inlineStr"><is><t xml:space="preserve">사업명'));
assert(table.includes('<c r="C2" t="inlineStr"><is><t xml:space="preserve">계약금액'));
assert(table.includes('<c r="C4" t="inlineStr"><is><t xml:space="preserve">=2+3'));
assert(!table.includes('<f>'),'PDF text must not execute Excel formulas');
const partial=readZip(office.xlsxColumns([[
 ...tabular,entry('검토',40,630,30)
]]))['xl/worksheets/sheet1.xml'];
assert(partial.includes('<c r="B5" t="inlineStr"><is><t xml:space="preserve">검토'));
assert(!partial.includes('<c r="C5"'),'single-column note must not shift');
const withPlain=readZip(office.xlsxColumns([
 tabular,[entry('본문 설명',40,700,70)]
]))['xl/worksheets/sheet1.xml'];
assert(withPlain.includes('본문 설명'),'non-table pages must still be included');
for(const items of [
 [entry('혼자',50,700)],
 [entry('한줄',40,700,30),entry('끝',230,700,30)],
 [entry('가',40,700),entry('나',220,700),entry('다',40,678),entry('라',275,678)]
])assert.throws(()=>office.xlsxColumns([items]),/표|열/);
assert.throws(()=>office.xlsxColumns([[{str:'회전',width:50,transform:[0,10,-10,0,50,700]},...tabular]]),/회전/);
assert.throws(()=>office.xlsxColumns([tabular,tabular.map(it=>({...it,str:'\ud800'}))]),/Unicode/);
assert.throws(()=>office.xlsxColumns(Array(121).fill(tabular)),/120/);

// R26: stable global columns, notes and large-table performance.
const sparsePage=[
 entry('사업',40,700),entry('금액',340,700),
 entry('A사업',40,676),entry('1000',340,676)
];
const richPage=[
 entry('사업',40,700),entry('단위',190,700),entry('금액',340,700),
 entry('B사업',40,676),entry('건',190,676),entry('=2+3',340,676),
 entry('검토 안내',270,650)
];
const schemaXml=readZip(office.xlsxColumns([sparsePage,richPage]))['xl/worksheets/sheet1.xml'];
assert(schemaXml.includes('<c r="D2" t="inlineStr"><is><t xml:space="preserve">금액'));
assert(!schemaXml.includes('<c r="C2"'),'blank middle column must remain blank');
assert(schemaXml.includes('<c r="C4" t="inlineStr"><is><t xml:space="preserve">단위'));
assert(schemaXml.includes('<c r="D5" t="inlineStr"><is><t xml:space="preserve">=2+3'));
assert(schemaXml.includes('<c r="E6" t="inlineStr"><is><t xml:space="preserve">검토 안내'));
assert(schemaXml.includes('비정렬 원문'),'off-grid text must have its own column');
assert(!schemaXml.includes('<f>'),'formula-like PDF strings must remain inert');
const plainXml=readZip(office.xlsxColumns([sparsePage,[entry('일반 설명',100,700)]]))['xl/worksheets/sheet1.xml'];
assert(plainXml.includes('일반 설명'),'plain-page text must survive');
assert(!plainXml.includes('<c r="B4"'),'plain text must not move to table column one');
assert.throws(()=>office.xlsxColumns([richPage.slice(0,6),[
 entry('사업',40,700),entry('단위',216,700),entry('금액',340,700),
 entry('C사업',40,676),entry('건',216,676),entry('3000',340,676)
]]),/열 배치/,'incompatible page schemas must be rejected');
const highVolume=[];
for(let i=0;i<1800;i++)highVolume.push(entry('A'+i,40,40000-i*18),entry('B'+i,340,40000-i*18));
const highVolumeXml=readZip(office.xlsxColumns([highVolume]))['xl/worksheets/sheet1.xml'];
assert.equal((highVolumeXml.match(/<row r=/g)||[]).length,1801,'large table rows');
assert(highVolumeXml.includes('A1799')&&highVolumeXml.includes('B1799'),'large table content');

const editor=fs.readFileSync('src/editor/index.html','utf8');
// R32 DEV1: opt-in editable Word paragraphs, heading inference, regular-grid
// table reconstruction and a strictly limited rotation/readability contract.
const structured=readZip(office.docxLayout([{
 items:[entry('사업 현황',40,744,90),...tabular],
 styles:{},width:600,height:800,rotation:0
}]));
const wordXml=structured['word/document.xml'];
assert(wordXml.includes('<w:tbl>'),'regular 3-row columns must become editable Word table cells');
assert(wordXml.includes('사업명')&&wordXml.includes('계약금액')&&wordXml.includes('B구역'));
assert(structured['word/styles.xml']?.includes('Heading1'));
assert(structured['word/_rels/document.xml.rels']?.includes('styles.xml'));
assert.throws(()=>office.docxLayout([{
 items:[entry('세로쓰기',40,700)],width:600,height:800,rotation:90
}]),/회전/,'rotated pages must fail closed rather than claiming exact layout');
assert.throws(()=>office.docxLayout([{
 items:[entry('정상',40,700),{...entry('불량',100,700),transform:[0,10,-10,0,100,700]}],
 width:600,height:800,rotation:0
}]),/회전/,'rotated text items must not be silently discarded');
assert(editor.includes('case "exportWordLayout":'),'new Word layout command must be wired');
assert(editor.includes('window.SunriseOfficeExport.docxLayout(layoutPages)'));

const build=fs.readFileSync('scripts/build-release.cjs','utf8');
for(const id of ['exportWordText','exportExcelText'])assert(editor.includes('case "'+id+'":'));
assert(editor.includes('window.SunriseOfficeExport.docx(pages)'));
assert(editor.includes('window.SunriseOfficeExport.xlsx(pages)'));
assert(editor.includes('case "exportExcelColumns":'));
assert(editor.includes('window.SunriseOfficeExport.xlsxColumns(columnPages)'));
assert(editor.includes('Excel 표 열 추정'));
assert(editor.includes('window.SunriseOfficeExport.pageTextFromItems(content?.items)'));
assert(editor.includes('불완전한 Office 파일을 생성하지 않았습니다'));
assert(editor.includes('원래 PDF의 서식·이미지는 변환되지 않습니다'));
assert(build.includes('sunrise-office-export.js'));
console.log('PASS: PDF.js line breaks, safe Word/Excel text and ZIP, strict 32767-char/no-silent-loss, XML Unicode, limits and UI wiring');
