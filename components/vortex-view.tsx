'use client';
import {useEffect,useRef,useState} from 'react';
import {vortexCatalogue,loadVortex,type VortexGeometry,type VortexCatalogue} from '@/lib/vortex';
import {projectVortexPoint} from '@/lib/vortex-projection';
const stamp=(v:string)=>new Date(v).toLocaleString('en-GB',{timeZone:'UTC',day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit',hour12:false});
function VortexCanvas({data}:{data:VortexGeometry}){
 const canvas=useRef<HTMLCanvasElement>(null),view=useRef({yaw:.6,tilt:.55,zoom:1}),paint=useRef(()=>{}),coast=useRef<number[][][]>([]),pointers=useRef(new Map<number,{x:number;y:number}>()),[size,setSize]=useState({w:1000,h:530}),raf=useRef(0);
 const request=()=>{cancelAnimationFrame(raf.current);raf.current=requestAnimationFrame(()=>paint.current())};
 paint.current=()=>{
  const c=canvas.current,ctx=c?.getContext('2d');if(!ctx||!c)return;const dpr=Math.min(devicePixelRatio||1,2);ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,size.w,size.h);
  const {yaw,tilt,zoom}=view.current,scale=Math.min(size.w*.34,size.h*.35)*zoom;
  const project=(lon:number,lat:number,z:number)=>{const p=projectVortexPoint(lon,lat,z,yaw,tilt);return{x:size.w/2+p.x*scale,y:size.h*.52+p.y*scale}};
  const line=(a:{x:number;y:number},b:{x:number;y:number})=>{ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y)};
  ctx.strokeStyle='#789ca448';ctx.lineWidth=.8;ctx.beginPath();
  for(const lat of [30,60,70,80])for(let lon=0;lon<360;lon+=3)line(project(lon,lat,0),project(lon+3,lat,0));
  for(let lon=0;lon<360;lon+=30)line(project(lon,90,0),project(lon,30,0));ctx.stroke();
  ctx.strokeStyle='#a1bac875';ctx.beginPath();for(const points of coast.current)for(let i=1;i<points.length;i++){const a=points[i-1],b=points[i];if(a[1]>=30&&b[1]>=30)line(project(a[0],a[1],0),project(b[0],b[1],0));}ctx.stroke();
  const axisLon=135;ctx.strokeStyle='#93b2c5';ctx.beginPath();line(project(axisLon,30,0),project(axisLon,30,1.4));ctx.stroke();ctx.font='12px monospace';ctx.fillStyle='#bad0dc';
  const ticks=[400,600,800,1000,1200];
  for(const n of ticks){const z=(n-400)/800*1.4,p=project(axisLon,30,z);ctx.fillText(String(n)+' K',p.x+7,p.y+4);}
  for(const l of data.layers){const z=l.theta!==undefined?(l.theta-400)/800*1.4:Math.log(100/l.pressure!)/Math.log(10)*1.4,f=z/1.4;ctx.strokeStyle=`hsl(${185-f*150} 80% ${58+f*8}%)`;ctx.globalAlpha=l.theta!==undefined&&l.theta%100!==0?.58:.95;ctx.lineWidth=l.theta!==undefined?(l.theta%100===0?1.5:.85):2.3;ctx.beginPath();for(const s of l.segments)line(project(s[0],s[1],z),project(s[2],s[3],z));ctx.stroke();}
  ctx.globalAlpha=1;ctx.fillStyle='#c5d8e2';ctx.fillText('Northern Hemisphere · 30–90°N',16,size.h-18);
 };
 useEffect(()=>{
  const c=canvas.current!;const observer=new ResizeObserver(([entry])=>{const w=entry.contentRect.width,h=entry.contentRect.height,dpr=Math.min(devicePixelRatio||1,2);c.width=Math.round(w*dpr);c.height=Math.round(h*dpr);setSize({w,h});});observer.observe(c);
  const wheel=(e:WheelEvent)=>{e.preventDefault();view.current.zoom=Math.max(.5,Math.min(2.5,view.current.zoom*Math.exp(-Math.max(-150,Math.min(150,e.deltaY))*.0015)));request()};c.addEventListener('wheel',wheel,{passive:false});
  fetch(new URL('coastline.json',document.baseURI)).then(r=>r.json() as Promise<{features:{geometry:{type:string;coordinates:number[][]|number[][][]}}[]}>).then(j=>{coast.current=j.features.flatMap((f:{geometry:{type:string;coordinates:number[][]|number[][][]}})=>f.geometry.type==='LineString'?[f.geometry.coordinates as number[][]]:f.geometry.coordinates as number[][][]);request()}).catch(()=>{});
  return()=>{observer.disconnect();c.removeEventListener('wheel',wheel);cancelAnimationFrame(raf.current)};
 },[]);
 useEffect(()=>{request()},[data,size]);
 function reset(){view.current={yaw:.6,tilt:.55,zoom:1};request()}
 return <><div className="vortex-view-controls"><button className="seasonal-refresh" onClick={reset}>Fit & reset view</button><button className="seasonal-refresh" onClick={()=>{view.current.zoom=Math.min(2.5,view.current.zoom*1.15);request()}}>Zoom +</button><button className="seasonal-refresh" onClick={()=>{view.current.zoom=Math.max(.5,view.current.zoom/1.15);request()}}>Zoom −</button><span>Drag to rotate & tilt · wheel or pinch to zoom</span></div><canvas ref={canvas} className="vortex-canvas" role="img" aria-label="GEFS 3D potential-vorticity contour structure" tabIndex={0}
  onKeyDown={e=>{if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','+','-','Home'].includes(e.key)){e.preventDefault();e.stopPropagation();if(e.key==='Home')reset();else if(e.key==='+'||e.key==='-')view.current.zoom=Math.max(.5,Math.min(2.5,view.current.zoom*(e.key==='+'?1.15:1/1.15)));else{view.current.yaw+=(e.key==='ArrowLeft'?-.1:e.key==='ArrowRight'?.1:0);view.current.tilt=Math.max(.1,Math.min(1.4,view.current.tilt+(e.key==='ArrowUp'?.1:e.key==='ArrowDown'?-.1:0)));}request();}}}
  onPointerDown={e=>{e.currentTarget.setPointerCapture(e.pointerId);pointers.current.set(e.pointerId,{x:e.clientX,y:e.clientY});}}
  onPointerMove={e=>{const old=pointers.current.get(e.pointerId);if(!old)return;const other=[...pointers.current.entries()].find(([id])=>id!==e.pointerId)?.[1];if(other){const before=Math.hypot(old.x-other.x,old.y-other.y),after=Math.hypot(e.clientX-other.x,e.clientY-other.y);if(before>5)view.current.zoom=Math.max(.5,Math.min(2.5,view.current.zoom*after/before));}else{view.current.yaw+=(e.clientX-old.x)*.008;view.current.tilt=Math.max(.1,Math.min(1.4,view.current.tilt-(e.clientY-old.y)*.007));}pointers.current.set(e.pointerId,{x:e.clientX,y:e.clientY});request();}}
  onPointerUp={e=>pointers.current.delete(e.pointerId)} onPointerCancel={e=>pointers.current.delete(e.pointerId)}/></>;
}
export function VortexView(){
 const [open,setOpen]=useState(false),[catalogue,setCatalogue]=useState<VortexCatalogue|null>(null),[run,setRun]=useState(''),[hour,setHour]=useState(0),[data,setData]=useState<VortexGeometry|null>(null),[loading,setLoading]=useState(false),[error,setError]=useState(''),[refresh,setRefresh]=useState(0),[playing,setPlaying]=useState(false);
 const times=catalogue?Object.keys(catalogue.files).map(Number).sort((a,b)=>a-b):[0];
 useEffect(()=>{
  if(!open)return;const c=new AbortController();let timer:ReturnType<typeof setTimeout>;setRun('');setData(null);setError('');setLoading(true);setPlaying(false);
  const check=async()=>{try{const m=await vortexCatalogue(AbortSignal.any([c.signal,AbortSignal.timeout(30000)]));if(c.signal.aborted)return;setCatalogue(m);setRun(m.run);setHour(h=>m.files[String(h)]?h:0);if(!m.timelineComplete)timer=setTimeout(check,60000);}catch(e){if(!c.signal.aborted){setError((e as Error).message);setLoading(false);timer=setTimeout(check,60000);}}};void check();return()=>{c.abort();clearTimeout(timer)};
 },[open,refresh]);
 useEffect(()=>{
  if(!open||!run)return;const c=new AbortController();setLoading(true);setError('');
  const p=catalogue?loadVortex(catalogue,hour,c.signal):Promise.reject(Error('Awaiting GEFS geometry'));
  void p.then(d=>{if(!c.signal.aborted){setData(d);setLoading(false)}}).catch(e=>{if(!c.signal.aborted){setError(e.message);setLoading(false);setPlaying(false)}});return()=>c.abort();
 },[open,run,hour,catalogue?.files[String(hour)]?.sha256,refresh]);
 useEffect(()=>{if(!playing||loading||!data)return;const timer=setTimeout(()=>{const i=times.indexOf(hour);setHour(times[(i+1)%times.length]);},1100);return()=>clearTimeout(timer)},[playing,loading,data,hour,times.join(',')]);
 const changeHour=(h:number)=>{setPlaying(false);setHour(h)};
 return <div className="glosea-section"><button className="glosea-toggle" onClick={()=>{setOpen(v=>!v);setPlaying(false)}} aria-expanded={open} aria-controls="vortex-3d">{open?'Hide':'Show'} 3D vortex structure <span>GEFS · 31-member mean</span></button>{open&&<section id="vortex-3d" className="glosea-outlook" aria-label="3D vortex structure"><div className="glosea-heading"><div><span className="eyebrow">STRATOSCOPE · VORTEX STRUCTURE</span><h2>GEFS 3D PV structure</h2></div></div>
  <p className="vortex-stamp">{run?`Run ${stamp(data?.run||run)} UTC · forecast +${data?.hour??hour}h · valid ${stamp(new Date(Date.parse(data?.run||run)+(data?.hour??hour)*3600000).toISOString())} UTC`:''}</p>
  <div className="vortex-stage">{data?<VortexCanvas data={data}/>:<div className="vortex-pending" role="status">{loading?'Loading complete forecast geometry…':error}</div>}</div>{loading&&data&&<p role="status">Loading forecast +{hour}h… Previous complete view remains visible.</p>}{error&&data&&<p role="status">{error}</p>}
  <div className="vortex-timeline"><button className="seasonal-refresh" disabled={loading||times.indexOf(hour)<=0} onClick={()=>changeHour(times[times.indexOf(hour)-1])}>← Previous</button><button className="seasonal-refresh" disabled={!data||times.length<2} onClick={()=>setPlaying(v=>!v)}>{playing?'Pause':'Loop'}</button><button className="seasonal-refresh" disabled={loading||times.indexOf(hour)>=times.length-1} onClick={()=>changeHour(times[times.indexOf(hour)+1])}>Next →</button><label>Forecast time<select aria-label="3D forecast time" value={hour} onChange={e=>changeHour(Number(e.target.value))}>{times.map(h=><option key={h} value={h}>{h===0?'Initial field':`+${h} hours`}</option>)}</select></label><button className="seasonal-refresh" onClick={()=>{setPlaying(false);setRefresh(v=>v+1)}}>Refresh 3D data</button></div>
  <><p>Potential vorticity estimated from complete 31-member mean temperature and winds on 13 pressure levels (200–1 hPa), sampled at 1°. Contours at 400–1200 K enclose a high-PV area equivalent to 70°N. This is a fixed-area structure diagnostic, not a formally diagnosed vortex edge. PV of ensemble-mean fields differs from ensemble-mean PV; averaging can soften or hide member-specific splits.</p><p>{catalogue?`${times.length}/33 complete forecast times prepared${catalogue.timelineComplete?'':'; remaining times appear as preparation completes'}. Every displayed time uses all 31 members.`:''} Colours run from cyan at 400 K to orange at 1200 K. Vertical spacing represents potential temperature, not physical altitude.</p></>
  <p>3D time controls are independent of the main globe. Downloaded geometry is cached; playback waits for each complete frame. Drag to rotate and tilt, scroll or pinch to zoom. With the view focused, arrow keys rotate, +/− zoom and Home resets.</p><a href="https://registry.opendata.aws/noaa-gefs/" target="_blank" rel="noreferrer">Official data source ↗</a>
 </section>}</div>;
}
