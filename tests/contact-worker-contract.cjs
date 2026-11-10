const assert=require('node:assert/strict');
const {webcrypto}=require('node:crypto');
globalThis.crypto ||= webcrypto;
(async()=>{
  const worker=(await import('../src/worker.mjs')).default;
  const stored=[],requests=[];
  const db={prepare(sql) {
    return {
      sql,args:[],bind(...args){this.args=args;return this},
      async all(){if(sql.includes('site_announcements'))return {results:[{title:'공지 제목',body:'공지 내용',published_at:'2026-10-30'}]};
        if(sql.includes('site_releases'))return {results:[{version:'버전',added:'신규',improved:'보완',removed:'삭제 없음'}]};throw Error('unknown read')}
    };
  },async batch(statements){
    assert.equal(statements.length,2,'rate limit and inquiry are one transaction');
    assert.match(statements[0].sql,/INSERT INTO inquiry_rate_limits/);
    assert.match(statements[1].sql,/INSERT INTO inquiries.*WHERE changes\(\)=1/);
    requests.push(...statements.map(x=>x.sql));stored.push(statements[1].args);
    return [{meta:{changes:1}},{meta:{changes:1}}];
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
  const fixture=require('./helpers/d1-sqlite.cjs').createD1Fixture();
  try{
   const old='2020-01-01T00:00:00.000Z';
   fixture.sqlite.prepare('INSERT INTO inquiries(category,email,message,created_at) VALUES(?,?,?,?)').run('기타','expired@example.test','만료 자료',old);
   fixture.sqlite.prepare('INSERT INTO inquiry_rate_limits(key,last_sent_ms,daily_count,day) VALUES(?,0,1,?)').run('expired-key','2020-01-01');
   await worker.scheduled({},{DB:fixture.db});
   assert.equal(fixture.sqlite.prepare('SELECT COUNT(*) n FROM inquiries').get().n,0);
   assert.equal(fixture.sqlite.prepare('SELECT COUNT(*) n FROM inquiry_rate_limits').get().n,0);
   assert.equal(fixture.sqlite.prepare('SELECT state FROM admin_maintenance_status').get().state,'succeeded');
  }finally{fixture.close()}
  console.log('PASS: public release feed, no inquiry listing, validated same-origin private D1 submissions, honeypot and retention cron');
})().catch(error=>{console.error(error);process.exitCode=1});
