'use client';
import {memo,useEffect,useRef} from 'react';
import type {Frame} from '@/lib/grib';
import {color,inverseGlobe,sample,sampleWind,viewBasis} from '@/lib/globe';

const size=72,basis=viewBasis(90,0),viewport={width:size,height:size,dpr:1};
// Small north-pole previews reuse downloaded fields; opening this strip does
// not request weather data or allocate a WebGL context for each forecast.
const Stamp=memo(function Stamp({frame,field}:{frame:Frame;field:string}){
 const canvas=useRef<HTMLCanvasElement>(null);
 useEffect(()=>{
  const ctx=canvas.current?.getContext('2d');if(!ctx)return;
  const image=ctx.createImageData(size,size),wind=field==='wind';
  for(let y=0;y<size;y++)for(let x=0;x<size;x++){
   const p=inverseGlobe(x,y,basis,1,viewport);if(!p||p.lat<0)continue;
   const value=wind?sampleWind(frame,p.lat,p.lon):sample(frame,frame.temperature,p.lat,p.lon);
   const rgb=color(value,wind,frame.ensemble?.view==='spread'),h=sample(frame,frame.height,p.lat,p.lon)/400;
   const contour=Math.abs(h-Math.round(h))<.025,k=(y*size+x)*4;
   rgb.forEach((v,c)=>image.data[k+c]=contour?v*.45+240*.55:v);image.data[k+3]=255;
  }
  ctx.putImageData(image,0,0);ctx.fillStyle='#eff9ff';ctx.font='9px monospace';ctx.textAlign='center';ctx.fillText('N',size/2,size/2+3);
 },[frame,field]);
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
 return <section ref={section} className="forecast-stamps" id="forecast-stamps" aria-label="Forecast frame previews">
  <div className="stamps-heading"><span>NORTH-POLE PREVIEWS</span><span>Downloaded frames · click a time to view</span></div>
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
