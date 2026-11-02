'use strict';
const fs=require('node:fs'),path=require('node:path'),{spawnSync}=require('node:child_process');
const root=path.resolve(__dirname,'..'),group=process.argv[2];
const groups=['admin','batch','editor'];
if(!groups.includes(group)){
 console.error('Usage: node scripts/run-focused-tests.cjs admin|batch|editor');
 process.exitCode=2;
}else{
 const commands=require(path.join(root,'package.json')).scripts.test.split(' && ');
 const tests=commands.map(command=>{
  const match=/^node tests\/([a-z0-9-]+\.cjs)$/.exec(command);
  if(!match)throw Error('Unexpected test command: '+command);
  return match[1];
 });
 if(new Set(tests).size!==tests.length)throw Error('Duplicate test script');
 const isAdmin=name=>/(admin|publication|telemetry|contact|homepage|home-rail)/.test(name);
 const isBatch=name=>/(batch|compress|form|pdf-submission|saved-pdf|auto-text-bookmarks)/.test(name);
 const selected=tests.filter(name=>group==='admin'?isAdmin(name):group==='batch'?!isAdmin(name)&&isBatch(name):!isAdmin(name)&&!isBatch(name));
 if(!selected.length)throw Error('No selected tests');
 console.log('[focused] '+group+' : '+selected.length+' of '+tests.length+' tests');
 for(const name of selected){
  const file=path.join(root,'tests',name);
  if(!fs.existsSync(file))throw Error('Missing test: '+file);
  const proc=spawnSync(process.execPath,[file],{cwd:root,stdio:'inherit',env:process.env});
  if(proc.error||proc.status!==0){console.error('FAILED: '+name,proc.error||'');process.exitCode=proc.status||1;break;}
 }
 if(!process.exitCode)console.log('[focused] PASS '+group+' ('+selected.length+' tests)');
}
