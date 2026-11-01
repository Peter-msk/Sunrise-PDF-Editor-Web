// USR-14 local AES-256 PDF protection with the established qpdf engine.
// This is a desktop-side helper, not browser-side encryption.
'use strict';
const fs=require('node:fs/promises');
const path=require('node:path');
const crypto=require('node:crypto');
const {spawn}=require('node:child_process');
const MAX_FILE=50*1024*1024;
const MAX_SECRET_BYTES=200;

async function invokeQpdf(args,stdin='',binary='qpdf'){
 return new Promise((resolve,reject)=>{
  const child=spawn(binary,args,{shell:false,windowsHide:true,stdio:['pipe','pipe','pipe']});
  let stdout='',bytes=0,complete=false;
  const timeout=setTimeout(()=>{child.kill();},60000);
  child.once('error',error=>{if(!complete){complete=true;clearTimeout(timeout);reject(new Error('QPDF 실행 실패: 설치 및 실행 경로를 확인하세요.'));}});
  child.stdout.on('data',data=>{bytes+=data.length;if(bytes<4096)stdout+=data.toString('utf8');});
  // Never surface stderr. It may contain sensitive paths or input context.
  child.stderr.on('data',()=>{});
  child.once('close',(code,signal)=>{
   if(complete)return;
   complete=true;clearTimeout(timeout);
   if(signal)reject(new Error('QPDF 변환이 제한 시간을 초과하거나 중단되었습니다.'));
   else resolve({code,stdout});
  });
  child.stdin.on('error',()=>{});
  child.stdin.end(stdin);
 });
}
function validatePassword(secret){
 if(typeof secret!=='string')throw Error('문서 열기 암호를 입력하세요.');
 if(/[\r\n\u0000]/.test(secret))throw Error('암호에 줄바꿈이나 NUL을 사용할 수 없습니다.');
 const bytes=Buffer.byteLength(secret,'utf8');
 if(bytes<12||bytes>MAX_SECRET_BYTES)throw Error('암호는 UTF-8 기준 12~200바이트여야 합니다.');
 return secret;
}
function argsOnStdin(lines){
 if(lines.some(x=>typeof x!=='string'||/[\r\n\u0000]/.test(x)))
  throw Error('QPDF 인수에 줄바꿈이나 제어문자가 있습니다.');
 return lines.join('\n')+'\n';
}
async function protectPdfFile({inputPath,outputPath,password,qpdf=invokeQpdf}){
 validatePassword(password);
 if(typeof inputPath!=='string'||typeof outputPath!=='string'||!inputPath||!outputPath)
  throw Error('PDF 입력 파일과 출력 경로가 필요합니다.');
 const source=path.resolve(inputPath),target=path.resolve(outputPath);
 if(source===target||!target.toLowerCase().endsWith('.pdf'))
  throw Error('출력 경로는 원본과 다른 .pdf 파일이어야 합니다.');
 if(/[\r\n\u0000]/.test(source+target))throw Error('파일 경로에 사용할 수 없는 문자가 있습니다.');
 const stat=await fs.lstat(source);
 if(!stat.isFile()||stat.isSymbolicLink()||!stat.size||stat.size>MAX_FILE)
  throw Error('원본 PDF는 심볼릭 링크가 아닌 50 MiB 이하의 일반 파일이어야 합니다.');
 const file=await fs.open(source,'r');
 try{
  const header=Buffer.alloc(8);
  const {bytesRead}=await file.read(header,0,8,0);
  if(bytesRead<8||!header.toString('ascii').startsWith('%PDF-'))
   throw Error('PDF 헤더가 올바르지 않습니다.');
 }finally{await file.close();}
 try{await fs.lstat(target);throw Error('출력 파일이 이미 존재합니다. 덮어쓰지 않습니다.');}
 catch(error){if(error.code!=='ENOENT')throw error;}
 const version=await qpdf(['--version']);
 const match=version.stdout?.match(/qpdf version (\d+)\.(\d+)/i);
 if(version.code!==0||!match||Number(match[1])<11||
    Number(match[1])===11&&Number(match[2])<7)
  throw Error('QPDF 11.7 이상이 필요합니다.');
 const original=await qpdf(['--requires-password',source]);
 if(original.code!==2)throw Error('이미 암호화된 PDF이거나 입력 구조가 지원되지 않습니다.');
 const owner=crypto.randomBytes(32).toString('base64url');
 const dir=await fs.mkdtemp(path.join(path.dirname(target),'.sunrise-pdf-lock-'));
 await fs.chmod(dir,0o700).catch(()=>{});
 const stage=path.join(dir,'protected.pdf');
 try{
  // @- carries the password via stdin rather than the process list.
  const cmd=[
   '--encrypt','--user-password='+password,'--owner-password='+owner,
   '--bits=256','--',source,stage
  ];
  const encrypted=await qpdf(['@-'],argsOnStdin(cmd));
  if(encrypted.code!==0)throw Error('AES-256 암호화 엔진이 실패했습니다.');
  const encryptedStat=await fs.lstat(stage);
  if(!encryptedStat.isFile()||encryptedStat.size<80||encryptedStat.size>MAX_FILE)
   throw Error('암호화 결과 PDF의 크기 또는 형식이 올바르지 않습니다.');
  const probe=await fs.open(stage,'r');
  try{const magic=Buffer.alloc(5);await probe.read(magic,0,5,0);
   if(magic.toString('ascii')!=='%PDF-')throw Error('PDF 출력 헤더가 올바르지 않습니다.');
  }finally{await probe.close();}
  // Do not accept a 'protected' result unless qpdf confirms encryption,
  // a password barrier, successful unlock and failure with a wrong password.
  const encryptedFlag=await qpdf(['--is-encrypted',stage]);
  const required=await qpdf(['--requires-password',stage]);
  const accepted=await qpdf(['@-'],argsOnStdin(['--password='+password,'--check',stage]));
  const wrong=crypto.randomBytes(48).toString('base64url');
  const rejected=await qpdf(['@-'],argsOnStdin(['--password='+wrong,'--check',stage]));
  if(encryptedFlag.code!==0||required.code!==0||accepted.code!==0||rejected.code===0)
   throw Error('출력 PDF의 암호화 및 암호 검증에 실패했습니다.');
  const originalAgain=await fs.stat(source);
  if(originalAgain.size!==stat.size||originalAgain.mtimeMs!==stat.mtimeMs)
   throw Error('암호화 도중 원본 PDF가 변경됐습니다.');
  // Atomic publish on the same disk: do not overwrite an existing target.
  await fs.link(stage,target);
  return {outputPath:target,bytes:encryptedStat.size,method:'qpdf AES-256',verified:true};
 }finally{
  await fs.rm(dir,{recursive:true,force:true});
 }
}
async function readHiddenSecret(prompt,stdin=process.stdin,stderr=process.stderr){
 if(!stdin.isTTY||typeof stdin.setRawMode!=='function')
  throw Error('비밀번호 입력은 대화형 터미널에서만 허용합니다.');
 stderr.write(prompt);
 const data=[];
 let bytes=0;
 stdin.resume();stdin.setRawMode(true);
 return new Promise((resolve,reject)=>{
  const cleanup=()=>{stdin.off('data',onData);stdin.off('error',onError);stdin.setRawMode(false);stdin.pause();stderr.write('\n');};
  const onError=()=>{cleanup();reject(Error('암호 입력 도중 오류가 발생했습니다.'));};
  function onData(chunk){
   for(const c of chunk){
    if(c===3){cleanup();reject(Error('사용자가 입력을 취소했습니다.'));return;}
    if(c===13||c===10){
     const copy=Buffer.from(data);cleanup();
     const secret=copy.toString('utf8');copy.fill(0);data.fill(0);resolve(secret);return;
    }
    if(c===127||c===8){
     if(bytes){while(bytes&&(data[--bytes]&0xc0)===0x80)data.pop();data.pop();stderr.write('\b \b');}
     continue;
    }
    if(c<32||c===127)continue;
    if(bytes>=MAX_SECRET_BYTES){cleanup();reject(Error('암호가 200바이트를 초과합니다.'));return;}
    data.push(c);bytes++;stderr.write('*');
   }
  }
  stdin.on('data',onData);stdin.once('error',onError);
 });
}
async function cli(argv){
 if(argv.length!==2)throw Error('사용법: node scripts/protect-pdf-local.cjs 입력.pdf 새출력.pdf');
 const [first,second]=await Promise.all([
  readHiddenSecret('PDF 열기 암호(12바이트 이상): '),
  Promise.resolve(null)
 ]);
 const confirm=await readHiddenSecret('암호 재입력: ');
 if(first!==confirm)throw Error('입력한 두 암호가 서로 다릅니다.');
 const result=await protectPdfFile({inputPath:argv[0],outputPath:argv[1],password:first});
 process.stdout.write('AES-256 암호 보호 PDF 저장 완료: '+result.outputPath+'\n');
}
if(require.main===module)cli(process.argv.slice(2)).catch(error=>{
 console.error('보호 PDF 생성 실패: '+error.message);
 process.exitCode=1;
});
module.exports={protectPdfFile,invokeQpdf,validatePassword,argsOnStdin,readHiddenSecret};
