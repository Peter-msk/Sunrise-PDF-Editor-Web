const assert=require('node:assert/strict');
const fs=require('node:fs');
const {DatabaseSync}=require('node:sqlite');

(async()=>{
  const db=new DatabaseSync(':memory:');
  db.exec(fs.readFileSync('migrations/0001_inquiries_and_site_updates.sql','utf8'));
  db.exec('DELETE FROM site_announcements; DELETE FROM site_releases;');
  const addNotice=db.prepare('INSERT INTO site_announcements(title,body,published_at,is_active,sort_order) VALUES (?,?,?,?,?)');
  const addRelease=db.prepare('INSERT INTO site_releases(version,released_at,is_active,sort_order) VALUES (?,?,?,?)');
  for(const [name,date,active,sort] of [
    ['today','2026-11-07',1,0],['day-6','2026-11-01',1,0],
    ['day-7','2026-10-31',1,100],['future','2026-11-08',1,100],
    ['hidden','2026-11-07',0,0]
  ]) {addNotice.run(name,'내용',date,active,sort);addRelease.run(name,date,active,sort);}
  // Migration preserves the only historical date available for legacy rows.
  db.exec(fs.readFileSync('migrations/0004_publication_lifetime.sql','utf8'));
  const old=db.prepare("SELECT id,first_published_at FROM site_announcements WHERE title='day-7'").get();
  assert.equal(old.first_published_at,'2026-10-31');
  db.prepare("UPDATE site_announcements SET title='edited',published_at='2026-11-07',is_active=0 WHERE id=?").run(old.id);
  db.prepare('UPDATE site_announcements SET is_active=1 WHERE id=?').run(old.id);
  assert.equal(db.prepare('SELECT first_published_at FROM site_announcements WHERE id=?').get(old.id).first_published_at,'2026-10-31');
  assert.throws(()=>db.prepare("UPDATE site_announcements SET first_published_at='2026-11-07' WHERE id=?").run(old.id),/immutable/);

  // A draft's seven-day period starts when it is first published, not created.
  db.prepare("INSERT INTO site_announcements(title,body,published_at,is_active) VALUES ('draft','내용','2020-01-01',0)").run();
  assert.equal(db.prepare("SELECT first_published_at FROM site_announcements WHERE title='draft'").get().first_published_at,null);
  db.prepare("UPDATE site_announcements SET is_active=1 WHERE title='draft'").run();
  assert.equal(db.prepare("SELECT first_published_at FROM site_announcements WHERE title='draft'").get().first_published_at,db.prepare("SELECT date('now','+9 hours') d").get().d);
  db.prepare("UPDATE site_announcements SET is_active=0 WHERE title='draft'").run();

  // Run the real Worker queries against SQLite, with a fixed KST date.
  const adapter={prepare(sql){const statement=db.prepare(sql.replaceAll("'now'","'2026-11-06 15:00:00'"));return {async all(){return {results:statement.all()}}}}};
  const worker=(await import('../src/worker.mjs')).default;
  const response=await worker.fetch(new Request('https://example.test/api/site-updates'),{DB:adapter});
  assert.equal(response.status,200);
  const feed=await response.json();
  assert.deepEqual(feed.announcements.map(x=>x.title).sort(),['day-6','today']);
  assert.deepEqual(feed.releases.map(x=>x.version).sort(),['day-6','today']);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM site_announcements').get().n,6,'expired records remain available to administrators');
  console.log('PASS: first publication retained; KST 7-day boundaries, drafts, edits, future dates and hidden records');
})().catch(e=>{console.error(e);process.exitCode=1});
