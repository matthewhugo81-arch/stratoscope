'use client';
import {useEffect,useRef,useState} from 'react';
import {SaveImageButton} from './save-image-button';
import {saveImageSnapshot} from '@/lib/image-export';
import {loadHeatFlux,heatFluxSummary,type HeatFluxSeries} from '@/lib/heat-flux';
import type {VortexCatalogue} from '@/lib/vortex';
import {diagnosticAxis} from '@/lib/diagnostic-axis';

export function HeatFluxChart({catalogue,hour,displayedRun,onSelect}:{catalogue:VortexCatalogue|null;hour:number;displayedRun:string;onSelect:(hour:number)=>void}){
 const svgRef=useRef<SVGSVGElement>(null);
 const [data,setData]=useState<HeatFluxSeries|null>(null),[error,setError]=useState(''),[members,setMembers]=useState(false),[retry,setRetry]=useState(0);
 useEffect(()=>{
  setError('');setData(null);if(!catalogue?.heatFlux)return;
  const c=new AbortController();let timer:ReturnType<typeof setTimeout>;
  loadHeatFlux(catalogue,AbortSignal.any([c.signal,AbortSignal.timeout(30000)])).then(d=>{if(!c.signal.aborted)setData(d)}).catch(e=>{if(!c.signal.aborted){setError((e as Error).message);timer=setTimeout(()=>setRetry(v=>v+1),60000)}});
  return()=>{c.abort();clearTimeout(timer)};
 },[catalogue?.run,catalogue?.heatFlux?.sha256,retry]);
 const series=data?.run===displayedRun?data:null;
 const points=series?.points.map(p=>({...p,...heatFluxSummary(p.members)}))??[];
 const {min,max,ticks}=diagnosticAxis(points.flatMap(p=>members?p.members:[p.low,p.high,p.mean]),true);
 const w=1000,h=220,left=62,right=20,top=15,bottom=34;
 const x=(v:number)=>left+v/384*(w-left-right),y=(v:number)=>h-bottom-(v-min)/(max-min)*(h-top-bottom);
 const line=(values:number[])=>values.map((v,i)=>`${i?'L':'M'}${x(points[i].hour).toFixed(2)},${y(v).toFixed(2)}`).join(' ');
 const selected=points.find(p=>p.hour===hour);
 const signed=(v:number)=>(v>0?'+':'')+v.toFixed(1);
 const date=(v:number)=>new Date(Date.parse(displayedRun)+v*3600000).toLocaleDateString('en-GB',{timeZone:'UTC',day:'numeric',month:'short'});
 return <div className="heat-flux-chart" aria-label="GEFS 100 hPa eddy heat flux">
  <div className="heat-flux-heading"><h3>Eddy heat flux <span>100 hPa · 45–75°N · K m/s</span></h3><label><input type="checkbox" checked={members} onChange={e=>setMembers(e.target.checked)}/>All 31 members</label><SaveImageButton description="GEFS eddy heat-flux chart" disabled={!series} onSave={()=>saveImageSnapshot(svgRef.current!,{filename:`stratoscope-gefs-heat-flux-${displayedRun.slice(0,10)}-f${hour}`,title:'GEFS · 100 hPa eddy heat flux',subtitle:`Run ${displayedRun} · 45–75°N · K m/s`,details:[`Selected: ${date(hour)} · forecast +${hour}h${selected?` · mean ${signed(selected.mean)} K m/s`:''}`,`Ensemble mean · 10th–90th member range · ${members?'all 31 members shown':'member curves hidden'}`,'Positive heat transport indicates poleward eddy flux, not guaranteed SSW'],source:'NOAA GEFS · 31-member heat-flux diagnostic · Instantaneous member statistics'})}/></div>
  <div className="heat-flux-legend"><span>━ Ensemble mean</span><span>▰ 10–90% member range</span><span>┆ Displayed vortex time</span></div>
  <div className="heat-flux-plot">{series?<svg ref={svgRef} viewBox={`0 0 ${w} ${h}`} role="group" aria-label="GEFS heat-flux forecast with ensemble mean and 10–90 percent member range">
   {ticks.map(v=><g key={v}><line x1={left} x2={w-right} y1={y(v)} y2={y(v)} stroke={v===0?'#90aab9':'#29414c'} strokeDasharray={v===0?'5 4':undefined}/><text x={left-9} y={y(v)+4} textAnchor="end">{v}</text></g>)}
   <path d={line(points.map(p=>p.high))+' '+[...points].reverse().map(p=>`L${x(p.hour)},${y(p.low)}`).join(' ')+' Z'} fill="#9edfcf" fillOpacity=".16"/>
   {members&&Array.from({length:31},(_,m)=><path key={m} d={line(points.map(p=>p.members[m]))} fill="none" stroke="#78bec7" strokeOpacity=".24" strokeWidth=".7"/>)}
   <path d={line(points.map(p=>p.mean))} fill="none" stroke="#a6e3d4" strokeWidth="2.4"/>
   {Array.from({length:9},(_,i)=>i*48).map(v=><text key={v} x={x(v)} y={h-8} textAnchor="middle">{date(v)}</text>)}
   {selected&&<><line x1={x(hour)} x2={x(hour)} y1={top} y2={h-bottom} stroke="#f1c17b" strokeDasharray="4 4"/><circle cx={x(hour)} cy={y(selected.mean)} r="4" fill="#f1c17b"/></>}
   {points.map(p=><rect key={p.hour} x={Math.max(left,x(p.hour)-14)} y={top} width={Math.min(28,w-right-Math.max(left,x(p.hour)-14))} height={h-bottom-top} fill="transparent" role="button" tabIndex={0} aria-label={`Show vortex at +${p.hour} hours`} onClick={()=>onSelect(p.hour)} onKeyDown={e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();onSelect(p.hour)}}}><title>{date(p.hour)} +{p.hour}h: mean {signed(p.mean)} K m/s</title></rect>)}
  </svg>:<p role="status">{error?error+' · retrying automatically':catalogue?.heatFlux?'Loading the complete 31-member heat-flux forecast…':'The complete 31-member heat-flux forecast is preparing for this run.'}</p>}</div>
  <div className="heat-flux-reading" aria-live="polite">{selected?`${date(hour)} ${String(new Date(Date.parse(displayedRun)+hour*3600000).getUTCHours()).padStart(2,'0')}:00 UTC · Mean ${signed(selected.mean)} K m/s · 10–90% range ${signed(selected.low)} to ${signed(selected.high)}`:'Waiting for the matched run and forecast time'}</div>
  <p className="heat-flux-note">Positive values indicate poleward eddy heat transport, used as a proxy for upward wave activity in the Northern Hemisphere. Sustained pulses can favour vortex weakening; they do not guarantee an SSW. Forecast values, not anomalies or a probability of warming. Click the graph to select a vortex time.</p>
 </div>;
}
