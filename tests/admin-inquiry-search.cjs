const assert=require('node:assert/strict'),fs=require('node:fs');
const {DatabaseSync}=require('node:sqlite');

(async()=>{
  const sqlite=new DatabaseSync(':memory:');
  sqlite.exec(fs.readFileSync('migrations/0001_inquiries_and_site_updates.sql','utf8'));
  sqlite.exec(fs.readFileSync('migrations/0002_admin_analytics.sql','utf8'));
  const insert=sqlite.prepare('INSERT INTO inquiries(category,email,message,status) VALUES (?,?,?,?)');
  insert.run('기능 문의','a@example.test','배율 50% 확인','new');
  insert.run('기능 문의','b@example.test','문서명 A_B 확인','answered');
  insert.run('기능 문의','c@example.test','경로 C:\\docs 확인','new');
  insert.run('기능 문의','d@example.test','일반 문장','new');
  const db={prepare(sql){const stmt=sqlite.prepare(sql);return {args:[],bind(...a){this.args=a;return this},async all(){return {results:stmt.all(...this.args)}}}}};
  const {adminApi}=await import('../src/admin-api.mjs');
  const find=async(q,status='all')=>{
    const url=new URL('https://example.test/api/admin/inquiries');url.searchParams.set('q',q);url.searchParams.set('status',status);
    const res=await adminApi(new Request(url),{DB:db},url,'admin');assert.equal(res.status,200);return (await res.json()).items.map(x=>x.email);
  };
  assert.deepEqual(await find('%'),['a@example.test']);
  assert.deepEqual(await find('_'),['b@example.test']);
  assert.deepEqual(await find('\\'),['c@example.test']);
  assert.deepEqual(await find('_','new'),[]);
  console.log('PASS: inquiry search treats percent, underscore and backslash as literal characters');
})().catch(e=>{console.error(e);process.exitCode=1});
