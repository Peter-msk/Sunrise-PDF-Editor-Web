// Small authenticated/telemetry payloads only. Bound bytes while streaming so
// missing or false Content-Length cannot allocate an unbounded request body.
export async function readJsonObject(request,maxBytes){
 if(!Number.isSafeInteger(maxBytes)||maxBytes<1||maxBytes>16384)throw Error('Invalid JSON body limit');
 if(!request.headers.get('content-type')?.toLowerCase().startsWith('application/json'))return null;
 if(Number(request.headers.get('content-length')||0)>maxBytes)return null;
 const reader=request.body?.getReader();if(!reader)return null;
 const chunks=[];let size=0;
 try{
  while(true){
   const {done,value}=await reader.read();if(done)break;
   size+=value.byteLength;
   if(size>maxBytes){await reader.cancel();return null}
   chunks.push(value);
  }
  const bytes=new Uint8Array(size);let offset=0;
  for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength}
  const value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
  return value&&typeof value==='object'&&!Array.isArray(value)?value:null;
 }catch{return null}
 finally{reader.releaseLock()}
}
