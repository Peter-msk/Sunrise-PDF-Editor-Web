/* Sunrise PDF Editor — local PDF metadata dialog, no upstream dependencies. */
(function(root){
  'use strict';
  // B09: shared download validation / MIME handling; old bridge still works if absent.
  const downloadLocal = (...args) => typeof root.SunriseLocalUI?.download === 'function'
    ? root.SunriseLocalUI.download(...args) : root.downloadBytes(...args);
  // Optional telemetry: local PDF work still runs without the telemetry script.
  const runTracked = typeof root.SunriseLocalMetrics?.track === 'function'
    ? root.SunriseLocalMetrics.track
    : (_feature, operation) => Promise.resolve().then(operation);
  const fields=[['title','문서 제목'],['author','작성자'],['subject','주제'],
    ['creator','작성 프로그램'],['producer','생성 프로그램'],['keywords','키워드 (쉼표로 구분)']];
  const byId=id=>document.getElementById(id);
  function make(tag,text,props={}){
    const element=document.createElement(tag);
    if(text!==undefined)element.textContent=text;
    for(const [name,value] of Object.entries(props))element.setAttribute(name,value);
    return element;
  }
  function launch(){
    const core=root.SunrisePdfMetadata;
    if(!core?.apply||!core.inspect||!root.PDFLib||typeof root.readPdfInputFile!=='function'||
       typeof root.openModal!=='function')return;
    root.openModal({title:'PDF 문서 속성',icon:'fa-file-circle-info',width:'660px',
      bodyHtml:`<p>PDF 제목·작성자·주제·작성 프로그램·키워드를 확인하거나 수정합니다. 수정본은 새 파일로 다운로드합니다.</p>
        <label for="sunMetaFile">PDF 파일</label>
        <input id="sunMetaFile" type="file" accept=".pdf,application/pdf" style="display:block;width:100%;margin:8px 0">
        <button id="sunMetaInspect" class="dialog-btn" type="button">문서 정보 읽기</button>
        <p id="sunMetaInfo" role="status" aria-live="polite">PDF를 선택해 주세요.</p>
        <div id="sunMetaFields" class="dialog-form-grid" style="margin-top:12px"></div>
        <p style="font-size:12px">이 기능은 일반 문서 정보만 바꿉니다. XMP, 첨부파일 또는 PDF 본문 내 개인정보를 완전히 삭제하는 기능이 아닙니다. 서명된 문서는 보호를 위해 제외합니다.</p>
        <p id="sunMetaStatus" role="status" aria-live="polite"></p>
        <div id="sunMetaDownload"></div>`,
      footerHtml:`<div></div><div class="modal-footer-right">
        <button id="sunMetaApply" class="dialog-btn primary" type="button" disabled>수정된 PDF 만들기</button>
        <button id="sunMetaCancel" class="dialog-btn" type="button">닫기</button></div>`,
      onMount:()=>{
        const file=byId('sunMetaFile'),info=byId('sunMetaInfo'),status=byId('sunMetaStatus');
        const content=byId('sunMetaFields'),output=byId('sunMetaDownload');
        const start=byId('sunMetaApply'),cancel=byId('sunMetaCancel');
        let running=false,stopped=false,inspected=null;
        const visible=()=>byId('modalBackdrop')?.classList.contains('open')&&document.contains(start);
        const clear=()=>{inspected=null;start.disabled=true;content.replaceChildren();output.replaceChildren();};
        file.addEventListener('change',()=>{clear();info.textContent='문서 정보 읽기를 누르세요.';});
        const inspect=async()=>{
          if(running||!file.files?.[0]){status.textContent='PDF를 선택해 주세요.';return;}
          running=true;clear();status.textContent='문서 정보를 읽고 있습니다.';
          try{
            const result=await core.inspect(file.files[0],{PDFLib:root.PDFLib,readFile:root.readPdfInputFile});
            if(!visible())return;
            inspected=result;info.textContent=`${result.fileName} · ${result.pageCount}쪽`;
            for(const [id,label] of fields){
              const input=make(id==='keywords'?'textarea':'input',undefined,{
                id:'sunMeta_'+id,class:'dialog-input','aria-label':label
              });
              if(id!=='keywords')input.type='text';
              input.value=result.properties[id]||'';
              content.append(make('label',label,{for:input.id}),input);
            }
            start.disabled=false;status.textContent='변경할 항목을 수정한 뒤 새 PDF를 만들어 주세요.';
          }catch(error){if(visible())status.textContent=error?.message||'문서 정보를 불러오지 못했습니다.';}
          finally{running=false;}
        };
        byId('sunMetaInspect').addEventListener('click',inspect);
        cancel.addEventListener('click',()=>{
          if(!running)root.closeModal();
          else{stopped=true;cancel.disabled=true;status.textContent='변경을 안전하게 취소합니다.';}
        });
        start.addEventListener('click',async()=>{
          if(running||!inspected||!file.files?.[0])return;
          running=true;stopped=false;start.disabled=true;cancel.textContent='작업 취소';output.replaceChildren();
          const changes={};
          for(const [key] of fields){
            const value=byId('sunMeta_'+key).value;
            if(value!==inspected.properties[key])changes[key]=value;
          }
          try{
            const result=await runTracked('local_metadata', () => core.apply(file.files[0],changes,{
              PDFLib:root.PDFLib,readFile:root.readPdfInputFile,
              cancelled:()=>stopped||!visible(),
              onProgress:({done,total})=>{if(visible())status.textContent=`문서 속성 변경 중 ${done}/${total}`;}
            }), () => stopped || !visible());
            if(stopped||!visible())return;
            const filename=file.files[0].name.replace(/\.pdf$/i,'')+'_properties.pdf';
            const button=make('button',`${filename} 다운로드`,{type:'button',class:'dialog-btn primary'});
            button.addEventListener('click',()=>downloadLocal(result.bytes,filename));
            output.append(button);
            status.textContent=`${result.changed}개 속성을 변경했습니다. 결과 PDF는 다운로드 버튼으로 별도 저장합니다.`;
          }catch(error){if(visible())status.textContent=error?.name==='AbortError'?
            '취소되었습니다. 부분 PDF를 제공하지 않습니다.':error?.message||'문서 속성을 변경할 수 없습니다.';}
          finally{running=false;start.disabled=!inspected;cancel.disabled=false;cancel.textContent='닫기';}
        });
      }
    });
  }
  root.SunrisePdfMetadataUI={launch};
  root.SunrisePdfMetadataLaunch=launch;
})(typeof window!=='undefined'?window:globalThis);
