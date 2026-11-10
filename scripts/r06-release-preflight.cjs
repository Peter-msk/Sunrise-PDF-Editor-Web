'use strict';
// R06: fail closed on an incomplete source-only/preview distribution.
// No network calls, no secrets, no Cloudflare or GitHub writes.
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const root=path.resolve(__dirname,'..');
const failures=[];
const font=path.join(root,'dist/assets/fonts/DroidSansFallback.ttf');
if (!fs.existsSync(font)) failures.push('필수 번들 글꼴 파일 누락: dist/assets/fonts/DroidSansFallback.ttf');
else {
 const info=fs.statSync(font);
 if (!info.isFile()||info.size<1024) failures.push('번들 글꼴이 비어 있거나 정상 파일이 아닙니다.');
 else {
  const header=Buffer.alloc(4);
  const fd=fs.openSync(font,'r');try{fs.readSync(fd,header,0,4,0);}finally{fs.closeSync(fd);}
  if (![0x00010000,0x4f54544f,0x74727565].includes(header.readUInt32BE(0)))
   failures.push('번들 글꼴 형식이 TrueType/OpenType이 아닙니다.');
  const bytes=fs.readFileSync(font);
  const gitBlob=crypto.createHash('sha1').update(Buffer.from(`blob ${bytes.length}\0`)).update(bytes).digest('hex');
  if (gitBlob !== 'cc7d41d3483cafbbbda246ee4a2bb93f88a51835')
   failures.push('번들 글꼴이 운영 소스에 고정된 원본과 다릅니다.');
 }
}
const standardFonts=['FoxitDingbats.pfb','FoxitFixed.pfb','FoxitFixedBold.pfb',
 'FoxitFixedBoldItalic.pfb','FoxitFixedItalic.pfb','FoxitSerif.pfb',
 'FoxitSerifBold.pfb','FoxitSerifBoldItalic.pfb','FoxitSerifItalic.pfb',
 'FoxitSymbol.pfb','LiberationSans-Bold.ttf','LiberationSans-BoldItalic.ttf',
 'LiberationSans-Italic.ttf','LiberationSans-Regular.ttf'];
for (const file of standardFonts) {
 const fontFile=path.join(root,'dist/assets/pdfjs/standard_fonts',file);
 if (!fs.existsSync(fontFile)||!fs.statSync(fontFile).size)
  failures.push('PDF.js 필수 기본 글꼴 누락: '+file);
}
// R07 offline build: no Terser installation is required. Vendored libraries are
// verified by the build script's pinned SHA-256 provenance manifests.
if(process.argv.includes('--post-build')){
 if(fs.existsSync(path.join(root,'dist/SUNRISE_PREVIEW_ONLY.json')))
  failures.push('프리뷰 전용 산출물이 남아 있어 운영 배포할 수 없습니다.');
 const manifest=path.join(root,'dist/SUNRISE_RELEASE_MANIFEST.json');
 if(fs.existsSync(path.join(root,'dist/SUNRISE_BUILD_INCOMPLETE.json')))
  failures.push('정식 빌드가 완료되지 않았습니다.');
 if(!fs.existsSync(manifest)) failures.push('정식 빌드 파일 지문 목록이 없습니다.');
 else {
  try{
   const data=JSON.parse(fs.readFileSync(manifest,'utf8'));
   if(data.build!=='offline-source-preserving'||data.minifier!=='none'||!data.assets||!Object.keys(data.assets).length)
     throw Error('비정상 배포 매니페스트');
   for(const [rel,hash] of Object.entries(data.assets)){
    if(!/^(?:assets\/[A-Za-z0-9._-]+\.js|editor\/index\.html|tools\/index\.html|index\.html)$/.test(rel)) throw Error('허용되지 않은 배포 경로 '+rel);
    const f=path.join(root,'dist',rel);
    if(!fs.existsSync(f)||crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex')!==hash) throw Error('배포 파일 해시 불일치 '+rel);
   }
  }catch(e){failures.push('정식 배포 자산 무결성 오류: '+e.message);}
 }
 const built=path.join(root,'dist/editor/index.html');
 if(!fs.existsSync(built)||!fs.statSync(built).size)
  failures.push('정식 편집기 빌드 결과가 없습니다.');
}
if(failures.length){for(const f of failures)console.error('BLOCK R07: '+f);process.exitCode=1;}
else console.log('PASS R07: required fonts, offline vendor verification and '+(process.argv.includes('--post-build')?'production marker':'source')+' gate');
