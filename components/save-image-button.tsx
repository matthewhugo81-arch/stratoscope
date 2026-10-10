'use client';
import {useEffect,useRef,useState} from 'react';
import {Download,Check,LoaderCircle} from 'lucide-react';
import {chartPng,downloadPng,type ChartImage} from '@/lib/chart-export';

type Props={getImage:()=>ChartImage;disabled?:boolean;label?:string;beforeSave?:()=>void;originalUrl?:string};
export function SaveImageButton({getImage,disabled=false,label='chart',beforeSave,originalUrl}:Props){
 const [busy,setBusy]=useState(false),[done,setDone]=useState(false),[error,setError]=useState('');
 const lock=useRef(false),mounted=useRef(false),timer=useRef<ReturnType<typeof setTimeout>|undefined>(undefined);
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;clearTimeout(timer.current)}},[]);
 async function save(){
  if(lock.current||disabled)return;
  lock.current=true;setBusy(true);setDone(false);setError('');clearTimeout(timer.current);
  try{
   beforeSave?.();
   const spec=getImage(),png=await chartPng(spec);
   if(!mounted.current)return;
   downloadPng(png,spec.filename);setDone(true);
   timer.current=setTimeout(()=>{if(mounted.current)setDone(false)},3000);
  }catch(e){if(mounted.current)setError(e instanceof Error?e.message:'The image could not be saved. Please retry.');}
  finally{lock.current=false;if(mounted.current)setBusy(false);}
 }
 return <span className="chart-save-wrap" data-export-ignore="true">
  <button type="button" className="chart-save" onClick={()=>void save()} disabled={disabled||busy} aria-label={`Save ${label} as PNG`} aria-busy={busy} title={disabled?'Wait for the chart to load':`Save ${label} as a PNG image`}>
   {busy?<LoaderCircle size={13} className="spin" aria-hidden="true"/>:done?<Check size={13} aria-hidden="true"/>:<Download size={13} aria-hidden="true"/>}<span>{busy?'Saving…':'Save'}</span>
  </button>
  <span className="chart-save-feedback" role="status">{done?'PNG download started.':''}</span>
  {error&&<span className="chart-save-error" role="alert">{error}{originalUrl&&<>{' '}<a href={originalUrl} target="_blank" rel="noreferrer">Open original chart ↗</a></>}</span>}
 </span>;
}
