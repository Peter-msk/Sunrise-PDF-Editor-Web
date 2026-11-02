// Sunrise R05 — versioned publication backup. V1 remains preview-only.
// No source files, inquiries, credentials, metrics, or full database export.
export const PUBLICATION_FORMAT_V2='sunrise-publications-backup-v2';
export const PUBLICATION_LIMITS=Object.freeze({maxRows:500,maxBytes:6*1024*1024,maxChanges:40});
const columns=Object.freeze({
 announcements:['id','title','body','level','published_at','first_published_at','is_active','revision','sort_order'],
 releases:['id','version','released_at','first_published_at','added','improved','removed','is_active','revision','sort_order']
});
const lengths={title:160,body:3000,level:16,version:160,added:1000,improved:1000,removed:1000,
 published_at:60,released_at:60,first_published_at:60};
const fail=m=>{throw new Error(m)};
function plain(o){return !!o&&typeof o==='object'&&!Array.isArray(o)&&
  (Object.getPrototypeOf(o)===Object.prototype||Object.getPrototypeOf(o)===null)}
function exact(o,keys,label){if(!plain(o)||Object.keys(o).length!==keys.length||
  Object.keys(o).some(k=>!keys.includes(k)))fail(label+': 데이터 형식 오류')}
function normalizeRow(row,table){const keys=columns[table];exact(row,keys,table);const o={};
 for(const k of keys){const v=row[k];
  if(k==='id'||k==='revision'||k==='sort_order'){
   const good=Number.isSafeInteger(v)&&(k==='id'?v>0:k==='revision'?v>=0:v>=-100000&&v<=100000);
   if(!good)fail(k+': 정수 범위 오류');o[k]=v;
  }else if(k==='is_active'){
   if(![0,1,true,false].includes(v))fail('게시 상태 형식 오류');o[k]=Number(v);
  }else if(k==='first_published_at'&&v===null){o[k]=null;
  }else{
   if(typeof v!=='string'||v.length>lengths[k]||/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(v))fail(k+': 내용 검증 실패');
   if((k==='title'||k==='version')&&!v.trim())fail('제목이 비어 있습니다.');
   if(k==='level'&&!['info','warning'].includes(v))fail('공지 유형 오류');
   o[k]=v;
  }
 }
 if(o.is_active===1&&o.first_published_at===null)fail('게시된 항목의 최초 게시일이 비어 있습니다.');
 return o;
}
export function normalizePublicationTablesV2(tables){exact(tables,['announcements','releases'],'tables');const out={};
 for(const name of Object.keys(columns)){
  const rows=tables[name];if(!Array.isArray(rows)||rows.length>PUBLICATION_LIMITS.maxRows)fail('항목 수 제한 초과');
  out[name]=rows.map(row=>normalizeRow(row,name)).sort((a,b)=>a.id-b.id);
  if(out[name].some((row,i)=>i>0&&row.id===out[name][i-1].id))fail('중복 ID');
 }
 const versions=new Set();for(const r of out.releases){if(versions.has(r.version))fail('백업 내 중복 버전');versions.add(r.version)}
 return out;
}
export function encodePublicationPayloadV2(tables,createdAt=new Date().toISOString()){
 if(typeof createdAt!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(createdAt)||
   !Number.isFinite(Date.parse(createdAt)))fail('작성 시각 오류');
 return {format:PUBLICATION_FORMAT_V2,createdAt,tables:normalizePublicationTablesV2(tables)};
}
function boundedBytes(value){const bytes=new TextEncoder().encode(JSON.stringify(value));
 if(bytes.byteLength>PUBLICATION_LIMITS.maxBytes)fail('백업 크기 제한 초과');return bytes}
export async function sha256Hex(value){const bytes=value instanceof Uint8Array?value:boundedBytes(value);
 if(!globalThis.crypto?.subtle)fail('암호학적 계산 기능이 없습니다.');
 const buf=await globalThis.crypto.subtle.digest('SHA-256',bytes);
 return Array.from(new Uint8Array(buf),x=>x.toString(16).padStart(2,'0')).join('');
}
export async function createPublicationBackupV2(tables){const payload=encodePublicationPayloadV2(tables);
 const checksum=await sha256Hex(payload);const envelope={payload,checksum:{algorithm:'SHA-256',hex:checksum}};
 boundedBytes(envelope);return {envelope,checksum};
}
export async function inspectPublicationBackupV2(input){
 if(typeof input==='string'){
  if(new TextEncoder().encode(input).byteLength>PUBLICATION_LIMITS.maxBytes)fail('백업 크기 초과');
  try{input=JSON.parse(input)}catch{fail('JSON 형식 오류')}
 }
 exact(input,['payload','checksum'],'봉투');exact(input.checksum,['algorithm','hex'],'검사값');
 if(input.checksum.algorithm!=='SHA-256'||typeof input.checksum.hex!=='string'||
  !/^[0-9a-f]{64}$/.test(input.checksum.hex))fail('검사값 형식 오류');
 exact(input.payload,['format','createdAt','tables'],'본문');
 if(input.payload.format!==PUBLICATION_FORMAT_V2)fail('기존 v1 백업은 쓰기 복원할 수 없습니다. v2로 다시 내보내 주세요.');
 const payload=encodePublicationPayloadV2(input.payload.tables,input.payload.createdAt);
 const digest=await sha256Hex(payload);if(digest!==input.checksum.hex)fail('내용 무결성 불일치');
 return {payload,checksum:digest,integrity:'checksum-only-not-authenticated'};
}
export async function readPublicationTablesV2(db){
 if(!db?.prepare)fail('DB 연결 없음');const queries={
 announcements:'SELECT id,title,body,level,published_at,first_published_at,is_active,revision,sort_order FROM site_announcements ORDER BY id LIMIT 501',
 releases:'SELECT id,version,released_at,first_published_at,added,improved,removed,is_active,revision,sort_order FROM site_releases ORDER BY id LIMIT 501'
 };
 const [a,r]=await Promise.all([db.prepare(queries.announcements).all(),db.prepare(queries.releases).all()]);
 return normalizePublicationTablesV2({announcements:a?.results,releases:r?.results});
}
const shallowEqual=(a,b,fields)=>fields.every(k=>a[k]===b[k]);
export function planPublicationRestoreV2(backupTables,currentTables){
 const incoming=normalizePublicationTablesV2(backupTables),current=normalizePublicationTablesV2(currentTables);
 const steps=[],conflicts=[],counts={insert:0,update:0,unchanged:0,retained:0};
 const presentVersions=new Map(current.releases.map(r=>[r.version,r.id]));
 for(const table of Object.keys(columns)){
  const existing=new Map(current[table].map(r=>[r.id,r]));
  const fields=columns[table].filter(k=>k!=='revision');
  const immutable=table==='announcements'?['published_at','first_published_at']:['released_at','first_published_at','version'];
  for(const next of incoming[table]){
   const prior=existing.get(next.id);
   const versionOwner=table==='releases'?presentVersions.get(next.version):undefined;
   if(versionOwner!==undefined&&versionOwner!==next.id){conflicts.push({table,id:next.id,reason:'version-collision'});continue}
   if(!prior){steps.push({table,kind:'insert',next});counts.insert++;continue}
   if(shallowEqual(prior,next,fields)){counts.unchanged++;continue}
   if(!shallowEqual(prior,next,immutable)){
    conflicts.push({table,id:next.id,reason:'immutable-metadata-mismatch'});continue;
   }
   if(prior.revision>=next.revision){
    conflicts.push({table,id:next.id,reason:'equal-or-newer-current-revision'});continue;
   }
   steps.push({table,kind:'update',prior,next});counts.update++;
  }
  counts.retained+=current[table].filter(row=>!incoming[table].some(x=>x.id===row.id)).length;
 }
 if(steps.length>PUBLICATION_LIMITS.maxChanges)conflicts.push({reason:'too-many-writes',count:steps.length});
 return {steps,conflicts,counts};
}
