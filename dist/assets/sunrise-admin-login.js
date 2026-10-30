(()=>{'use strict';
const form=document.querySelector('#authForm');
const status=document.querySelector('#status');
const setup=document.body.dataset.mode==='setup';
const btn=document.querySelector('#submit');
const message=text=>{status.textContent=text};
const bytesToHex=bytes=>Array.from(bytes,x=>x.toString(16).padStart(2,'0')).join('');
const hexToBytes=s=>Uint8Array.from(s.match(/.{2}/g)||[],v=>parseInt(v,16));
async function requestJson(url,options={}){
 const res=await fetch(url,{cache:'no-store',credentials:'same-origin',...options});
 const type=(res.headers.get('content-type')||'').toLowerCase();
 if(!type.includes('application/json')){
  throw Error('관리자 인증 서버가 정상적인 응답을 반환하지 않았습니다. 서버 오류 또는 리소스 제한 여부를 확인해 주세요. (HTTP '+res.status+')');
 }
 let data;
 try{data=await res.json();}
 catch{throw Error('관리자 인증 서버 응답 형식에 문제가 있습니다.')}
 if(!res.ok||data?.ok===false)throw Error(data?.error||'인증 요청이 처리되지 않았습니다. (HTTP '+res.status+')');
 return data;
}
async function deriveProof(password,salt,iterations){
 if(!/^[a-f0-9]{32}$/.test(salt)||iterations!==600000)throw Error('인증 서버의 암호화 설정이 올바르지 않습니다.');
 const base=await crypto.subtle.importKey('raw',new TextEncoder().encode(password),'PBKDF2',false,['deriveBits']);
 const bits=await crypto.subtle.deriveBits({name:'PBKDF2',salt:hexToBytes(salt),iterations,hash:'SHA-256'},base,256);
 return bytesToHex(new Uint8Array(bits));
}
async function loadState(){
 try{
  const info=await requestJson('/api/auth/status');
  if(setup){
   if(info.configured){form.hidden=true;message('관리자 계정은 이미 설정됐습니다. 로그인 페이지를 이용하세요.');}
   else if(!info.setupEnabled){form.hidden=true;message('Cloudflare Workers의 ADMIN_BOOTSTRAP_TOKEN 비밀값을 먼저 설정해야 합니다.');}
  }else if(!info.configured){message('관리자 계정 등록이 필요합니다. 초기 설정은 /admin/setup/에서 진행합니다.');}
 }catch(err){message(err.message||'인증 서비스 연결 상태를 확인할 수 없습니다.')}
}
form.addEventListener('submit',async e=>{
 e.preventDefault();
 if(btn.disabled||!form.reportValidity())return;
 const fd=new FormData(form);
 const username=String(fd.get('username')||'');
 const password=String(fd.get('password')||'');
 if(password.length<16||password.length>128){message('비밀번호는 16~128자로 지정해 주세요.');return}
 if(setup&&password!==fd.get('confirm')){message('비밀번호 확인이 일치하지 않습니다.');return}
 btn.disabled=true;
 message('비밀번호 보안 연산을 진행 중입니다.');
 try{
  let salt,iterations=600000;
  if(setup){
   salt=bytesToHex(crypto.getRandomValues(new Uint8Array(16)));
  }else{
   const challenge=await requestJson('/api/auth/challenge');
   salt=challenge.salt;iterations=challenge.iterations;
  }
  const passwordProof=await deriveProof(password,salt,iterations);
  const payload=setup?
   {username,passwordProof,passwordSalt:salt,bootstrapToken:fd.get('bootstrapToken')}:
   {username,passwordProof};
  message('관리자 서버에서 인증을 확인하고 있습니다.');
  const data=await requestJson(setup?'/api/auth/setup':'/api/auth/login',{
   method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(payload)
  });
  if(!data?.ok)throw Error('인증 결과가 확인되지 않았습니다.');
  form.reset();
  location.assign(setup?'/admin/login/':'/admin/');
 }catch(err){message(err?.message||'인증 처리 중 문제가 발생했습니다.')}
 finally{btn.disabled=false}
});
loadState();
})();
