const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..');
const homePath=path.join(root,'dist/index.html');
const editorPath=path.join(root,'dist/editor/index.html');
let home=fs.readFileSync(homePath,'utf8');
if(!home.includes('id="adminNavButton"')){
  const marker='<button type="button" class="contact-nav-button" id="contactNavButton">문의하기</button>';
  if(!home.includes(marker))throw Error('Homepage admin button anchor changed');
  home=home.replace(marker,marker+'<a id="adminNavButton" href="/admin/" title="Cloudflare Access 관리자 인증">관리자</a>');
}
if(!home.includes('/assets/sunrise-home-admin.css')){
 home=home.replace('</head>','<link rel="stylesheet" href="/assets/sunrise-home-admin.css">\n</head>');
}
if(!home.includes('/assets/sunrise-telemetry.js')){
 home=home.replace('</body>','<script defer src="/assets/sunrise-telemetry.js"></script>\n</body>');
}
home=home.replace("window.matchMedia('(max-width:1649px)')","window.matchMedia('(max-width:1519px)')");
fs.writeFileSync(homePath,home);
let editor=fs.readFileSync(editorPath,'utf8');
if(!editor.includes('/assets/sunrise-telemetry.js')){
 if(!editor.includes('</body>'))throw Error('Editor body closing tag missing');
 editor=editor.replace('</body>','<script defer src="/assets/sunrise-telemetry.js"></script>\n</body>');
 fs.writeFileSync(editorPath,editor);
}
console.log('PASS: homepage admin link, collision-free gutter styles and editor analytics installed');
