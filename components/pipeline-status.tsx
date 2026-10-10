'use client';
import {useEffect,useState} from 'react';
import type {ModelId} from '@/lib/models';
import {pipelineNotice,type PipelineReport} from '@/lib/pipeline-status-message';
export function PipelineStatus({model,run,onUpdate}:{model:ModelId;run:string;onUpdate:()=>void}){
 const [report,setReport]=useState<PipelineReport|null>(null);
 useEffect(()=>{const c=new AbortController();async function check(){if(document.hidden)return;try{const r=await fetch('https://raw.githubusercontent.com/matthewhugo81-arch/stratoscope/forecast-status/latest.json',{cache:'no-cache',signal:AbortSignal.any([c.signal,AbortSignal.timeout(15000)])});if(!r.ok)return;const d=await r.json() as PipelineReport;if(d.version===1&&Number.isFinite(Date.parse(d.checkedAt))&&Array.isArray(d.models)&&!c.signal.aborted)setReport(d);}catch{}}
 void check();const timer=setInterval(check,300000);document.addEventListener('visibilitychange',check);return()=>{c.abort();clearInterval(timer);document.removeEventListener('visibilitychange',check)};},[]);
 if(!report||!run)return null;
 const feed=report.models.find(d=>d.model===model);if(!feed)return null;
 const notice=pipelineNotice(report,feed,run);
 return <span className={notice.kind==='current'?'pipeline-current':'pipeline-note'}>{notice.text}{notice.kind==='new-run'&&<> <button className="text-button" onClick={onUpdate}>Load updated run</button></>}</span>;
}
