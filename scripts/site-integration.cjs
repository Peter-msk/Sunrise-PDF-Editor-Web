const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..');
const homePath=path.join(root,'dist/index.html');
const editorPath=path.join(root,'dist/editor/index.html');
let home=fs.readFileSync(homePath,'utf8');
// Preserve the administrator's server-side code but hide all public navigation until Access is configured.
const hiddenAdminLink='<a id="adminNavButton" href="/admin/" title="Cloudflare Access 관리자 인증">관리자</a>';
home=home.replaceAll(hiddenAdminLink,'');
if(home.includes('id="adminNavButton"'))throw Error('Unexpected admin navigation element in public homepage');
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
console.log('PASS: public admin navigation hidden, collision-free notice rail and analytics build integrated');
