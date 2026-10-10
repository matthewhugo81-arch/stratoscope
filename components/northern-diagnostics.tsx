'use client';
import {useEffect,useRef,useState} from 'react';
import {SaveImageButton} from './save-image-button';
import {saveSvgChart} from '@/lib/image-export';
import {fetchDiagnostics,diagnosticMean,type NorthernDiagnostics} from '@/lib/northern-diagnostics';
import type {EnsembleModel} from '@/lib/models';
import {diagnosticAxis} from '@/lib/diagnostic-axis';
const models:EnsembleModel[]=['gefs','ifs_ens','aifs_ens'];
const names={gefs:'GEFS',ifs_ens:'ECMWF ENS',aifs_ens:'AIFS ENS'};
const colours={gefs:'#f4ac58',ifs_ens:'#a7e4d6',aifs_ens:'#b69ef5'};
const format=(time:number)=>new Date(time).toLocaleString('en-GB',{timeZone:'UTC',day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit',hour12:false});
export function NorthernComparison(){
 const windRef=useRef<SVGSVGElement>(null),temperatureRef=useRef<SVGSVGElement>(null);
 const [open,setOpen]=useState(false),[data,setData]=useState<Partial<Record<EnsembleModel,NorthernDiagnostics>>>({}),[failed,setFailed]=useState<EnsembleModel[]>([]),[loading,setLoading]=useState(false),[refresh,setRefresh]=useState(0),[members,setMembers]=useState<EnsembleModel[]>([]),[enabled,setEnabled]=useState<EnsembleModel[]>(models),[cursor,setCursor]=useState<number|null>(null);
 useEffect(()=>{
  if(!open)return;const c=new AbortController();setLoading(true);setFailed([]);
  void Promise.all(models.map(async model=>{try{const d=await fetchDiagnostics(model,AbortSignal.any([c.signal,AbortSignal.timeout(45000)]),refresh>0);if(!c.signal.aborted)setData(old=>({...old,[model]:d}));}catch{if(!c.signal.aborted)setFailed(old=>[...old,model]);}})).finally(()=>{if(!c.signal.aborted)setLoading(false)});
  return()=>c.abort();
 },[open,refresh]);
 const series=models.flatMap(m=>data[m]&&enabled.includes(m)?[data[m]!]:[]),all=models.flatMap(m=>data[m]?[data[m]!]:[]);
 const start=all.length?Math.min(...all.map(d=>Date.parse(d.run))):0,end=all.length?Math.max(...all.map(d=>Date.parse(d.run)+d.maxHour*3600000)):1;
 const t=cursor===null?start:Math.max(start,Math.min(end,cursor));
 const [includeZero,setIncludeZero]=useState(false);
 function chart(key:'wind'|'temperature',title:string,unit:string){
  const svgRef=key==='wind'?windRef:temperatureRef;
  const vals=series.flatMap(d=>d.points.flatMap(p=>members.includes(d.model)?p[key]:[diagnosticMean(p[key])]));
  const {min,max,ticks}=diagnosticAxis(vals,key==='wind'&&includeZero);
  const w=1000,h=280,left=62,right=18,top=20,bottom=44,x=(time:number)=>left+(time-start)/(end-start||1)*(w-left-right),y=(v:number)=>h-bottom-(v-min)/(max-min)*(h-top-bottom);
  const path=(d:NorthernDiagnostics,m?:number)=>d.points.map((p,i)=>`${i?'L':'M'}${x(Date.parse(d.run)+p.hour*3600000).toFixed(2)},${y(m===undefined?diagnosticMean(p[key]):p[key][m]).toFixed(2)}`).join(' ');
  return <div className="nh-diagnostic-chart"><h3>{title} <span>{unit}</span><SaveImageButton disabled={!series.length} onSave={()=>saveSvgChart(svgRef.current!,{filename:`stratoscope-northern-${key}-${new Date(t).toISOString().slice(0,10)}`,title,subtitle:`Model comparison · UTC ${format(t)} · ${unit}`,notes:[`Included models: ${series.map(d=>names[d.model]+' ('+format(Date.parse(d.run))+' UTC)').join(', ')}.`,`Solid lines: ensemble means${members.length?'; selected member traces shown':''}. ${key==='wind'?'Negative u = easterly, not confirmed SSW.':'Area-weighted 60–90°N temperature.'}`]})}/></h3><svg ref={svgRef} viewBox={`0 0 ${w} ${h}`} role="img" aria-label={title+' forecast model comparison'} onPointerMove={e=>{const r=e.currentTarget.getBoundingClientRect();const px=(e.clientX-r.left)/r.width*w;setCursor(start+Math.round(Math.max(0,Math.min(1,(px-left)/(w-left-right)))*(end-start)/21600000)*21600000);}}>
   {ticks.map(v=><g key={v}><line x1={left} x2={w-right} y1={y(v)} y2={y(v)} stroke={v===0&&key==='wind'?'#f4ac58':'#29414c'} strokeDasharray={v===0&&key==='wind'?'6 5':undefined}/><text x={left-10} y={y(v)+4} textAnchor="end">{v}</text></g>)}
   {Array.from({length:7},(_,i)=>start+(end-start)*i/6).map(time=><text key={time} x={x(time)} y={h-14} textAnchor="middle">{new Date(time).toLocaleDateString('en-GB',{timeZone:'UTC',day:'numeric',month:'short'})}</text>)}
   {series.map(d=><g key={d.model}>{members.includes(d.model)&&Array.from({length:d.count},(_,m)=><path key={m} d={path(d,m)} stroke={colours[d.model]} strokeOpacity=".18" strokeWidth=".8" fill="none"/>)}<path d={path(d)} stroke={colours[d.model]} strokeWidth="2.8" fill="none"/></g>)}
   <line x1={x(t)} x2={x(t)} y1={top} y2={h-bottom} stroke="#c5d6df" strokeOpacity=".6"/>
  </svg>{key==='wind'&&vals.length>0&&(min>0||max<0)&&<small className="muted">Automatic scale · zero wind is {min>0?'below':'above'} the displayed range.</small>}<div className="nh-diagnostic-values"><time>{format(t)} UTC</time>{series.map(d=>{const i=Math.round((t-Date.parse(d.run))/21600000),p=d.points[i];return <span key={d.model} style={{color:colours[d.model]}}>{names[d.model]} <strong>{p?diagnosticMean(p[key]).toFixed(1)+' '+unit:'—'}</strong>{p&&key==='wind'?` · ${p.wind.filter(v=>v<0).length}/${d.count} easterly`:''}</span>})}</div></div>;
 }
 return <div className="glosea-section"><button className="glosea-toggle" onClick={()=>setOpen(v=>!v)} aria-expanded={open} aria-controls="northern-diagnostics">{open?'Hide':'Show'} northern forecast diagnostics <span>10 hPa · wind & polar-cap temperature</span></button>{open&&<section id="northern-diagnostics" className="glosea-outlook" aria-label="Northern forecast diagnostics">
  <div className="glosea-heading"><div><span className="eyebrow">STRATOSCOPE · NORTHERN DIAGNOSTICS</span><h2>Polar vortex <span>/ forecast comparison</span></h2></div><button className="seasonal-refresh" onClick={()=>setRefresh(v=>v+1)} disabled={loading}>Refresh diagnostics</button></div>
  <div className="nh-diagnostic-models">{models.map(m=><div key={m}><label style={{color:colours[m]}}><input type="checkbox" checked={enabled.includes(m)} onChange={e=>setEnabled(old=>e.target.checked?[...old,m]:old.filter(v=>v!==m))}/>{names[m]} mean</label><label><input type="checkbox" checked={members.includes(m)} onChange={e=>setMembers(old=>e.target.checked?[...old,m]:old.filter(v=>v!==m))}/>Members</label><small>{data[m]?`Init ${format(Date.parse(data[m]!.run))} UTC · ${data[m]!.count} members`:loading?'Checking complete data…':'Awaiting complete data'}</small></div>)}</div>
  <label className="nh-diagnostic-time"><input type="checkbox" checked={includeZero} onChange={e=>setIncludeZero(e.target.checked)}/>Include zero wind on scale <span className="muted">Axes automatically fit the visible curves.</span></label>
  {loading&&<p role="status">Loading compact diagnostic series…</p>}{failed.length>0&&<p role="status">{failed.map(m=>names[m]).join(', ')}: diagnostics are not available yet. Previously loaded runs remain labelled by their initialization time.</p>}
  {all.length>0&&<>{chart('wind','10 hPa · 60°N zonal-mean zonal wind','m/s')}{chart('temperature','10 hPa · 60–90°N area-mean temperature','°C')}<label className="nh-diagnostic-time">Comparison time<input aria-label="Diagnostic comparison time" type="range" min={start} max={end} step={21600000} value={t} onChange={e=>setCursor(Number(e.target.value))}/></label></>}
  <p>Solid lines: complete ensemble means. Member lines can be enabled independently. Dates use UTC; each model’s initialization is shown above. Wind is the signed native-grid average around 60°N: values below zero indicate easterlies, not by themselves a confirmed SSW. Temperature is area weighted across 60–90°N using the stored 2° overview grid. This is a forecast-only view; historical values are not inferred. DWD ICON’s open feed has no 10 hPa data.</p>
 </section>}</div>;
}
