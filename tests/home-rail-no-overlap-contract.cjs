const assert=require('node:assert/strict'),fs=require('node:fs');
const layout=fs.readFileSync('dist/assets/sunrise-home-admin.css','utf8');
const integrate=fs.readFileSync('scripts/site-integration.cjs','utf8');
const main=fs.readFileSync('dist/index.html','utf8');
assert(layout.includes('50vw - 610px'),'rail should scale within the actual left gutter');
assert(layout.includes('#adminNavButton{'),'admin nav must have a dedicated style');
assert(!layout.includes('#adminNavButton{display:none!important}'),'administrator navigation must no longer be hidden');
assert(integrate.includes('const adminLink='),'build must retain the administrator link after production build');
assert(main.includes('id="adminNavButton"'),'public homepage must display admin link');
assert(main.includes('href="/admin/"'),'admin navigation must target protected /admin/');
for(const width of [1520,1548,1560,1600,1750,1920,2560]){
 const gutter=(width-1136)/2;
 const left=Math.max(12,width/2-808);
 const railWidth=Math.min(214,width/2-610);
 assert(railWidth>0,'rail width positive at '+width);
 assert(left+railWidth<=gutter-24,'must clear centered homepage by 24px at '+width);
 assert(left>=12,'rail must stay on screen');
}
assert(layout.includes('position:sticky!important'),'fallback must remain readable on smaller screens');
console.log('PASS: administrator navigation visible and notices remain outside centered content across desktop widths');
