const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..');
const homePath=path.join(root,'dist/index.html');
const editorPath=path.join(root,'dist/editor/index.html');
let home=fs.readFileSync(homePath,'utf8');
// Administrator has completed initial registration. Keep a visible link on the
// public homepage; actual authorization is always enforced by the Worker.
const adminLink='<a id="adminNavButton" class="btn small" href="/admin/" aria-label="Sunrise PDF Editor 관리자 페이지">관리자</a>';
if(!home.includes('id="adminNavButton"')){
 const anchor='<button type="button" class="contact-nav-button" id="contactNavButton">문의하기</button>';
 if(!home.includes(anchor))throw Error('Contact navigation anchor missing');
 home=home.replace(anchor,anchor+adminLink);
}
if(!home.includes('href="/admin/"'))throw Error('Administrator link must point to the protected dashboard');
if(!home.includes('/assets/sunrise-home-admin.css')){
 home=home.replace('</head>','<link rel="stylesheet" href="/assets/sunrise-home-admin.css">\n</head>');
}
if(!home.includes('/assets/sunrise-telemetry.js')){
 home=home.replace('</body>','<script defer src="/assets/sunrise-telemetry.js"></script>\n</body>');
}
home=home.replace("window.matchMedia('(max-width:1649px)')","window.matchMedia('(max-width:1519px)')");
if(!home.includes('id="anonymousStatsNotice"')){
  home=home.replace('</main>', '<p id="anonymousStatsNotice" style="max-width:1136px;margin:0 auto 18px;padding:0 16px;font-size:11px;color:#637b8e">사이트는 방문 세션, 편집기 활성 사용시간, 기능 오류의 유형별 횟수만 익명 집계합니다. PDF 내용·파일명·검색어·오류 전문은 수집하지 않습니다.</p></main>');
}
fs.writeFileSync(homePath,home);
let editor=fs.readFileSync(editorPath,'utf8');
if(!editor.includes('/assets/sunrise-telemetry.js')){
 if(!editor.includes('</body>'))throw Error('Editor body closing tag missing');
 editor=editor.replace('</body>','<script defer src="/assets/sunrise-telemetry.js"></script>\n</body>');
 fs.writeFileSync(editorPath,editor);
}
console.log('PASS: public administrator navigation enabled, protected admin destination and analytics integrated');
