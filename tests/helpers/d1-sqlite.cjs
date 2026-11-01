'use strict';
const fs=require('node:fs'),path=require('node:path');
const {DatabaseSync}=require('node:sqlite');
// Real SQL and transactional batch semantics for administrator contract tests.
function createD1Fixture(){
 const sqlite=new DatabaseSync(':memory:');
 const directory=path.resolve(__dirname,'../../migrations');
 try{for(const file of fs.readdirSync(directory).sort())if(file.endsWith('.sql'))sqlite.exec(fs.readFileSync(path.join(directory,file),'utf8'))}
 catch(error){sqlite.close();throw error}
 const db={prepare(sql){const statement=sqlite.prepare(sql);const bound=args=>({
  async run(){const result=statement.run(...args);return {meta:{changes:Number(result.changes),last_row_id:Number(result.lastInsertRowid)}}},
  async first(){return statement.get(...args)||null},async all(){return {results:statement.all(...args)}}
 });return {...bound([]),bind(...args){return bound(args)}}},async batch(statements){
  sqlite.exec('BEGIN');try{const results=[];for(const statement of statements)results.push(await statement.run());sqlite.exec('COMMIT');return results}catch(error){sqlite.exec('ROLLBACK');throw error}
 }};
 return {sqlite,db,close(){sqlite.close()}};
}
module.exports={createD1Fixture};
