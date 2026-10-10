'use client';
import {memo,useEffect,useRef} from 'react';
import {SaveImageButton} from './save-image-button';
import {saveCanvasScene} from '@/lib/image-export';
import type {Frame} from '@/lib/grib';
import {color,inverseGlobe,sample,sampleWind,viewBasis} from '@/lib/globe';

const size=72,basis=viewBasis(90,0);

function renderPreview(canvas:HTMLCanvasElement,frame:Frame,field:string){
 const ctx=canvas.getContext('2d');if(!ctx)throw Error('Canvas rendering is unavailable.');
 const dimension=canvas.width,viewport={width:dimension,height:dimension,dpr:1};
 const image=ctx.createImageData(dimension,dimension),wind=field==='wind';
 for(let y=0;y<dimension;y++)for(let x=0;x<dimension;x++){
  const p=inverseGlobe(x,y,basis,1,viewport);if(!p||p.lat<0)continue;
  const value=wind?sampleWind(frame,p.lat,p.lon):sample(frame,frame.temperature,p.lat,p.lon);
  const rgb=color(value,wind,frame.ensemble?.view==='spread'),h=sample(frame,frame.height,p.lat,p.lon)/400;
  const contour=Math.abs(h-Math.round(h))<.025,k=(y*dimension+x)*4;
  rgb.forEach((v,c)=>image.data[k+c]=contour?v*.45+240*.55:v);
  image.data[k+3]=255;
 }
 ctx.putImageData(image,0,0);
 ctx.fillStyle='#eff9ff';ctx.font=`${Math.max(9,Math.round(dimension*.023))}px monospace`;
 ctx.textAlign='center';ctx.fillText('N',dimension/2,dimension/2+3);
}

// Small north-pole previews reuse downloaded fields; opening this strip does
// not request weather data or allocate a WebGL context for each forecast.
const Stamp=memo(function Stamp({frame,field}:{frame:Frame;field:string}){
 const canvas=useRef<HTMLCanvasElement>(null);
 useEffect(()=>{if(canvas.current)renderPreview(canvas.current,frame,field)},[frame,field]);
 return <canvas ref={canvas} width={size} height={size} aria-hidden="true"/>;
});

export function ForecastStamps({times,hour,run,field,onSelect}:{times:{hour:number;frame?:Frame}[];hour:number;run:string;field:string;onSelect:(hour:number)=>void}){
 const section=useRef<HTMLElement>(null),track=useRef<HTMLDivElement>(null);
 useEffect(()=>{section.current?.scrollIntoView({block:'nearest',behavior:'instant'});},[]);
 useEffect(()=>{
  const row=track.current,selected=row?.querySelector<HTMLElement>('[aria-current="step"]');
  if(!row||!selected)return;
  const a=row.getBoundingClientRect(),b=selected.getBoundingClientRect();
  if(b.left<a.left||b.right>a.right)row.scrollLeft+=b.left-a.left-(a.width-b.width)/2;
 },[hour]);

 const selected=times.find(t=>t.hour===hour)?.frame;
 async function saveSelected(){
  if(!selected)throw Error('Download the selected forecast frame before saving.');
  const surface=document.createElement('canvas');surface.width=640;surface.height=640;
  surface.style.cssText='position:fixed;left:-10000px;top:-10000px;width:640px;height:640px;pointer-events:none';
  document.body.appendChild(surface);
  try{
   renderPreview(surface,selected,field);
   await saveCanvasScene([surface],{
    filename:`stratoscope-${selected.model??'forecast'}-${selected.level}hpa-${field}-frame-${selected.run.slice(0,10)}-f${selected.hour}`,
    title:`${selected.model?.toUpperCase()??'Forecast'} · North-pole ${field} preview`,
    subtitle:`${selected.level} hPa · Run ${selected.run.slice(0,16)} UTC · valid ${selected.valid.slice(0,16)} UTC · +${selected.hour}h`,
    notes:['High-resolution rendering of the selected loaded frame; no additional model data requested.']
   });
  }finally{surface.remove();}
 }
 return <section ref={section} className="forecast-stamps" id="forecast-stamps" aria-label="Forecast frame previews">
  <div className="stamps-heading"><span>NORTH-POLE PREVIEWS</span><span>Downloaded frames · click a time to view</span><SaveImageButton label="Save" disabled={!selected} onSave={saveSelected}/></div>
  <div className="stamps-track" ref={track}>{times.map(time=>{
   const valid=run?new Date(Date.parse(run)+time.hour*3600000):null;
   const label=valid?valid.toLocaleString('en-GB',{timeZone:'UTC',day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit',hour12:false}):'';
   return <button key={time.hour} className={`forecast-stamp ${hour===time.hour?'selected':''}`} aria-label={`Forecast +${time.hour} hours, ${label} UTC${time.frame?', downloaded':', not downloaded'}`} aria-current={hour===time.hour?'step':undefined} onClick={()=>onSelect(time.hour)}>
    {time.frame?<Stamp frame={time.frame} field={field}/>:<span className="stamp-empty">To load</span>}
    <strong>{time.hour===0?'Initial':`+${time.hour}h`}</strong><small>{valid?`${String(valid.getUTCDate()).padStart(2,'0')} ${valid.toLocaleString('en-GB',{month:'short',timeZone:'UTC'})}`:'—'}</small><small>{valid?`${String(valid.getUTCHours()).padStart(2,'0')}:00 UTC`:''}</small>
   </button>;
  })}</div>
 </section>;
}
