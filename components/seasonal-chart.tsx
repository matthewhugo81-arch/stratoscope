'use client';
import {useEffect,useRef,useState} from 'react';
import {SaveImageButton} from './save-image-button';
import {saveImageSnapshot} from '@/lib/image-export';
import type {SeasonalClimate,EraClimate,EraProgress} from '@/lib/seasonal';
export type WindPlot={name:string;nominal:string;dates:string[];members:{id:string;values:number[]}[];mean:number[];easterlyFraction:number[];sampling:string;attribution:string};
const date=(s:string)=>new Date(s).toLocaleDateString('en-GB',{timeZone:'UTC',day:'numeric',month:'short',year:'numeric'});
const signed=(v:number)=>(v>0?'+':'')+v.toFixed(1);
export function SeasonalChart({data,climate,era,eraProgress,referenceError}:{data:WindPlot;climate:SeasonalClimate|null;era:EraClimate|null;eraProgress?:EraProgress|null;referenceError?:boolean}){
 const plotRef=useRef<SVGSVGElement>(null);
 const [now,setNow]=useState(()=>Date.now());
 useEffect(()=>{if(era)return;const timer=setInterval(()=>setNow(Date.now()),60000);return()=>clearInterval(timer)},[era]);
 const [day,setDay]=useState(()=>{const i=data.dates.findIndex(s=>Date.parse(s)>=Date.now());return i<0?data.dates.length-1:i}),[members,setMembers]=useState(true),[history,setHistory]=useState(true),[reference,setReference]=useState(true);
 const n=data.dates.length;
 const indices=data.dates.map(s=>Math.round((Date.parse(s)-Date.parse(data.nominal))/43200000)-1);
 const climateValues=(v:number[])=>indices.map(i=>v[i]);
 const eraValues=era?data.dates.map(s=>era.daily[s.slice(5,10)]):null;
 const all=data.members.flatMap(m=>m.values).concat(climate?[...climate.min,...climate.max]:[],eraValues??[]);
 const min=Math.floor(Math.min(-10,...all)/20)*20,max=Math.ceil(Math.max(10,...all)/20)*20;
 const x=(i:number)=>58+i/(n-1)*882,y=(v:number)=>26+(max-v)/(max-min)*284;
 const path=(values:number[])=>values.map((v,i)=>`${i?'L':'M'}${x(i).toFixed(2)},${y(v).toFixed(2)}`).join(' ');
 const band=(low:number[],high:number[])=>path(high)+' '+low.map((_,k)=>{const i=n-1-k;return `L${x(i).toFixed(2)},${y(low[i]).toFixed(2)}`}).join(' ')+' Z';
 const ticks=Array.from({length:(max-min)/20+1},(_,i)=>min+i*20),active=Math.min(day,n-1);
 const inspect=(e:React.PointerEvent<SVGSVGElement>)=>{const r=e.currentTarget.getBoundingClientRect();setDay(Math.max(0,Math.min(n-1,Math.round(((e.clientX-r.left)/r.width*960-58)/882*(n-1)))))};
 return <div className="native-seasonal-chart">
  <div className="seasonal-issue"><strong>{data.name}</strong><span>Issue {date(data.nominal)} · {data.members.length} members · {data.sampling}</span><SaveImageButton description={data.name+' seasonal wind outlook'} disabled={!data.dates.length} onSave={()=>saveImageSnapshot(plotRef.current!,{filename:`stratoscope-${data.name}-seasonal-${data.nominal.slice(0,7)}-wind`,title:data.name+' · Seasonal zonal wind',subtitle:`Issue ${date(data.nominal)} · 60°N, 10 hPa · ${data.members.length} members`,details:[`Selected: ${date(data.dates[active])} ${data.dates[active].slice(11,16)} UTC · mean ${signed(data.mean[active])} m/s`, `Members: ${members?'visible':'hidden'} · Model climate: ${history&&climate?'visible':'not displayed'} · ERA5: ${reference&&era?'visible':'not displayed'}`,'Signed zonal-mean u wind · Negative values are easterly, not SSW probabilities'],source:data.attribution})}/></div>
  {!era&&<p className="seasonal-pending" role="status">
   <strong>ERA5 reference pending.</strong>{' '}
   {eraProgress?<>{eraProgress.completedYears.length}/24 years prepared for 1993–2016.{eraProgress.nextYear!==null&&<> Next unfinished year: {eraProgress.nextYear}.</>}{' '}
    {now-Date.parse(eraProgress.checkedAt)>5400000?'Progress check overdue.':eraProgress.status==='updating'?'Import running.':eraProgress.status==='behind'?'Import awaiting restart.':eraProgress.status==='complete'?'Reference published; retrying download.':'Import status could not be checked.'}{' '}
    Last checked {date(eraProgress.checkedAt)} {eraProgress.checkedAt.slice(11,16)} UTC.{' '}</>:'The complete 1993–2016 reference is not available yet. '}
   {referenceError&&<>Reference download failed; retrying. </>}
   The ERA5 line will appear automatically when the complete reference loads.{' '}
   <a href="https://github.com/matthewhugo81-arch/stratoscope/actions/workflows/prepare-era5.yml" target="_blank" rel="noreferrer">Import progress ↗</a>
  </p>}
  <div className="seasonal-legend"><span className="forecast-key">Forecast mean</span><span className="member-key">Members</span>{climate&&<><span className="climate-key">Model climate mean</span><span className="band-key">Historical 25–75%, 10–90% & full range</span></>}{era&&<span className="era-key">ERA5 daily climate mean</span>}</div>
  <div className="seasonal-plot"><svg ref={plotRef} viewBox="0 0 960 350" role="img" aria-label={`${data.name} 60N 10hPa zonal wind ensemble${climate?' with 1993–2016 model climatology':''}${era?' and ERA5 climate mean':''}`} onPointerMove={inspect}>
   <text x={12} y={16} fill="#a4bfcc" fontSize={11}>m/s</text>
   {ticks.map(t=><g key={t}><line x1={58} x2={940} y1={y(t)} y2={y(t)} stroke={t===0?'#e9bd7e':'#293e4a'} strokeDasharray={t===0?'5 4':undefined}/><text x={47} y={y(t)+4} textAnchor="end" fill="#a4bfcc" fontSize={12}>{t>0?'+':''}{t}</text></g>)}
   {history&&climate&&<><path d={band(climateValues(climate.min),climateValues(climate.max))} fill="#e6a653" opacity={.07}/><path d={band(climateValues(climate.p10),climateValues(climate.p90))} fill="#e6a653" opacity={.12}/><path d={band(climateValues(climate.p25),climateValues(climate.p75))} fill="#e6a653" opacity={.22}/><path d={path(climateValues(climate.mean))} fill="none" stroke="#efb56e" strokeWidth={2}/></>}
   {members&&data.members.map(m=><path key={m.id} d={path(m.values)} fill="none" stroke="#599aae" strokeWidth={.7} opacity={.38}/>)}
   {reference&&eraValues&&<path d={path(eraValues)} fill="none" stroke="#edf2f4" strokeWidth={2} strokeDasharray="6 3"/>}
   <path d={path(data.mean)} fill="none" stroke="#b5efdd" strokeWidth={2.8}/>
   {Array.from({length:7},(_,i)=>Math.round(i*(n-1)/6)).map(i=><text key={i} x={x(i)} y={337} textAnchor={i===0?'start':i===n-1?'end':'middle'} fill="#a4bfcc" fontSize={11}>{new Date(data.dates[i]).toLocaleDateString('en-GB',{timeZone:'UTC',day:'numeric',month:'short'})}</text>)}
   <line x1={x(active)} x2={x(active)} y1={26} y2={310} stroke="#d4e8ed" opacity={.65}/><circle cx={x(active)} cy={y(data.mean[active])} r={4} fill="#b5efdd"/>
  </svg></div>
  <div className="seasonal-chart-options"><label><input type="checkbox" checked={members} onChange={e=>setMembers(e.target.checked)}/> Members</label>{climate&&<label><input type="checkbox" checked={history} onChange={e=>setHistory(e.target.checked)}/> Model climate</label>}{era&&<label><input type="checkbox" checked={reference} onChange={e=>setReference(e.target.checked)}/> ERA5 mean</label>}</div>
  <input className="glosea-slider" type="range" min={0} max={n-1} step={1} value={active} onChange={e=>setDay(Number(e.target.value))} aria-label="Seasonal wind valid date" aria-valuetext={`${date(data.dates[active])} ${data.dates[active].slice(11,16)} UTC`}/>
  <div className="seasonal-values" aria-live="polite"><strong>{date(data.dates[active])} · {data.dates[active].slice(11,16)} UTC</strong><span>Forecast mean <b>{signed(data.mean[active])} m/s</b></span>{climate&&<span>Model climate <b>{signed(climate.mean[indices[active]])} m/s</b></span>}{eraValues&&<span>ERA5 mean <b>{signed(eraValues[active])} m/s</b></span>}<span>{Math.round(data.easterlyFraction[active]*data.members.length)}/{data.members.length} members easterly</span></div>
  <p>Positive wind is westerly; negative is easterly. Raw seasonal model scenarios, without bias correction. The easterly member fraction is not a calibrated SSW probability. ERA5 daily climatology uses 1993–2016.</p>
  <details><summary>Sources & calculation</summary><p>{data.attribution}</p>{climate&&<p>{climate.method} {climate.sampleCount} historical member trajectories.</p>}{era&&<p>{era.method}</p>}<p>Each field is averaged around the full longitude circle; latitude rows are interpolated to 60°N when needed. Models retain their own ensemble sizes and issue dates. ERA5 uses calendar-day means from all 24 hours, averaged over 1993–2016.</p><a href="https://cds.climate.copernicus.eu/datasets/seasonal-original-pressure-levels" target="_blank" rel="noreferrer">C3S seasonal source data</a> · <a href="https://cds.climate.copernicus.eu/datasets/reanalysis-era5-pressure-levels" target="_blank" rel="noreferrer">ERA5 reference data</a></details>
 </div>;
}
