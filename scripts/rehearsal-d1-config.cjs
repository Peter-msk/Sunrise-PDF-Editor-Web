'use strict';
// Shared fail-closed guard used by both the operator restore and release gate.
// A dedicated private Wrangler configuration must bind the isolated D1 only.
const fs=require('node:fs'),path=require('node:path');
const TEST_DATABASE='sunrise-pdf-restore-test';
const TEST_BINDING='REHEARSAL_DB';
function isolatedConfig(){
 const input=process.env.WRANGLER_REHEARSAL_CONFIG;
 if(!input)throw Error('Isolated D1 Wrangler configuration is required');
 const file=fs.realpathSync(input);
 if(!fs.statSync(file).isFile())throw Error('Isolated D1 configuration must be a file');
 let config;
 try{config=JSON.parse(fs.readFileSync(file,'utf8'))}
 catch{throw Error('Isolated D1 configuration must contain valid JSON')}
 const dbs=config?.d1_databases;
 if(!Array.isArray(dbs)||dbs.length!==1)throw Error('Isolated D1 configuration must bind exactly one database');
 const target=dbs[0];
 if(target?.database_name!==TEST_DATABASE||target?.binding!==TEST_BINDING)
  throw Error('Isolated D1 name or binding mismatch');
 const id=target?.database_id;
 if(typeof id!=='string'||!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(id))
  throw Error('Invalid isolated D1 database identifier');
 if(!process.env.REHEARSAL_D1_ID||id.toLowerCase()!==process.env.REHEARSAL_D1_ID.toLowerCase())
  throw Error('Isolated D1 does not match the approved database ID');
 const live=fs.readFileSync(path.resolve(__dirname,'../wrangler.toml'),'utf8');
 const prod=/^database_id\s*=\s*["']([a-f0-9-]+)["']/m.exec(live)?.[1];
 if(!prod)throw Error('Cannot identify the production D1 ID');
 if(id.toLowerCase()===prod.toLowerCase())throw Error('Production D1 must never be used as isolated restore target');
 return file;
}
module.exports={TEST_DATABASE,TEST_BINDING,isolatedConfig};
