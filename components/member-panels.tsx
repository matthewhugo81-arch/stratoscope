'use client';
import {memo,useEffect,useRef,useState} from 'react';
import type {Frame} from '@/lib/grib';
import {MODELS,type EnsembleModel} from '@/lib/models';
import {isEasterly,loadMemberPanels} from '@/lib/member-panels';
import {color,inverseGlobe,projectGlobe,sample,sampleWind,viewBasis} from '@/lib/globe';
import {temperatureGradient} from '@/lib/temperature-scale';
const size=144,basis=viewBasis(90,0),viewport={width:size,height:size,dpr:1};
const Panel=memo(function Panel({frame,field,coast,onSelect}:{frame:Frame;field:string;coast:number[][][];onSelect:()=>void}){
 const canvas=useRef<HTMLCanvasElement>(null),u=frame.zonalWind60N!.value,easterly=isEasterly(u);
 const windLabel=Math.abs(u)<.05?(u<0?'−<0.1':u>0?'+<0.1':'0.0'):(u>0?'+':'')+u.toFixed(1);
 useEffect(()=>{
  const ctx=canvas.current?.getContext('2d');if(!ctx)return;
  const image=ctx.createImageData(size,size);
  for(let y=0;y<size;y++)for(let x=0;x<size;x++){
   const p=inverseGlobe(x,y,basis,1,viewport);if(!p||p.lat<0)continue;
   const rgb=color(field==='wind'?sampleWind(frame,p.lat,p.lon):sample(frame,frame.temperature,p.lat,p.lon),field==='wind',false);
   const h=sample(frame,frame.height,p.lat,p.lon)/400,contour=Math.abs(h-Math.round(h))<.03,k=(y*size+x)*4;
   rgb.forEach((v,c)=>image.data[k+c]=contour?v*.5+240*.5:v);image.data[k+3]=255;
  }
  ctx.putImageData(image,0,0);ctx.strokeStyle='#e4f5ff99';ctx.lineWidth=.55;
  for(const points of coast){ctx.beginPath();let started=false;for(const [lon,lat] of points){const p=projectGlobe(lon,lat,basis,1,viewport);if(p.depth<=0){started=false;continue}if(started)ctx.lineTo(p.x,p.y);else{ctx.moveTo(p.x,p.y);started=true}}ctx.stroke()}
 },[frame,field,coast]);
 return <button className={'member-map-tile'+(easterly?' easterly':'')} onClick={onSelect} aria-label={`${frame.ensemble!.member===0?'Control':'Member '+frame.ensemble!.member}, 60N 10hPa zonal wind ${u.toFixed(3)} metres per second${easterly?', easterly':''}. Open on globe.`}>
  <strong>{frame.ensemble!.member===0?'Control':`Member ${String(frame.ensemble!.member).padStart(2,'0')}`}</strong><canvas ref={canvas} width={size} height={size} aria-hidden="true"/><span>{windLabel} m/s{easterly?' · E':''}</span>
 </button>;
});
export function MemberPanels({model,run,hour,field,onClose,onInspect}:{model:EnsembleModel;run:string;hour:number;field:string;onClose:()=>void;onInspect:(member:number,hour:number,field:string)=>void}){
 const dialog=useRef<HTMLDialogElement>(null),[lead,setLead]=useState(hour),[variable,setVariable]=useState(field),[data,setData]=useState<Frame[]|null>(null),[error,setError]=useState(''),[retry,setRetry]=useState(0),[coast,setCoast]=useState<number[][][]>([]);
 const grid=useRef<HTMLDivElement>(null),[columns,setColumns]=useState(13);
 useEffect(()=>{if(!grid.current||!data)return;const resize=new ResizeObserver(([entry])=>{const {width,height}=entry.contentRect;if(width<550){setColumns(3);return}let best=1,area=0;for(let c=1;c<=data.length;c++){const side=Math.min(width/c-10,height/Math.ceil(data.length/c)-36);if(side>area){area=side;best=c}}setColumns(best)});resize.observe(grid.current);return()=>resize.disconnect()},[data]);
 useEffect(()=>{const d=dialog.current!;d.showModal();return()=>d.close()},[]);
 useEffect(()=>{const c=new AbortController();void fetch(new URL('coastline.json',document.baseURI),{signal:c.signal}).then(r=>r.json() as Promise<{features:{geometry:{type:string;coordinates:number[][]|number[][][]}}[]}>).then(j=>setCoast(j.features.flatMap(f=>f.geometry.type==='LineString'?[f.geometry.coordinates as number[][]]:f.geometry.coordinates as number[][][]))).catch(()=>{});return()=>c.abort()},[]);
 useEffect(()=>{const c=new AbortController();setData(null);setError('');void loadMemberPanels(model,run,lead,AbortSignal.any([c.signal,AbortSignal.timeout(60000)])).then(d=>{if(!c.signal.aborted)setData(d)}).catch(e=>{if(!c.signal.aborted)setError(e.message)});return()=>c.abort()},[model,run,lead,retry]);
 const valid=new Date(Date.parse(run)+lead*3600000).toLocaleString('en-GB',{timeZone:'UTC',day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'}),negative=data?.filter(f=>isEasterly(f.zonalWind60N!.value)).length;
 return <dialog ref={dialog} className="member-maps-dialog" onCancel={onClose} aria-label="All ensemble member maps">
  <header><div><h2>{MODELS[model].label} · All members</h2><span>10 hPa · {valid} UTC · +{lead}h · run {run.slice(0,10)} {run.slice(11,16)} UTC</span></div><button onClick={onClose} aria-label="Close member panels">Close ×</button></header>
  <div className="member-maps-toolbar"><button disabled={lead===0} onClick={()=>setLead(h=>h-6)}>← Previous</button><input type="range" min={0} max={MODELS[model].maxHour} step={6} value={lead} onChange={e=>setLead(Number(e.target.value))} aria-label="Member panel forecast hour"/><button disabled={lead===MODELS[model].maxHour} onClick={()=>setLead(h=>h+6)}>Next →</button><select value={variable} onChange={e=>setVariable(e.target.value)} aria-label="Member panel field"><option value="temperature">Temperature</option><option value="wind">Wind speed</option></select></div>
  <div className="member-maps-key"><span>Red border / E: zonal-mean u &lt; 0 m/s at 60°N, 10 hPa{data?` · ${negative}/${data.length} members`:''}</span><div><span>{variable==='temperature'?'−90°C':'0 m/s'}</span><i style={{background:variable==='temperature'?temperatureGradient:'linear-gradient(90deg,#17314a,#167c8c,#66c9ac,#edcc73,#ee944b,#bd3352)'}}/><span>{variable==='temperature'?'+20°C':'120 m/s'}</span></div></div>
  {data?<div ref={grid} className="member-maps-grid" style={{gridTemplateColumns:`repeat(${columns},minmax(0,1fr))`}}>{data.map(f=><Panel key={f.ensemble!.member} frame={f} field={variable} coast={coast} onSelect={()=>onInspect(f.ensemble!.member!,lead,variable)}/>)}</div>:<div className="member-maps-pending" role="status">{error?<><p>{error}</p><button onClick={()=>setRetry(n=>n+1)}>Check again</button></>:<p>Loading one compact member-panel file…</p>}</div>}
  <footer>North-pole views · identical scales · 2° overview grids · click a member for the detailed globe. Red indicates easterly wind at this time, not a confirmed SSW event.</footer>
 </dialog>;
}
