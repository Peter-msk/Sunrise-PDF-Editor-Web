(()=>{'use strict';
const form=document.querySelector('#authForm');
const status=document.querySelector('#status');
const setup=document.body.dataset.mode==='setup';
const btn=document.querySelector('#submit');
const message=text=>{status.textContent=text};
async function loadState(){
 try{
  const r=await fetch('/api/auth/status',{cache:'no-store',credentials:'same-origin'});
  const info=await r.json();
  if(setup){
   if(info.configured){form.hidden=true;message('관리자 계정은 이미 설정됐습니다. 로그인 페이지를 이용하세요.');}
   else if(!info.setupEnabled){form.hidden=true;message('Cloudflare Workers의 ADMIN_BOOTSTRAP_TOKEN 비밀값을 먼저 설정해야 합니다.');}
  }else if(!info.configured){message('관리자 계정 등록이 필요합니다. 초기 설정은 /admin/setup/에서 진행합니다.');}
 }catch{message('인증 서비스 연결 상태를 확인할 수 없습니다.')}
}
form.addEventListener('submit',async e=>{
 e.preventDefault();if(btn.disabled||!form.reportValidity())return;
 const fd=new FormData(form);
 const username=String(fd.get('username')||''),password=String(fd.get('password')||'');
 if(password.length<16||password.length>128){message('비밀번호는 16~128자로 지정해 주세요.');return;}
 if(setup&&password!==fd.get('confirm')){message('비밀번호 확인이 일치하지 않습니다.');return;}
 const body=setup?{username,password,bootstrapToken:fd.get('bootstrapToken')}:{username,password};
 btn.disabled=true;message('인증 요청을 처리 중입니다.');
 try{
  const res=await fetch(setup?'/api/auth/setup':'/api/auth/login',{method:'POST',headers:{'content-type':'application/json'},credentials:'same-origin',body:JSON.stringify(body)});
  const result=await res.json();
  if(!res.ok||!result.ok)throw Error(result.error||'인증 요청에 실패했습니다.');
  form.reset();
  location.assign(setup?'/admin/login/':'/admin/');
 }catch(err){message(err?.message||'인증 서버에 연결할 수 없습니다.');}
 finally{btn.disabled=false;}
});
loadState();
})();
