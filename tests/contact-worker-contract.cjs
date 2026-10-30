const assert=require('node:assert/strict');
const {webcrypto}=require('node:crypto');
globalThis.crypto ||= webcrypto;
(async()=>{
  const worker=(await import('../src/worker.mjs')).default;
  const stored=[],requests=[];
  const db={prepare(sql) {
    return {
      args:[],bind(...args){this.args=args;return this},
      async all(){if(sql.includes('site_announcements'))return {results:[{title:'공지 제목',body:'공지 내용',published_at:'2026-10-30'}]};
        if(sql.includes('site_releases'))return {results:[{version:'버전',added:'신규',improved:'보완',removed:'삭제 없음'}]};throw Error('unknown read')},
      async first(){assert(sql.includes('inquiry_rate_limits'));return {key:'rate-key'};},
      async run(){requests.push(sql);if(sql.startsWith('INSERT INTO inquiries'))stored.push(this.args);return {success:true};}
    };
  }};
  const env={DB:db,INQUIRY_HASH_SALT:'test-only-secret',ASSETS:{fetch:async()=>new Response('static',{status:200})}};
  const origin='https://example.test';
  const call=(method,path,body,headers={})=>worker.fetch(new Request(origin+path,{method,headers,body}),env);
  let res=await call('GET','/api/site-updates');
  assert.equal(res.status,200);const feed=await res.json();assert.equal(feed.announcements[0].title,'공지 제목');
  assert.equal(feed.releases[0].version,'버전');assert(!JSON.stringify(feed).includes('stored'));
  res=await call('GET','/api/inquiries');assert.equal(res.status,405);
  res=await call('GET','/editor/');assert.equal(await res.text(),'static');
  const payload={category:'개선 제안',email:'User@Example.Com',message:'이것은 테스트 문의입니다. 실제 저장된 개인 정보가 아닙니다.',website:'',consent:true};
  const send=(p,headers={'origin':origin,'content-type':'application/json'})=>
    call('POST','/api/inquiries',JSON.stringify(p),headers);
  res=await send(payload);assert.equal(res.status,201);assert.equal((await res.json()).ok,true);
  assert.equal(stored.length,1);assert.deepEqual(stored[0].slice(0,2),['개선 제안','user@example.com']);
  res=await send({...payload,consent:false});assert.equal(res.status,400);
  res=await send({...payload,category:'관리자'});assert.equal(res.status,400);
  res=await send({...payload,message:'짧음'});assert.equal(res.status,400);
  res=await send({...payload,email:'invalid'});assert.equal(res.status,400);
  res=await send({...payload,website:'https://bot.example'});assert.equal(res.status,200);assert.equal(stored.length,1);
  res=await send(payload,{'origin':'https://attacker.example','content-type':'application/json'});assert.equal(res.status,403);
  res=await send(payload,{'origin':origin,'content-type':'text/plain'});assert.equal(res.status,415);
  res=await call('GET','/api/unlisted');assert.equal(res.status,404);
  await worker.scheduled({},env);
  assert(requests.some(x=>x.includes('DELETE FROM inquiries WHERE created_at')));
  assert(requests.some(x=>x.includes('DELETE FROM inquiry_rate_limits WHERE day')));
  console.log('PASS: public release feed, no inquiry listing, validated same-origin private D1 submissions, honeypot and retention cron');
})().catch(error=>{console.error(error);process.exitCode=1});
