(()=>{'use strict';
const form=document.getElementById('passwordChangeForm'),state=document.getElementById('state'),btn=document.getElementById('submitButton');
const hex=bytes=>Array.from(bytes,x=>x.toString(16).padStart(2,'0')).join('');
const fromHex=s=>Uint8Array.from(s.match(/.{2}/g)||[],x=>parseInt(x,16));
async function json(url,options={}){
 const res=await fetch(url,{cache:'no-store',credentials:'same-origin',...options});
 if(!(res.headers.get('content-type')||'').includes('application/json'))throw Error('인증 서버 응답이 올바르지 않습니다. (HTTP '+res.status+')');
 const data=await res.json();
 if(!res.ok)throw Error(data.error||'인증 요청 실패 (HTTP '+res.status+')');
 return data;
}
async function proof(password,salt,iterations){
 if(!/^[a-f0-9]{32}$/.test(salt)||iterations!==600000)throw Error('인증 서버 설정을 확인해 주세요.');
 const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(password),'PBKDF2',false,['deriveBits']);
 return hex(new Uint8Array(await crypto.subtle.deriveBits({name:'PBKDF2',salt:fromHex(salt),iterations,hash:'SHA-256'},key,256)));
}
form.addEventListener('submit',async ev=>{
 ev.preventDefault();if(btn.disabled||!form.reportValidity())return;
 const fd=new FormData(form),oldPassword=String(fd.get('oldPassword')||''),newPassword=String(fd.get('newPassword')||'');
 if(newPassword===oldPassword){state.textContent='기존 비밀번호와 다른 비밀번호를 사용하세요.';return;}
 if(newPassword!==fd.get('confirmPassword')){state.textContent='새 비밀번호 확인이 일치하지 않습니다.';return;}
 btn.disabled=true;state.textContent='비밀번호 검증 정보를 계산하고 있습니다.';
 try{
  const c=await json('/api/auth/challenge');
  const currentProof=await proof(oldPassword,c.salt,c.iterations);
  const newSalt=hex(crypto.getRandomValues(new Uint8Array(16)));
  const newProof=await proof(newPassword,newSalt,c.iterations);
  const result=await json('/api/auth/change-password',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({currentProof,newSalt,newProof})});
  if(!result.ok)throw Error('비밀번호 변경 결과를 확인할 수 없습니다.');
  form.reset();state.textContent='변경 완료. 모든 관리자 세션을 종료하고 로그인 페이지로 이동합니다.';
  location.replace('/admin/login/');
 }catch(error){state.textContent=error?.message||'비밀번호 변경에 실패했습니다.';}
 finally{btn.disabled=false;}
});
})();
