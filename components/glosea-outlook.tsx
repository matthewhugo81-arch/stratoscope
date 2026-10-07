'use client';
import {useEffect,useState} from 'react';
import {fetchGloSea,GLOSEA_SOURCE,type GloSea} from '@/lib/glosea';
const date=(s:string)=>new Date(s).toLocaleDateString('en-GB',{timeZone:'UTC',day:'numeric',month:'short',year:'numeric'});
export function GloSeaChart({data}:{data:GloSea}){
 const [day,setDay]=useState(0),[members,setMembers]=useState(true);
 const all=data.members.flatMap(m=>m.values),min=Math.floor(Math.min(-10,...all)/20)*20,max=Math.ceil(Math.max(10,...all)/20)*20;
 const x=(i:number)=>58+i/179*882,y=(v:number)=>26+(max-v)/(max-min)*234;
 const path=(values:number[])=>values.map((v,i)=>`${i?'L':'M'}${x(i).toFixed(2)},${y(v).toFixed(2)}`).join(' ');
 const ticks=Array.from({length:(max-min)/20+1},(_,i)=>min+i*20);
 const stale=Date.now()-Date.parse(data.nominal)>45*86400000;
 return <section className="glosea-outlook" aria-label="GloSea seasonal wind outlook">
  <div className="glosea-heading"><div><span className="eyebrow">UK MET OFFICE · SEASONAL OUTLOOK</span><h2>GloSea <span>/ 60°N · 10 hPa wind</span></h2></div><span className="forecast-badge">Monthly issue · {date(data.nominal)}{stale?' · Older issue':''}</span></div>
  <p>50 members from 25 start dates · 00 UTC samples · signed u wind, m/s</p>
  <div className="glosea-chart"><svg viewBox="0 0 960 310" role="img" aria-label="GloSea seasonal zonal wind ensemble, individual members and ensemble mean. Zero separates westerly and easterly winds.">
   {ticks.map(t=><g key={t}><line x1={58} x2={940} y1={y(t)} y2={y(t)} stroke={t===0?'#f6c187':'#293e4a'} strokeDasharray={t===0?'5 4':undefined}/><text x={47} y={y(t)+4} textAnchor="end" fill="#a4bfcc" fontSize={12}>{t>0?'+':''}{t}</text></g>)}
   {members&&data.members.map(m=><path key={m.id} d={path(m.values)} fill="none" stroke="#599aae" strokeWidth={.7} opacity={.35}/>)}
   <path d={path(data.mean)} fill="none" stroke="#b5efdd" strokeWidth={2.8}/>
   {[0,29,59,89,119,149,179].map(i=><text key={i} x={x(i)} y={288} textAnchor={i===0?'start':i===179?'end':'middle'} fill="#a4bfcc" fontSize={11}>{new Date(data.dates[i]).toLocaleDateString('en-GB',{timeZone:'UTC',day:'numeric',month:'short'})}</text>)}
   <line x1={x(day)} x2={x(day)} y1={26} y2={260} stroke="#d4e8ed" opacity={.7}/><circle cx={x(day)} cy={y(data.mean[day])} r={4} fill="#b5efdd"/>
  </svg></div>
  <div className="glosea-inspector"><label><input type="checkbox" checked={members} onChange={e=>setMembers(e.target.checked)}/> Show individual members</label><output aria-live="polite">{date(data.dates[day])} · Mean {data.mean[day]>0?'+':''}{data.mean[day].toFixed(1)} m/s · {Math.round(data.easterlyFraction[day]*50)}/50 members easterly</output></div>
  <input className="glosea-slider" type="range" min={0} max={179} step={1} value={day} onChange={e=>setDay(Number(e.target.value))} aria-label="Seasonal wind valid date" aria-valuetext={date(data.dates[day])}/>
  <p className="glosea-note">Pale green: ensemble mean. Amber dashed line: zero. These are seasonal model scenarios, not observations. The easterly member count is not a calibrated SSW probability; raw values are not bias-corrected.</p>
  <details><summary>GloSea data & method</summary><p>{data.method}</p><p>{data.attribution}</p><p>Prepared {date(data.preparedAt)}. Members are aligned by calendar date, despite their different initialisation dates. This outlook is independent of the map’s selected model and forecast time.</p><a href={GLOSEA_SOURCE} target="_blank" rel="noreferrer">Copernicus dataset & licence</a></details>
 </section>;
}
export function GloSeaOutlook(){
 const [data,setData]=useState<GloSea|null>(null),[open,setOpen]=useState(false);
 useEffect(()=>{const c=new AbortController();void fetchGloSea(AbortSignal.any([c.signal,AbortSignal.timeout(15000)])).then(d=>{if(!c.signal.aborted)setData(d)}).catch(()=>{});return()=>c.abort()},[]);
 // Do not offer a forecast until an entire real ensemble has been published.
 if(!data)return null;
 return <div className="glosea-section"><button className="glosea-toggle" onClick={()=>setOpen(v=>!v)} aria-expanded={open} aria-controls="glosea-chart">{open?'Hide':'Show'} GloSea seasonal wind outlook <span>60°N · 10 hPa</span></button>{open&&<div id="glosea-chart"><GloSeaChart data={data}/></div>}</div>;
}
