'use strict';
// Operator-only export. No remote restore or automatic migration execution.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {spawnSync}=require('node:child_process');
const [database,output]=process.argv.slice(2);
let privateDir;
try{
 if(!database||!/^[A-Za-z0-9_-]{1,100}$/.test(database)||!output)throw Error('Usage: node scripts/d1_backup.cjs DATABASE NEW_EXPORT.sql');
 const destination=path.resolve(output),repo=path.resolve(__dirname,'..');
 if(destination===repo||destination.startsWith(repo+path.sep))throw Error('Choose private storage outside the source repository');
 if(fs.existsSync(destination))throw Error('Output already exists');
 privateDir=fs.mkdtempSync(path.join(path.dirname(destination),'.sunrise-d1-export-'));fs.chmodSync(privateDir,0o700);
 const temporary=path.join(privateDir,'database.sql');
 const result=spawnSync(process.env.WRANGLER_BIN||'wrangler',['d1','export',database,'--remote','--output',temporary,'--skip-confirmation'],{shell:false,encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:120000});
 if(result.error||result.status!==0)throw Error('D1 export failed; no successful backup was recorded');
 if(!fs.statSync(temporary).size)throw Error('Empty export');
 fs.chmodSync(temporary,0o600);
 const hash=crypto.createHash('sha256'),buffer=Buffer.alloc(1024*1024),fd=fs.openSync(temporary,'r');
 try{let length;while((length=fs.readSync(fd,buffer,0,buffer.length,null))>0)hash.update(buffer.subarray(0,length))}finally{fs.closeSync(fd)}
 const sha256=hash.digest('hex');
 fs.linkSync(temporary,destination); // Atomic publication; never overwrites an existing file.
 console.log(JSON.stringify({operation:'d1-sql-export',bytes:fs.statSync(destination).size,sha256,restorationVerified:false}));
}catch(error){console.error(error.message);process.exitCode=1}
finally{if(privateDir)fs.rmSync(privateDir,{recursive:true,force:true})}
