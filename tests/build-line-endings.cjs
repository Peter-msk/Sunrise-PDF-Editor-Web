'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),vm=require('node:vm'),{spawnSync}=require('node:child_process');
const repo=path.resolve(__dirname,'..'),temp=fs.mkdtempSync(path.join(os.tmpdir(),'sunrise-build-endings-'));
try{
 fs.cpSync(path.join(repo,'vendor'),path.join(temp,'vendor'),{recursive:true});
 for(const dir of ['scripts','src/editor','src/assets','src/tools','dist/editor','dist/assets'])fs.mkdirSync(path.join(temp,dir),{recursive:true});
 for(const name of ['build-release.cjs','site-integration.cjs'])fs.copyFileSync(path.join(repo,'scripts',name),path.join(temp,'scripts',name));
 // Mirror the actual release asset set so new tools do not invalidate the line-ending fixture.
 for(const name of fs.readdirSync(path.join(repo,'src/assets')).filter(name=>name.endsWith('.js')))
  fs.writeFileSync(path.join(temp,'src/assets',name),'window.fixtureAsset=1;');
 fs.writeFileSync(path.join(temp,'src/tools/index.html'),'<html><body>Test tools</body></html>');
 const source=['<!doctype html><html><head></head><body>','  <script>','function sum(value) { return value + 1; } window.fixtureResult=sum(1);','  </script>','</body></html>'].join('\n');
 for(const newline of ['\n','\r\n','\r']){
  const input=source.replaceAll('\n',newline);fs.writeFileSync(path.join(temp,'src/editor/index.html'),input);
  fs.writeFileSync(path.join(temp,'dist/index.html'),'<html><head></head><body><button type="button" class="contact-nav-button" id="contactNavButton">문의하기</button><main></main></body></html>');
  const result=spawnSync(process.execPath,[path.join(temp,'scripts/build-release.cjs')],{cwd:temp,encoding:'utf8',shell:false,timeout:15000,env:{...process.env,NODE_PATH:path.join(repo,'node_modules')}});
  assert.equal(result.status,0,result.stderr);
  assert.equal(fs.readFileSync(path.join(temp,'src/editor/index.html'),'utf8'),input,'build must leave source line endings intact');
  const output=fs.readFileSync(path.join(temp,'dist/editor/index.html'),'utf8');assert(!output.includes('\r'));assert(output.includes('/assets/sunrise-telemetry.js'));
  const script=output.match(/<script>([\s\S]*?)<\/script>/)?.[1];assert(script);const context={window:{}};vm.runInNewContext(script,context);assert.equal(context.window.fixtureResult,2);
 }
 console.log('PASS: actual release build accepts LF/CRLF/CR and preserves source files');
}finally{fs.rmSync(temp,{recursive:true,force:true})}
