'use client';
import {useEffect,useState} from 'react';
import type {ModelId} from '@/lib/models';
type Feed={model:string;availableRun?:string;publishedRun?:string;status:string};
type Report={version:number;checkedAt:string;models:Feed[]};
const stamp=(s:string)=>new Date(s).toLocaleString('en-GB',{timeZone:'UTC',day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit',hour12:false});
export function PipelineStatus({model,run,onUpdate}:{model:ModelId;run:string;onUpdate:()=>void}){
 const [report,setReport]=useState<Report|null>(null);
 useEffect(()=>{const c=new AbortController();async function check(){if(document.hidden)return;try{const r=await fetch('https://raw.githubusercontent.com/matthewhugo81-arch/stratoscope/forecast-status/latest.json',{cache:'no-cache',signal:AbortSignal.any([c.signal,AbortSignal.timeout(15000)])});if(!r.ok)return;const d=await r.json() as Report;if(d.version===1&&Number.isFinite(Date.parse(d.checkedAt))&&Array.isArray(d.models)&&!c.signal.aborted)setReport(d);}catch{}}
 void check();const timer=setInterval(check,300000);document.addEventListener('visibilitychange',check);return()=>{c.abort();clearInterval(timer);document.removeEventListener('visibilitychange',check)};},[]);
 if(!report||!run)return null;
 const feed=report.models.find(d=>d.model===model);if(!feed)return null;
 if(Date.now()-Date.parse(report.checkedAt)>5400000)return <span className="pipeline-note">Freshness check overdue · last checked {stamp(report.checkedAt)} UTC</span>;
 const published=feed.status==='direct'?feed.availableRun:feed.publishedRun;
 if(published&&Date.parse(published)>Date.parse(run))return <span className="pipeline-note">New run ready: {stamp(published)} UTC <button className="text-button" onClick={onUpdate}>Load updated run</button></span>;
 if(feed.availableRun&&Date.parse(feed.availableRun)>Date.parse(run))return <span className="pipeline-note">{stamp(feed.availableRun)} UTC {feed.status==='updating'?'is being prepared':'awaiting preparation'} · showing the complete previous run.</span>;
 if(feed.status==='error')return <span className="pipeline-note">Source check unavailable · showing the last complete run.</span>;
 return <span className="pipeline-current">Latest complete source run · checked {stamp(report.checkedAt)} UTC</span>;
}
