'use strict';
module.exports=async function launchBrowser(chromium){
 const channel=process.env.SUNRISE_BROWSER_CHANNEL;
 if(channel&&!['chrome','msedge'].includes(channel))throw Error('Unsupported validation browser channel');
 const browser=await chromium.launch({headless:true,args:process.platform==='linux'?['--no-sandbox']:[],...(channel?{channel}:{})});
 console.log('[browser-runtime] '+JSON.stringify({platform:process.platform,channel:channel||'chromium',version:browser.version()}));
 return browser;
};
