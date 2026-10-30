const assert=require('node:assert/strict'),fs=require('node:fs');
const layout=fs.readFileSync('dist/assets/sunrise-home-admin.css','utf8');
const integrate=fs.readFileSync('scripts/site-integration.cjs','utf8');
const main=fs.readFileSync('dist/index.html','utf8');
assert(layout.includes('50vw - 610px'),'rail should scale within the actual left gutter');
assert(layout.includes('#adminNavButton{display:none!important}'),'dormant admin link must not be visible');
assert(!integrate.includes("marker+'<a id="),'build must not inject admin link');
assert(!main.includes('id="adminNavButton"'),'public homepage source must not include admin link');
for(const width of [1520,1548,1560,1600,1750,1920,2560]){
 const gutter=(width-1136)/2;
 const left=Math.max(12,width/2-808);
 const railWidth=Math.min(214,width/2-610);
 assert(railWidth>0,'rail width positive at '+width);
 assert(left+railWidth<=gutter-24,'must clear centered homepage by 24px at '+width);
 assert(left>=12,'rail must stay on screen');
}
assert(layout.includes('position:sticky!important'),'fallback must remain readable on smaller screens');
console.log('PASS: administrator entry hidden and notices remain outside centered content across desktop widths');
