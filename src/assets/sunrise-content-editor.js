/* Local PDF content editing. No raster replacement, OCR or redaction claims.
 * Clone page resources and publish a new page stream; shared source objects stay intact.
 * Unsupported encodings, clipping text, ambiguous mappings and inline images fail closed.
 */
(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.SunriseContentEditor=Object.freeze(api);
})(typeof globalThis!=='undefined'?globalThis:undefined,function(){
  'use strict';
  const MAX_INPUT=30*1024*1024,MAX_STREAM=4*1024*1024,MAX_TOKENS=150000;
  const latin=bytes=>{let s='';for(let i=0;i<bytes.length;i+=8192)s+=String.fromCharCode(...bytes.subarray(i,i+8192));return s;};
  const hex=bytes=>Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('').toUpperCase();
  const byteArray=s=>Uint8Array.from(s,c=>c.charCodeAt(0));
  const finite=(v,label)=>{if(!Number.isFinite(v))throw Error(label+' 값이 올바르지 않습니다.');return v;};
  const fmt=v=>{finite(v,'PDF 숫자');if(Math.abs(v)>1e7)throw Error('PDF 수치 범위를 초과했습니다.');return String(Number(v.toFixed(6)));};
  const white=c=>c===undefined||/[\x00\x09\x0a\x0c\x0d\x20]/.test(c);
  const delimiter=c=>white(c)||/[()[\]<>/%{}]/.test(c);
  function tokens(script){
    if(typeof script!=='string'||script.length>MAX_STREAM)throw Error('페이지 내용 스트림이 너무 큽니다.');
    const out=[];let p=0;
    function read(depth=0){
      if(depth>24)throw Error('PDF 내용의 중첩이 너무 깊습니다.');
      while(p<script.length){
        if(white(script[p])){p++;continue;}
        if(script[p]==='%'){while(p<script.length&&!/[\r\n]/.test(script[p]))p++;continue;}
        break;
      }
      const start=p;if(p>=script.length)return null;
      const c=script[p++];let value;
      if(c==='('){
        const b=[];let nested=1;
        while(p<script.length&&nested){
          let ch=script[p++];
          if(ch==='\\'){
            if(p>=script.length)throw Error('PDF 문자열 이스케이프가 잘렸습니다.');
            ch=script[p++];const escapes={n:10,r:13,t:9,b:8,f:12};
            if(ch==='\r'){if(script[p]==='\n')p++;continue;}
            if(ch==='\n')continue;
            if(/[0-7]/.test(ch)){let digits=ch;while(digits.length<3&&/[0-7]/.test(script[p]||'x'))digits+=script[p++];b.push(parseInt(digits,8)&255);continue;}
            b.push(escapes[ch]??ch.charCodeAt(0));continue;
          }
          if(ch==='(')nested++;
          if(ch===')'&&!--nested)break;
          if(ch==='\r'){if(script[p]==='\n')p++;ch='\n';}
          b.push(ch.charCodeAt(0));
        }
        if(nested)throw Error('PDF 문자열이 닫히지 않았습니다.');
        return {kind:'string',bytes:Uint8Array.from(b),start,end:p};
      }
      if(c==='<'&&script[p]!=='<'){
        const end=script.indexOf('>',p);if(end<0)throw Error('PDF 16진 문자열이 닫히지 않았습니다.');
        let h=script.slice(p,end).replace(/[\x00\x09\x0a\x0c\x0d\x20]/g,'');
        if(!/^[a-fA-F0-9]*$/.test(h))throw Error('잘못된 PDF 16진 문자열입니다.');
        if(h.length%2)h+='0';p=end+1;
        return {kind:'string',bytes:Uint8Array.from(h.match(/../g)||[],x=>parseInt(x,16)),start,end:p};
      }
      if(c==='['||c==='<'&&script[p]==='<'){
        const isDict=c==='<';if(isDict)p++;
        const values=[];
        while(true){
          const item=read(depth+1);if(!item)throw Error('PDF 배열 또는 사전이 잘렸습니다.');
          if(item.kind==='end'&&item.value===(isDict?'>>':']'))break;
          if(item.kind==='end')throw Error('PDF 닫힘 구분자가 일치하지 않습니다.');
          values.push(item);if(values.length>MAX_TOKENS)throw Error('PDF 배열이 너무 큽니다.');
        }
        return {kind:isDict?'dict':'array',values,start,end:p};
      }
      if(c===']'||c==='>'&&script[p]==='>'){
        if(c==='>')p++;return {kind:'end',value:c===']'?']':'>>',start,end:p};
      }
      if(c==='/'){
        while(p<script.length&&!delimiter(script[p]))p++;
        value=script.slice(start+1,p).replace(/#([0-9a-fA-F]{2})/g,(_,h)=>String.fromCharCode(parseInt(h,16)));
        return {kind:'name',value,start,end:p};
      }
      if(delimiter(c))throw Error('지원하지 않는 PDF 내용 구분자입니다.');
      while(p<script.length&&!delimiter(script[p]))p++;
      value=script.slice(start,p);
      if(/^[+-]?(?:\d+\.?\d*|\.\d+)$/.test(value))return {kind:'number',value:finite(Number(value),'PDF'),start,end:p};
      return {kind:'word',value,start,end:p};
    }
    let token;while((token=read())){out.push(token);if(out.length>MAX_TOKENS)throw Error('PDF 연산자 수가 너무 많습니다.');}
    return out;
  }
  function operations(script){
    const result=[];let args=[];
    for(const token of tokens(script)){
      if(token.kind==='word'&&!['true','false','null'].includes(token.value)){
        if(['BI','ID','EI'].includes(token.value))throw Error('인라인 이미지가 있는 페이지는 원본 내용 수정을 지원하지 않습니다.');
        result.push({op:token.value,args,start:args[0]?.start??token.start,end:token.end});args=[];
      }else args.push(token);
    }
    if(args.length)throw Error('완료되지 않은 PDF 내용 연산이 있습니다.');
    return result;
  }
  function unicode(h){
    if(!/^(?:[0-9a-fA-F]{4})+$/.test(h))throw Error('지원하지 않는 ToUnicode 목적 코드입니다.');
    let s='';for(let i=0;i<h.length;i+=4)s+=String.fromCharCode(parseInt(h.slice(i,i+4),16));
    // Round-trip catches unpaired UTF-16 surrogates without normalizing source spelling.
    if(new TextDecoder('utf-8',{fatal:true}).decode(new TextEncoder().encode(s))!==s)throw Error('잘못된 ToUnicode 문자열입니다.');
    return s;
  }
  function cmap(script,codeBytes,inherited){
    const lengths=Array.isArray(codeBytes)?codeBytes:[codeBytes];
    if(script.length>1024*1024||!lengths.length||lengths.some(n=>![1,2,3,4].includes(n)))throw Error('ToUnicode CMap 범위를 지원하지 않습니다.');
    const allowed=new Set(lengths),input=tokens(script),map=new Map(inherited||[]),local=new Set();
    const put=(key,text)=>{if(!allowed.has(key.length/2)||local.has(key)||(!map.has(key)&&map.size>=65536))throw Error('중복되거나 과대한 ToUnicode 매핑입니다.');local.add(key);map.set(key,text);};
    const source=token=>{if(token?.kind!=='string'||!allowed.has(token.bytes.length))throw Error('ToUnicode 원문 코드 길이가 올바르지 않습니다.');return hex(token.bytes);};
    const target=token=>{if(token?.kind!=='string')throw Error('ToUnicode 목적 코드가 올바르지 않습니다.');return unicode(hex(token.bytes));};
    for(let i=0;i<input.length;i++){
      const op=input[i];if(op.kind!=='word')continue;
      if(op.value==='usecmap')throw Error('외부 CMap은 지원하지 않습니다.');
      if(!['beginbfchar','beginbfrange'].includes(op.value))continue;
      const count=input[i-1]?.kind==='number'?input[i-1].value:NaN;
      if(!Number.isSafeInteger(count)||count<0||count>65536)throw Error('CMap 매핑 개수가 올바르지 않습니다.');
      for(let j=0;j<count;j++){
        if(op.value==='beginbfchar'){const from=source(input[++i]),to=target(input[++i]);put(from,to);}
        else{
          const firstKey=source(input[++i]),lastKey=source(input[++i]),first=parseInt(firstKey,16),last=parseInt(lastKey,16),to=input[++i];
          if(firstKey.length!==lastKey.length||last<first||last-first>65535)throw Error('ToUnicode 범위가 올바르지 않습니다.');
          const digits=firstKey.length;
          if(to?.kind==='array'){
            if(to.values.length!==last-first+1)throw Error('ToUnicode 배열 길이가 일치하지 않습니다.');
            for(let k=first;k<=last;k++)put(k.toString(16).padStart(digits,'0').toUpperCase(),target(to.values[k-first]));
          }else{
            if(to?.kind!=='string'||to.bytes.length!==2)throw Error('복합 Unicode 범위 증가식은 지원하지 않습니다.');
            const base=parseInt(hex(to.bytes),16);
            if(base+last-first>65535)throw Error('Unicode 코드 단위 범위를 초과했습니다.');
            for(let k=first;k<=last;k++)put(k.toString(16).padStart(digits,'0').toUpperCase(),unicode((base+k-first).toString(16).padStart(4,'0')));
          }
        }
      }
      if(input[++i]?.value!==(op.value==='beginbfchar'?'endbfchar':'endbfrange'))throw Error('CMap 매핑 개수와 종료 위치가 일치하지 않습니다.');
    }
    if(!map.size)throw Error('사용할 수 있는 ToUnicode 매핑이 없습니다.');return map;
  }

  function encodingCMap(script,inherited){
    const input=tokens(script),spaces=inherited?inherited.codeSpaces.map(x=>({...x})):[],entries=[];
    let vertical=Boolean(inherited?.vertical),hasWMode=false;
    const source=t=>{if(t?.kind!=='string'||t.bytes.length<1||t.bytes.length>4)throw Error('CMap 원문 코드 길이가 올바르지 않습니다.');return {code:parseInt(hex(t.bytes),16),length:t.bytes.length};};
    const cid=t=>{if(t?.kind!=='number'||!Number.isSafeInteger(t.value)||t.value<0||t.value>65535)throw Error('CMap CID 범위가 올바르지 않습니다.');return t.value;};
    for(let i=0;i<input.length;i++){
      const t=input[i];
      if(t.kind==='name'&&t.value==='WMode'){const mode=input[i+1]?.value;if(![0,1].includes(mode))throw Error('CMap 쓰기 방향을 읽을 수 없습니다.');if(hasWMode)throw Error('중복된 CMap 쓰기 방향입니다.');hasWMode=true;vertical=mode===1;}
      if(t.value==='usecmap')throw Error('상속 외부 CMap은 아직 원본 수정하지 않습니다.');
      if(!['begincidchar','begincidrange','begincodespacerange'].includes(t.value))continue;
      const count=input[i-1]?.value;if(!Number.isSafeInteger(count)||count<0||count>65536)throw Error('CMap 항목 수가 올바르지 않습니다.');
      for(let j=0;j<count;j++){
        const first=source(input[++i]);
        if(t.value==='begincidchar')entries.push({first,last:first,value:cid(input[++i])});
        else{
          const last=source(input[++i]);
          if(first.length!==last.length||last.code<first.code||last.code-first.code>65535)throw Error('CMap 코드 범위가 너무 큽니다.');
          if(t.value==='begincodespacerange'){
            const entry={length:first.length,start:first.code,end:last.code};
            if(!spaces.some(s=>s.length===entry.length&&s.start===entry.start&&s.end===entry.end))spaces.push(entry);
          }
          else{
            const value=cid(input[++i]);if(value+last.code-first.code>65535)throw Error('CID 범위를 초과했습니다.');
            entries.push({first,last,value});
          }
        }
      }
      const end={begincidchar:'endcidchar',begincidrange:'endcidrange',begincodespacerange:'endcodespacerange'}[t.value];
      if(input[++i]?.value!==end)throw Error('CMap 항목 수와 종료 위치가 일치하지 않습니다.');
    }
    if(!spaces.length||(!entries.length&&!inherited?.mapping?.size)||spaces.length>1000)throw Error('CMap 코드 공간 및 CID 매핑이 필요합니다.');
    for(let i=0;i<spaces.length;i++)for(let j=0;j<i;j++){
      const a=spaces[i],b=spaces[j];
      if(a.length===b.length){if(a.start<=b.end&&b.start<=a.end)throw Error('중복된 CMap 코드 공간입니다.');}
      else{
        const short=a.length<b.length?a:b,long=a.length<b.length?b:a;
        const shift=8*(long.length-short.length),from=Math.floor(long.start/2**shift),to=Math.floor(long.end/2**shift);
        if(short.start<=to&&from<=short.end)throw Error('가변 CMap 코드 공간의 접두부가 모호합니다.');
      }
    }
    const lengths=[...new Set(spaces.map(s=>s.length))].sort((a,b)=>a-b),variableLength=lengths.length>1;
    const rawMap=new Map(),localCodes=new Set();
    if(inherited)for(const [key,value] of inherited.mapping){
      const code=typeof key==='number'?key.toString(16).padStart(inherited.codeBytes*2,'0').toUpperCase():key;
      rawMap.set(code,value);
    }
    for(const {first,last,value} of entries){
      if(!spaces.some(s=>s.length===first.length&&first.code>=s.start&&last.code<=s.end))throw Error('CID 원문 코드가 선언된 CMap 코드 공간 밖에 있습니다.');
      for(let code=first.code;code<=last.code;code++){
        const key=code.toString(16).padStart(first.length*2,'0').toUpperCase();
        if(localCodes.has(key)||rawMap.size>=65536)throw Error('CMap 코드가 중복되거나 너무 많습니다.');
        localCodes.add(key);rawMap.set(key,value+code-first.code);
      }
    }
    const mapping=new Map();
    for(const [key,value] of rawMap){
      if(!spaces.some(space=>space.length*2===key.length&&parseInt(key,16)>=space.start&&parseInt(key,16)<=space.end))
        throw Error('상속 CMap 코드가 선언된 범위 밖에 있습니다.');
      mapping.set(variableLength?key:parseInt(key,16),value);
    }
    return {codeBytes:variableLength?null:lengths[0],codeLengths:lengths,codeSpaces:spaces,variableLength,vertical,mapping};
  }

  function decodedStream(stream,lib){
    if(!(stream instanceof lib.PDFRawStream)||stream.dict.has(lib.PDFName.of('F')))throw Error('외부 또는 미지원 내용 스트림입니다.');
    const bytes=lib.decodePDFRawStream(stream).decode();
    if(bytes.length>MAX_STREAM)throw Error('내용 스트림의 압축 해제 크기가 너무 큽니다.');
    return bytes;
  }
  async function load(bytes,pageNumber,lib){
    if(!(bytes instanceof Uint8Array)||bytes.length<100||bytes.length>MAX_INPUT||!Number.isSafeInteger(pageNumber)||pageNumber<1)
      throw Error('PDF 크기 또는 페이지 번호가 올바르지 않습니다.');
    const pdf=await lib.PDFDocument.load(bytes,{updateMetadata:false}),n=lib.PDFName.of,ctx=pdf.context;
    if(pageNumber>pdf.getPageCount()||pdf.isEncrypted)throw Error('암호화 여부와 페이지 번호를 확인하세요.');
    if(['Perms','AcroForm','OCProperties','StructTreeRoot','SunriseWebEdits'].some(key=>pdf.catalog.has(n(key))))
      throw Error('서명·양식·선택 레이어·태그 또는 미복원 편집 정보가 있는 문서는 원본 내용 수정을 지원하지 않습니다.');
    for(const [,object] of ctx.enumerateIndirectObjects()){
      if(object?.get?.(n('ByteRange'))||object?.get?.(n('Type'))?.toString()==='/Sig')throw Error('기존 전자서명 문서는 직접 수정하지 않습니다.');
    }
    const page=pdf.getPage(pageNumber-1),contents=ctx.lookup(page.node.get(n('Contents')));
    const streams=contents instanceof lib.PDFArray?Array.from({length:contents.size()},(_,i)=>ctx.lookup(contents.get(i))):[contents];
    if(!streams.length||streams.length>80||streams.some(s=>!s))throw Error('페이지 내용 스트림이 없습니다.');
    const scripts=streams.map(s=>latin(decodedStream(s,lib))),script=scripts.join('\n');
    if(script.length>MAX_STREAM)throw Error('페이지 전체 내용이 너무 큽니다.');
    const ops=operations(script);
    const hasAlternateText=token=>token.kind==='name'&&token.value==='ActualText'||token.values?.some(hasAlternateText);
    if(ops.some(op=>op.args.some(hasAlternateText)))throw Error('대체 텍스트가 있는 내용은 직접 수정하지 않습니다.');
    return {pdf,page,script,ops,n,ctx,lib,resources:page.node.Resources(),ancestors:[],prefix:''};
  }

  function childScope(state,index){
    const call=state.ops[index],{ctx,n,lib}=state;
    if(call?.op!=='Do'||call.args.length!==1||call.args[0].kind!=='name')throw Error('중첩 객체 호출 위치가 변경되었습니다.');
    const objects=ctx.lookup(state.resources?.get(n('XObject'))),raw=objects?.get(n(call.args[0].value)),stream=ctx.lookup(raw);
    if(!(stream instanceof lib.PDFRawStream)||stream.dict.get(n('Subtype'))?.toString()!=='/Form')return null;
    if(stream.dict.has(n('Ref'))||stream.dict.has(n('OPI'))||stream.dict.has(n('OC')))throw Error('외부 또는 선택 레이어 Form은 수정하지 않습니다.');
    if(state.ancestors.length>=16||state.ancestors.some(a=>a.stream===stream))throw Error('Form 객체의 순환 또는 깊이 제한을 초과했습니다.');
    const resources=ctx.lookup(stream.dict.get(n('Resources')))||state.resources;
    if(!(resources instanceof lib.PDFDict))throw Error('Form 리소스가 올바르지 않습니다.');
    const script=latin(decodedStream(stream,lib)),ops=operations(script);
    const alternate=token=>token.kind==='name'&&token.value==='ActualText'||token.values?.some(alternate);
    if(ops.some(o=>o.args.some(alternate)))throw Error('대체 텍스트가 있는 Form은 직접 수정하지 않습니다.');
    return {...state,script,ops,resources,ancestors:[...state.ancestors,{parent:state,index,stream}],prefix:state.prefix+'form:'+index+'/'};
  }
  async function targetScope(options){
    let state=await load(options.bytes,options.pageNumber,options.PDFLib);
    const parts=String(options.targetId||'').split('/');
    while(parts.length>1){
      const part=parts.shift();if(!/^form:\d+$/.test(part))throw Error('중첩 객체 경로가 올바르지 않습니다.');
      state=childScope(state,Number(part.slice(5)));if(!state)throw Error('편집할 Form 객체를 찾을 수 없습니다.');
    }
    return {state,id:parts[0]};
  }
  async function allScopes(options,collect){
    const root=await load(options.bytes,options.pageNumber,options.PDFLib),results=[];let count=0,total=0;
    const walk=async state=>{
      if(++count>500||(total+=state.script.length)>16*1024*1024)throw Error('중첩 객체 분석 범위를 초과했습니다.');
      results.push(...(await collect(state)).map(item=>({...item,id:state.prefix+item.id})));
      for(let i=0;i<state.ops.length;i++)if(state.ops[i].op==='Do'){
        const child=childScope(state,i);if(child)await walk(child);
      }
    };
    await walk(root);return results;
  }

  // Stream /UseCMap is a same-document inherited stream; unlike a named
  // predefined CMap its bytes can be validated without fetching external data.
  // Keep inherited mappings immutable; local overrides have precedence.
  function parseInheritedCMap(raw,state,kind,codeLengths){
    const {ctx,lib,n}=state,seen=new Set();
    const parse=(value,depth)=>{
      const stream=ctx.lookup(value);
      if(!(stream instanceof lib.PDFRawStream)||depth>12||seen.has(stream))
        throw Error('상속 CMap의 참조 또는 순환 구조가 올바르지 않습니다.');
      seen.add(stream);
      const parent=stream.dict.get(n('UseCMap'));
      const inherited=parent?parse(parent,depth+1):null;
      const content=latin(decodedStream(stream,lib));
      return kind==='encoding'?encodingCMap(content,inherited):cmap(content,codeLengths,inherited);
    };
    return parse(raw,0);
  }
  async function fontModel(state,fontName){
    const {ctx,n,lib,pdf}=state,resources=state.resources;
    const fonts=ctx.lookup(resources?.get(n('Font'))),font=ctx.lookup(fonts?.get(n(fontName)));
    if(!font?.get)throw Error('글꼴 리소스를 확인할 수 없습니다.');
    const type=font.get(n('Subtype'))?.toString(),encoding=font.get(n('Encoding'))?.toString();
    let map,cidMap=null,codeBytes=1,codeLengths=[1],codeSpaces=null,width,standard,vertical=false;
    if(type==='/Type0'){
      const encodingObject=ctx.lookup(font.get(n('Encoding')));
      if(['/Identity-H','/Identity-V'].includes(encoding)){codeBytes=2;codeLengths=[2];vertical=encoding==='/Identity-V';}
      else if(encodingObject instanceof lib.PDFRawStream){const parsed=parseInheritedCMap(font.get(n('Encoding')),state,'encoding');codeBytes=parsed.codeBytes;codeLengths=parsed.codeLengths;codeSpaces=parsed.codeSpaces;vertical=parsed.vertical;cidMap=parsed.mapping;}
      else throw Error('외부 이름 CMap은 직접 수정하지 않습니다. 내장 CMap이 필요합니다.');
      const descendants=ctx.lookup(font.get(n('DescendantFonts')));
      const cid=ctx.lookup(descendants?.get?.(0));if(!cid?.get)throw Error('CID 글꼴을 읽을 수 없습니다.');
      const widths=new Map(),w=ctx.lookup(cid.get(n('W'))),fallback=ctx.lookup(cid.get(n('DW')))?.asNumber?.()??1000;
      if(w){
        if(!(w instanceof lib.PDFArray)||w.size()>65536)throw Error('CID 글꼴 너비 배열이 너무 큽니다.');
        for(let i=0;i<w.size();){
          const first=ctx.lookup(w.get(i++))?.asNumber?.(),v=ctx.lookup(w.get(i++));
          if(!Number.isSafeInteger(first)||first<0||first>65535)throw Error('잘못된 CID 너비 시작값입니다.');
          if(v instanceof lib.PDFArray){for(let j=0;j<v.size();j++)widths.set(first+j,finite(ctx.lookup(v.get(j))?.asNumber?.(),'글리프 너비'));}
          else{
            const last=v?.asNumber?.(),value=ctx.lookup(w.get(i++))?.asNumber?.();
            if(!Number.isSafeInteger(last)||last<first||last>65535)throw Error('잘못된 CID 너비 범위입니다.');
            for(let j=first;j<=last;j++)widths.set(j,finite(value,'글리프 너비'));
          }
        }
      }
      if(vertical){
        const w2=ctx.lookup(cid.get(n('W2'))),dw2=ctx.lookup(cid.get(n('DW2'))),verticalWidths=new Map();
        const defaultAdvance=dw2 instanceof lib.PDFArray?ctx.lookup(dw2.get(1))?.asNumber?.():-1000;
        if(w2){
          if(!(w2 instanceof lib.PDFArray)||w2.size()>65536)throw Error('세로 글꼴 너비 배열이 올바르지 않습니다.');
          for(let i=0;i<w2.size();){
            const first=ctx.lookup(w2.get(i++))?.asNumber?.(),value=ctx.lookup(w2.get(i++));
            if(!Number.isSafeInteger(first)||first<0||first>65535)throw Error('세로 글꼴 CID 시작값이 올바르지 않습니다.');
            if(value instanceof lib.PDFArray){
              if(value.size()%3||first+value.size()/3>65536)throw Error('세로 글리프 너비 배열 길이가 올바르지 않습니다.');
              for(let j=0;j<value.size();j+=3){const triple=[0,1,2].map(k=>finite(ctx.lookup(value.get(j+k))?.asNumber?.(),'세로 글리프 위치'));verticalWidths.set(first+j/3,triple[0]);}
            }else{
              const last=value?.asNumber?.(),triple=[0,1,2].map(()=>finite(ctx.lookup(w2.get(i++))?.asNumber?.(),'세로 글리프 위치'));
              if(!Number.isSafeInteger(last)||last<first||last>65535)throw Error('세로 글꼴 CID 범위가 올바르지 않습니다.');
              for(let k=first;k<=last;k++)verticalWidths.set(k,triple[0]);
            }
          }
        }
        width=(code,key)=>{const mapped=cidMap?cidMap.get(codeBytes===null?key:code):code;if(mapped===undefined)throw Error('CMap의 CID를 찾을 수 없습니다.');return -finite(verticalWidths.get(mapped)??defaultAdvance,'세로 글리프 진행');};
      }else width=(code,key)=>{const mapped=cidMap?cidMap.get(codeBytes===null?key:code):code;if(mapped===undefined)throw Error('CMap의 CID를 찾을 수 없습니다.');return widths.get(mapped)??finite(fallback,'기본 글리프 너비');};
    }else if(type==='/Type1'||type==='/TrueType'){
      if(encoding&&encoding!=='/WinAnsiEncoding'&&!font.has(n('ToUnicode')))throw Error('사용자 정의 인코딩에는 ToUnicode 매핑이 필요합니다.');
      const w=ctx.lookup(font.get(n('Widths'))),first=ctx.lookup(font.get(n('FirstChar')))?.asNumber?.()??0;
      if(w){width=code=>finite(ctx.lookup(w.get(code-first))?.asNumber?.(),'단일 바이트 글리프 너비');}
      else{
        const base=font.get(n('BaseFont'))?.toString()?.slice(1);
        if(!Object.values(lib.StandardFonts).includes(base)||['Symbol','ZapfDingbats'].includes(base))throw Error('글꼴 너비 정보를 찾지 못했습니다.');
        standard=await pdf.embedFont(base);width=code=>standard.widthOfTextAtSize(new TextDecoder('windows-1252').decode(Uint8Array.of(code)),1000);
      }
    }else throw Error('Type1·TrueType 또는 Identity-H 글꼴만 지원합니다.');
    const toUnicode=ctx.lookup(font.get(n('ToUnicode')));
    if(toUnicode)map=parseInheritedCMap(font.get(n('ToUnicode')),state,'unicode',codeLengths);
    else{
      if(codeBytes!==1)throw Error('CID 글꼴의 ToUnicode 매핑이 필요합니다.');
      map=new Map();for(let i=32;i<256;i++)map.set(i.toString(16).padStart(2,'0').toUpperCase(),new TextDecoder('windows-1252').decode(Uint8Array.of(i)));
    }
    const decode=bytes=>{
      if(codeBytes!==null&&bytes.length%codeBytes)throw Error('글리프 코드 길이가 맞지 않습니다.');
      let text='',advance=0,count=0,spaces=0;
      for(let i=0;i<bytes.length;){
        let length=codeBytes;
        if(length===null){
          const matches=codeSpaces.filter(space=>{
            if(i+space.length>bytes.length)return false;
            let code=0;for(let j=0;j<space.length;j++)code=code*256+bytes[i+j];
            return code>=space.start&&code<=space.end;
          });
          if(matches.length!==1)throw Error('CMap 원문 코드 경계가 모호하거나 누락되었습니다.');
          length=matches[0].length;
        }
        const key=hex(bytes.subarray(i,i+length)),value=map.get(key);
        if(value===undefined)throw Error('원문 글리프의 Unicode 매핑이 없습니다.');
        const code=parseInt(key,16);text+=value;advance+=width(code,key);count++;
        if(length===1&&code===32)spaces++;
        i+=length;
      }
      return {text,advance,count,spaces};
    };
    // A ToUnicode entry is not necessarily a valid source code in the font Encoding.
    // Never generate an unmapped CID or a byte sequence outside the declared code space.
    const reverse=new Map();
    for(const [k,v] of map){
      if(codeSpaces&&!codeSpaces.some(space=>k.length===space.length*2&&parseInt(k,16)>=space.start&&parseInt(k,16)<=space.end))continue;
      if(type==='/Type0'&&codeSpaces){
        const raw=codeBytes===null?k:parseInt(k,16);
        if(cidMap?.get(raw)===undefined)continue;
      }
      if(reverse.has(v))reverse.set(v,null);else reverse.set(v,k);
    }
    const encode=text=>{
      const symbols=[...text],parts=[];
      for(const symbol of symbols){const code=reverse.get(symbol);if(!code)return null;parts.push(...code.match(/../g).map(x=>parseInt(x,16)));}
      return Uint8Array.from(parts);
    };
    return {decode,encode,vertical};
  }
  async function textRecords(state){
    let text=false,current={font:null,size:0,tc:0,tw:0,tz:100,tr:0};const stack=[],models=new Map(),records=[];
    for(let i=0;i<state.ops.length;i++){
      const op=state.ops[i],a=op.args,num=j=>a[j]?.kind==='number'?a[j].value:NaN;
      if(op.op==='q'){stack.push({...current});if(stack.length>64)throw Error('그래픽 상태 중첩이 너무 깊습니다.');}
      if(op.op==='Q'){if(!stack.length)throw Error('그래픽 상태가 일치하지 않습니다.');current=stack.pop();}
      if(op.op==='BT'){if(text)throw Error('중첩 텍스트 블록은 지원하지 않습니다.');text=true;}
      if(op.op==='ET')text=false;
      if(op.op==='gs')current.font=null;
      if(op.op==='\"'){current.tw=num(0);current.tc=num(1);}
      if(op.op==='Tf'){current.font=a[0]?.kind==='name'?a[0].value:null;current.size=num(1);}
      if(['Tc','Tw','Tz','Tr'].includes(op.op))current[{Tc:'tc',Tw:'tw',Tz:'tz',Tr:'tr'}[op.op]]=num(0);
      if(!text||!['Tj','TJ',"'",'"'].includes(op.op)||!current.font||current.size<=0||current.tz<=0||current.tr!==0)continue;
      const strings=op.op==='TJ'&&a[0]?.kind==='array'?a[0].values:op.op==='"'?a.slice(2):a;
      if(!strings?.length||strings.some(t=>!['number','string'].includes(t.kind)))continue;
      try{
        if(!models.has(current.font))models.set(current.font,await fontModel(state,current.font));
        const model=models.get(current.font);let original='',advance=0;
        for(const token of strings){
          if(token.kind==='number')advance+=(model.vertical?1:-1)*token.value*current.size/1000;
          else{const d=model.decode(token.bytes);original+=d.text;advance+=d.advance*current.size/1000+(model.vertical?-1:1)*(d.count*current.tc+d.spaces*current.tw);}
        }
        if(!original.trim()||original.length>500||advance<=0||!Number.isFinite(advance))continue;
        records.push({id:'text:'+i,original,advance,state:{...current},operation:op,model});
      }catch(error){
        // Unreadable fonts are omitted as candidates, never silently edited.
        if(!error?.message)throw error;
      }
    }
    return records;
  }
  async function listText(options){
    return allScopes(options,async state=>(await textRecords(state)).map(({id,original,state:s})=>({id,original,font:s.font,fontSize:s.size})));
  }
  async function publish(state,op,replacement){
    const {pdf,page,n,ctx,lib,script}=state;
    let next=script.slice(0,op.start)+replacement+script.slice(op.end),resources=state.resources;
    for(let i=state.ancestors.length-1;i>=0;i--){
      const {parent,index,stream}=state.ancestors[i],dict=stream.dict.clone();
      for(const key of ['Length','Filter','DecodeParms'])dict.delete(n(key));
      dict.set(n('Resources'),resources);
      const child=ctx.register(ctx.flateStream(byteArray(next),Object.fromEntries(dict.entries().map(([key,value])=>[key.decodeText(),value]))));
      const parentResources=parent.resources.clone(),old=ctx.lookup(parentResources.get(n('XObject'))),objects=old.clone();
      let suffix=0,key;do{key=n('SunriseForm'+suffix++);}while(objects.has(key));
      objects.set(key,child);parentResources.set(n('XObject'),objects);
      const call=parent.ops[index];next=parent.script.slice(0,call.start)+key.toString()+' Do'+parent.script.slice(call.end);resources=parentResources;
    }
    page.node.set(n('Resources'),resources);
    page.node.set(n('Contents'),ctx.register(ctx.flateStream(byteArray(next))));
    const bytes=await pdf.save({useObjectStreams:false,updateFieldAppearances:false});
    if(bytes.length>60*1024*1024)throw Error('수정 결과가 60MiB를 초과했습니다.');
    const check=await lib.PDFDocument.load(bytes,{updateMetadata:false});
    if(check.getPageCount()!==pdf.getPageCount())throw Error('수정 결과의 페이지 수가 변경되었습니다.');
    for(let i=0;i<pdf.getPageCount();i++){
      const a=pdf.getPage(i),b=check.getPage(i);
      if(JSON.stringify(a.getMediaBox())!==JSON.stringify(b.getMediaBox())||JSON.stringify(a.getCropBox())!==JSON.stringify(b.getCropBox())||a.getRotation().angle!==b.getRotation().angle)
        throw Error('수정 결과의 페이지 크기 또는 회전이 변경되었습니다.');
    }
    return {bytes};
  }
  async function replaceText(options){
    const {replacement,original,targetId,fontProvider}=options;
    if(typeof replacement!=='string'||!replacement||replacement.length>500||replacement===original||/[\x00-\x1f\x7f]/.test(replacement))throw Error('새 문구는 다른 내용의 1~500자 한 줄로 입력하세요.');
    const resolved=await targetScope(options),state=resolved.state,records=await textRecords(state);
    const hits=records.filter(r=>targetId?r.id===resolved.id&&r.original===original:r.original===original);
    if(hits.length!==1)throw Error('수정할 원문 위치를 하나로 확정하지 못했습니다. 후보를 다시 선택하세요.');
    const hit=hits[0],s=hit.state;let encoded=hit.model.encode(replacement),fontName=s.font,width;
    if(encoded){const d=hit.model.decode(encoded);width=d.advance*s.size/1000;}
    else{
      if(hit.model.vertical)throw Error('세로 글꼴에 없는 문자는 같은 글꼴로 추가할 수 없습니다.');
      if(typeof fontProvider!=='function')throw Error('새 문자의 글리프가 없어 한글 대체 글꼴이 필요합니다.');
      const font=await fontProvider(state.pdf,[replacement]);
      encoded=font.encodeText(replacement).asBytes();width=font.widthOfTextAtSize(replacement,s.size);
      const resources=state.resources.clone(),oldFonts=state.ctx.lookup(resources.get(state.n('Font')));
      const fonts=oldFonts.clone();let suffix=0;do{fontName='SunriseReplacement'+suffix++;}while(fonts.has(state.n(fontName)));
      fonts.set(state.n(fontName),font.ref);resources.set(state.n('Font'),fonts);state.resources=resources;
    }
    if(width<=0||!Number.isFinite(width))throw Error('새 문구 너비를 계산할 수 없습니다.');
    const ratio=hit.advance/width;
    if(ratio<0.4||ratio>2.5)throw Error('새 문구 길이가 원래 영역과 크게 다릅니다. 문구를 줄이거나 텍스트 삽입을 이용하세요.');
    // Zero spacing while writing; fit to the old advance and restore text state.
    const content=(["'",'"'].includes(hit.operation.op)?'T* ':'')+'0 Tc 0 Tw '+state.n(fontName).toString()+' '+fmt(s.size*(hit.model.vertical?ratio:1))+' Tf '+fmt(s.tz*(hit.model.vertical?1:ratio))+' Tz <'+hex(encoded)+'> Tj '+
      fmt(s.tc)+' Tc '+fmt(s.tw)+' Tw '+state.n(s.font).toString()+' '+fmt(s.size)+' Tf '+fmt(s.tz)+' Tz';
    const result=await publish(state,hit.operation,content);
    return {...result,pageNumber:options.pageNumber,original,replacement,usedFallbackFont:fontName!==s.font};
  }
  async function listRectangles(options){
    return allScopes(options,state=>state.ops.flatMap((o,i)=>o.op==='re'&&o.args.length===4&&o.args.every(t=>t.kind==='number')?
      [{id:'rect:'+i,x:o.args[0].value,y:o.args[1].value,width:o.args[2].value,height:o.args[3].value}]:[]).slice(0,500));
  }
  async function replaceRectangle(options){
    const {state,id}=await targetScope(options),index=Number(id.replace(/^rect:/,'')),op=state.ops[index];
    if(!/^rect:\d+$/.test(id)||op?.op!=='re'||op.args.length!==4)throw Error('사각형 대상이 변경되었습니다.');
    const values=['x','y','width','height'].map(k=>finite(Number(options[k]),k));
    if(values.some(v=>Math.abs(v)>14400)||values[2]===0||values[3]===0)throw Error('사각형 좌표·크기 범위를 확인하세요.');
    return publish(state,op,values.map(fmt).join(' ')+' re');
  }
  const PATH_ARITY={m:2,l:2,c:6,v:4,y:4,h:0,re:4};
  const PATH_PAINT=new Set(['S','s','f','f*','B','B*','b','b*']);
  function vectorPaths(state){
    const result=[];let pending=[],active=false,invalid=false,clip=null;
    for(let i=0;i<state.ops.length;i++){
      const o=state.ops[i];
      if(Object.hasOwn(PATH_ARITY,o.op)){
        if(!active){if(!['m','re'].includes(o.op))continue;active=true;}
        if(invalid)continue;
        if(o.args.length!==PATH_ARITY[o.op]||o.args.some(t=>t.kind!=='number')){invalid=true;continue;}
        pending.push({operator:o.op,values:o.args.map(t=>t.value),index:i});
        if(pending.length>400)invalid=true;
      }else if((o.op==='W'||o.op==='W*')&&active&&!clip&&!o.args.length){clip=o.op;
      }else if(PATH_PAINT.has(o.op)||o.op==='n'){
        if((o.op!=='n'||clip)&&!o.args.length&&!invalid&&pending.length)result.push({clip,id:'path:'+pending[0].index,steps:pending.map(({operator,values})=>({operator,values})),paint:o.op,start:state.ops[pending[0].index].start,end:o.end});
        pending=[];active=false;invalid=false;clip=null;
      }else if(active)invalid=true;
      if(result.length>=500)break;
    }
    return result;
  }
  async function listVectorPaths(options){
    return allScopes(options,state=>vectorPaths(state).map(({id,steps,paint,clip})=>({id,steps,paint,clip})));
  }
  async function replaceVectorPath(options){
    const {state,id}=await targetScope(options),target=vectorPaths(state).find(p=>p.id===id);
    if(!target||!Array.isArray(options.steps)||options.steps.length!==target.steps.length)throw Error('원본 도형 경로가 변경되었습니다.');
    const commands=options.steps.map((step,i)=>{
      if(step.operator!==target.steps[i].operator||!Array.isArray(step.values)||step.values.length!==PATH_ARITY[step.operator]||
         step.values.some(v=>typeof v!=='number'||!Number.isFinite(v)||Math.abs(v)>14400))throw Error('원본 경로의 좌표·종류를 확인하세요.');
      return step.values.map(fmt).join(' ')+' '+step.operator;
    });
    const color=value=>{
      if(!/^#[0-9a-fA-F]{6}$/.test(value))throw Error('도형 색상 값이 올바르지 않습니다.');
      return [1,3,5].map(i=>fmt(parseInt(value.slice(i,i+2),16)/255)).join(' ');
    };
    const settings=[];
    if(options.strokeColor!==undefined)settings.push(color(options.strokeColor)+' RG');
    if(options.fillColor!==undefined)settings.push(color(options.fillColor)+' rg');
    if(options.lineWidth!==undefined){
      if(typeof options.lineWidth!=='number'||!Number.isFinite(options.lineWidth)||options.lineWidth<=0||options.lineWidth>100)throw Error('선 두께는 0 초과 100pt 이하로 입력하세요.');
      settings.push(fmt(options.lineWidth)+' w');
    }
    if(target.clip){
      if(settings.length)throw Error('클리핑 경로는 좌표만 변경할 수 있습니다.');
      return publish(state,target,commands.join('\n')+'\n'+target.clip+'\n'+target.paint);
    }
    // The current path is not part of saved graphics state. Paint consumes it;
    // q/Q isolates style changes so later source shapes keep their own state.
    return publish(state,target,'q\n'+settings.join('\n')+'\n'+commands.join('\n')+'\n'+target.paint+'\nQ');
  }
  function rulesFromOperations(ops){
    let ctm=[1,0,0,1,0,0],path=[],point=null,origin=null,clipping=false;
    const stack=[],horizontal=[],vertical=[];
    const pointAt=(x,y)=>[ctm[0]*x+ctm[2]*y+ctm[4],ctm[1]*x+ctm[3]*y+ctm[5]];
    const line=(a,b)=>{
      if(!a||!b)return;
      if(Math.abs(a[1]-b[1])<0.2&&Math.abs(a[0]-b[0])>4)path.push({axis:'h',at:(a[1]+b[1])/2,from:Math.min(a[0],b[0]),to:Math.max(a[0],b[0])});
      if(Math.abs(a[0]-b[0])<0.2&&Math.abs(a[1]-b[1])>4)path.push({axis:'v',at:(a[0]+b[0])/2,from:Math.min(a[1],b[1]),to:Math.max(a[1],b[1])});
    };
    for(const {op,args} of ops){
      const a=args.map(t=>t.kind==='number'?t.value:NaN);
      if(op==='q')stack.push({ctm:ctm.slice(),clipping});
      if(op==='Q'){const old=stack.pop();if(!old)throw Error('그래픽 상태가 일치하지 않습니다.');ctm=old.ctm;clipping=old.clipping;}
      if(op==='cm'&&a.length===6&&a.every(Number.isFinite)){
        const [a0,b,c,d,e,f]=ctm,[g,h,i,j,k,l]=a;
        ctm=[a0*g+c*h,b*g+d*h,a0*i+c*j,b*i+d*j,a0*k+c*l+e,b*k+d*l+f];
      }
      if(op==='m'&&a.length===2){point=pointAt(...a);origin=point;}
      if(op==='l'&&a.length===2){const next=pointAt(...a);line(point,next);point=next;}
      if(op==='h'){line(point,origin);point=origin;}
      if(op==='re'&&a.length===4){const [x,y,w,h]=a,p=[pointAt(x,y),pointAt(x+w,y),pointAt(x+w,y+h),pointAt(x,y+h)];for(let i=0;i<4;i++)line(p[i],p[(i+1)%4]);point=p[0];origin=point;}
      if(['c','v','y'].includes(op)){point=null;origin=null;}
      if(['W','W*'].includes(op))clipping=true;
      if(['S','s','B','B*','b','b*','f','F','f*','n'].includes(op)){
        if(['s','b','b*'].includes(op))line(point,origin);
        if(!clipping&&['S','s','B','B*','b','b*'].includes(op))for(const entry of path)(entry.axis==='h'?horizontal:vertical).push(entry);
        path=[];point=origin=null;
      }
      if(horizontal.length+vertical.length>6000)throw Error('표 선의 수가 너무 많습니다.');
    }
    return {horizontal,vertical};
  }
  async function tableRules({bytes,PDFLib,pageNumbers,cancelled}){
    if(!Array.isArray(pageNumbers)||!pageNumbers.length||pageNumbers.length>50)throw Error('표 분석은 최대 50쪽입니다.');
    const pdf=await PDFLib.PDFDocument.load(bytes,{updateMetadata:false}),ctx=pdf.context,n=PDFLib.PDFName.of,result=[];
    for(const number of pageNumbers){
      if(cancelled?.())throw new DOMException('표 분석 취소','AbortError');
      if(!Number.isSafeInteger(number)||number<1||number>pdf.getPageCount())throw Error('표 분석 쪽 번호가 올바르지 않습니다.');
      const page=pdf.getPage(number-1),raw=ctx.lookup(page.node.get(n('Contents')));
      const refs=raw instanceof PDFLib.PDFArray?Array.from({length:raw.size()},(_,i)=>raw.get(i)):[raw];
      const script=refs.map(ref=>latin(decodedStream(ctx.lookup(ref),PDFLib))).join('\n');
      result.push(rulesFromOperations(operations(script)));
      await new Promise(resolve=>setTimeout(resolve,0));
    }
    return result;
  }
  return {tokens,operations,cmap,encodingCMap,listText,replaceText,listRectangles,replaceRectangle,listVectorPaths,replaceVectorPath,rulesFromOperations,tableRules};
});
