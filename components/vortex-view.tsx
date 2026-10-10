'use client';
import {useEffect,useMemo,useRef,useState} from 'react';
import {vortexCatalogue,loadVortex,type VortexGeometry,type VortexCatalogue} from '@/lib/vortex';
import {projectVortexPoint,vortexScreenOrigin} from '@/lib/vortex-projection';
import {heightAnomalyColour,sampleHeightAnomaly} from '@/lib/vortex-context';
import {HeatFluxChart} from './heat-flux-chart';
import {SaveImageButton} from './save-image-button';
import {imageFilename,utcStamp,type ChartImage} from '@/lib/chart-export';

const stamp=(v:string)=>new Date(v).toLocaleString('en-GB',{timeZone:'UTC',day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit',hour12:false});
function VortexCanvas({data,expanded}:{data:VortexGeometry;expanded:boolean}){
 const [showBase,setShowBase]=useState(true),[opacity,setOpacity]=useState(.65);
 const texture=useMemo(()=>{
  if(!data.baseMap)return null;
  const c=document.createElement('canvas'),n=1024,r=n/2;c.width=n;c.height=n;const ctx=c.getContext('2d')!,pixels=ctx.createImageData(n,n);
  for(let y=0;y<n;y++)for(let x=0;x<n;x++){const east=(x+.5-r)/r,south=(y+.5-r)/r,radius=Math.hypot(east,south);if(radius>1)continue;const lon=Math.atan2(east,south)*180/Math.PI,lat=90-radius*60,colour=heightAnomalyColour(sampleHeightAnomaly(data.baseMap,lon,lat));pixels.data.set(colour,(y*n+x)*4);}
  ctx.putImageData(pixels,0,0);return c;
 },[data.baseMap]);
 const canvas=useRef<HTMLCanvasElement>(null),view=useRef({yaw:.6,tilt:.55,zoom:1}),paint=useRef(()=>{}),coast=useRef<number[][][]>([]),pointers=useRef(new Map<number,{x:number;y:number}>()),[size,setSize]=useState({w:1000,h:530}),raf=useRef(0);
 const request=()=>{cancelAnimationFrame(raf.current);raf.current=requestAnimationFrame(()=>paint.current())};
 paint.current=()=>{
  const c=canvas.current,ctx=c?.getContext('2d');if(!ctx||!c)return;const dpr=Math.min(devicePixelRatio||1,2);ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,size.w,size.h);
  const {yaw,tilt,zoom}=view.current,scale=Math.min(size.w*.34,size.h*.35)*zoom;
  // Move every layer together; retain zoom and stationary controls.
  const origin=vortexScreenOrigin(size.w,size.h,expanded);
  const project=(lon:number,lat:number,z:number)=>{const p=projectVortexPoint(lon,lat,z,yaw,tilt);return{x:origin.x+p.x*scale,y:origin.y+p.y*scale}};
  const line=(a:{x:number;y:number},b:{x:number;y:number})=>{ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y)};
  // The geographic context plane sits below 400 K; it is not a theta level.
  const baseZ=-.14;
  if(showBase&&texture){const centre=project(0,90,baseZ),r=texture.width/2;ctx.save();ctx.globalAlpha=opacity;ctx.translate(centre.x,centre.y);ctx.transform(Math.cos(yaw)*scale/r,-Math.sin(yaw)*Math.sin(tilt)*scale/r,Math.sin(yaw)*scale/r,Math.cos(yaw)*Math.sin(tilt)*scale/r,0,0);ctx.drawImage(texture,-r,-r);ctx.restore();}
  ctx.strokeStyle='#789ca448';ctx.lineWidth=.8;ctx.beginPath();
  for(const lat of [30,60,70,80])for(let lon=0;lon<360;lon+=3)line(project(lon,lat,baseZ),project(lon+3,lat,baseZ));
  for(let lon=0;lon<360;lon+=30)line(project(lon,90,baseZ),project(lon,30,baseZ));ctx.stroke();
  ctx.strokeStyle='#a1bac89c';ctx.beginPath();for(const points of coast.current)for(let i=1;i<points.length;i++){const a=points[i-1],b=points[i];if(a[1]>=30&&b[1]>=30)line(project(a[0],a[1],baseZ),project(b[0],b[1],baseZ));}ctx.stroke();
  // Keep the theta scale beside the map, clear of the controls as the view rotates.
  const axisLon=90-yaw*180/Math.PI;ctx.strokeStyle='#93b2c5';ctx.beginPath();line(project(axisLon,30,0),project(axisLon,30,1.4));ctx.stroke();ctx.font='12px monospace';ctx.fillStyle='#bad0dc';
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
 useEffect(()=>{request()},[data,size,texture,showBase,opacity,expanded]);
 function reset(){view.current={yaw:.6,tilt:.55,zoom:1};request()}
 const imageSpec=():ChartImage=>({
  title:'GEFS 3D PV structure',filename:imageFilename('GEFS-3D-PV',data.run,'f'+data.hour),
  subtitle:['Run '+utcStamp(data.run),`Forecast +${data.hour}h · Valid ${utcStamp(new Date(Date.parse(data.run)+data.hour*3600000).toISOString())}`,`31-member mean-field PV · current rotation and tilt · zoom ${view.current.zoom.toFixed(2)}×`],
  plots:[{element:canvas.current,backdrop:'vortex'}],
  legend:[400,600,800,1000,1200].map(n=>({label:n+' K potential temperature',colour:`hsl(${185-(n-400)/800*150} 80% ${58+(n-400)/800*8}%)`})),
  gradients:showBase&&data.baseMap?[{title:`500 hPa height anomaly · m · opacity ${Math.round(opacity*100)}%`,stops:Array.from({length:61},(_,i)=>({at:i/60,colour:(()=>{const c=heightAnomalyColour(-300+i*10);return `rgba(${c[0]},${c[1]},${c[2]},${c[3]/255})`})()})),ticks:[-300,-150,0,150,300].map(v=>({at:(v+300)/600,label:(v>0?'+':'')+v}))}]:[],
  notes:['Source: NOAA GEFS · 31-member mean. Fixed-area PV structure diagnostic, not a formally diagnosed vortex edge. Vertical spacing represents potential temperature, not physical altitude.',...(showBase&&data.baseMap?['Base: GEFS mean 500 hPa height minus NCEP/NCAR Reanalysis 1 daily mean, 1991–2020. Same run and valid time as the PV structure.']:['500 hPa anomaly overlay not shown.'])]
 });
 return <><div className="vortex-view-controls"><button className="seasonal-refresh" onClick={reset}>Fit & reset view</button><button className="seasonal-refresh" onClick={()=>{view.current.zoom=Math.min(2.5,view.current.zoom*1.15);request()}}>Zoom +</button><button className="seasonal-refresh" onClick={()=>{view.current.zoom=Math.max(.5,view.current.zoom/1.15);request()}}>Zoom −</button><SaveImageButton label="3D PV view" getImage={imageSpec} beforeSave={()=>paint.current()}/><span>Drag to rotate & tilt · wheel or pinch to zoom</span><div className="vortex-base-controls"><label><input type="checkbox" checked={showBase} onChange={e=>setShowBase(e.target.checked)}/>500 hPa anomalies</label><label>Opacity<input aria-label="500 hPa anomaly opacity" type="range" min="15" max="100" step="5" value={Math.round(opacity*100)} disabled={!showBase} onChange={e=>setOpacity(Number(e.target.value)/100)}/></label></div></div>{showBase&&<div className="vortex-base-legend" aria-label="500 hPa height anomaly legend">{data.baseMap?<><strong>500 hPa height anomaly · m</strong><div className="vortex-base-gradient"/><div className="vortex-base-ticks"><span>−300</span><span>−150</span><span>0</span><span>+150</span><span>+300</span></div><small>GEFS mean − NCEP/NCAR daily average, 1991–2020</small></>:<span>500 hPa base map preparing for this forecast time</span>}</div>}<canvas ref={canvas} className="vortex-canvas" role="img" aria-label={`GEFS 3D potential-vorticity contour structure${showBase&&data.baseMap?' with 500 hPa height anomalies':''}`} tabIndex={0}
  onKeyDown={e=>{if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','+','-','Home'].includes(e.key)){e.preventDefault();e.stopPropagation();if(e.key==='Home')reset();else if(e.key==='+'||e.key==='-')view.current.zoom=Math.max(.5,Math.min(2.5,view.current.zoom*(e.key==='+'?1.15:1/1.15)));else{view.current.yaw+=(e.key==='ArrowLeft'?-.1:e.key==='ArrowRight'?.1:0);view.current.tilt=Math.max(.1,Math.min(1.4,view.current.tilt+(e.key==='ArrowUp'?.1:e.key==='ArrowDown'?-.1:0)));}request();}}}
  onPointerDown={e=>{e.currentTarget.setPointerCapture(e.pointerId);pointers.current.set(e.pointerId,{x:e.clientX,y:e.clientY});}}
  onPointerMove={e=>{const old=pointers.current.get(e.pointerId);if(!old)return;const other=[...pointers.current.entries()].find(([id])=>id!==e.pointerId)?.[1];if(other){const before=Math.hypot(old.x-other.x,old.y-other.y),after=Math.hypot(e.clientX-other.x,e.clientY-other.y);if(before>5)view.current.zoom=Math.max(.5,Math.min(2.5,view.current.zoom*after/before));}else{view.current.yaw+=(e.clientX-old.x)*.008;view.current.tilt=Math.max(.1,Math.min(1.4,view.current.tilt-(e.clientY-old.y)*.007));}pointers.current.set(e.pointerId,{x:e.clientX,y:e.clientY});request();}}
  onPointerUp={e=>pointers.current.delete(e.pointerId)} onPointerCancel={e=>pointers.current.delete(e.pointerId)}/></>;
}
export function VortexView(){
 const section=useRef<HTMLElement>(null),fullButton=useRef<HTMLButtonElement>(null),[expanded,setExpanded]=useState(false);
 useEffect(()=>{const change=()=>setExpanded(document.fullscreenElement===section.current);document.addEventListener('fullscreenchange',change);return()=>document.removeEventListener('fullscreenchange',change)},[]);
 useEffect(()=>{if(!expanded)return;const overflow=document.body.style.overflow;document.body.style.overflow='hidden';const key=(e:KeyboardEvent)=>{if(e.key==='Escape'&&!document.fullscreenElement)setExpanded(false)};document.addEventListener('keydown',key);return()=>{document.body.style.overflow=overflow;document.removeEventListener('keydown',key);fullButton.current?.focus({preventScroll:true})}},[expanded]);
 async function fullscreen(){if(expanded){if(document.fullscreenElement)await document.exitFullscreen();setExpanded(false)}else{setExpanded(true);try{await section.current?.requestFullscreen()}catch{/* Keep the full-window view when browser fullscreen is unavailable. */}}}
 const [open,setOpen]=useState(false),[catalogue,setCatalogue]=useState<VortexCatalogue|null>(null),[run,setRun]=useState(''),[hour,setHour]=useState(0),[data,setData]=useState<VortexGeometry|null>(null),[loading,setLoading]=useState(false),[error,setError]=useState(''),[refresh,setRefresh]=useState(0),[playing,setPlaying]=useState(false);
 const times=catalogue?Object.keys(catalogue.files).map(Number).sort((a,b)=>a-b):[0];
 useEffect(()=>{
  if(!open)return;const c=new AbortController();let timer:ReturnType<typeof setTimeout>;setRun('');setData(null);setError('');setLoading(true);setPlaying(false);
    const check=async()=>{try{const m=await vortexCatalogue(AbortSignal.any([c.signal,AbortSignal.timeout(30000)]));if(c.signal.aborted)return;setCatalogue(m);setRun(m.run);setHour(h=>m.files[String(h)]?h:0);if(!m.timelineComplete||!m.contextComplete||!m.heatFlux)timer=setTimeout(check,60000);}catch(e){if(!c.signal.aborted){setError((e as Error).message);setLoading(false);timer=setTimeout(check,60000);}}};void check();return()=>{c.abort();clearTimeout(timer)};
 },[open,refresh]);
 useEffect(()=>{
  if(!open||!run)return;const c=new AbortController();setLoading(true);setError('');
  const p=catalogue?loadVortex(catalogue,hour,c.signal):Promise.reject(Error('Awaiting GEFS geometry'));
  void p.then(d=>{if(!c.signal.aborted){setData(d);setLoading(false)}}).catch(e=>{if(!c.signal.aborted){setError(e.message);setLoading(false);setPlaying(false)}});return()=>c.abort();
 },[open,run,hour,catalogue?.files[String(hour)]?.sha256,refresh]);
 useEffect(()=>{if(!playing||loading||!data)return;const timer=setTimeout(()=>{const i=times.indexOf(hour);setHour(times[(i+1)%times.length]);},1100);return()=>clearTimeout(timer)},[playing,loading,data,hour,times.join(',')]);
 const changeHour=(h:number)=>{setPlaying(false);setHour(h)};
 return <div className="glosea-section"><button className="glosea-toggle" onClick={()=>{setOpen(v=>!v);setPlaying(false)}} aria-expanded={open} aria-controls="vortex-3d">{open?'Hide':'Show'} 3D vortex structure <span>GEFS · 31-member mean</span></button>{open&&<section ref={section} id="vortex-3d" className={`glosea-outlook vortex-outlook${expanded?' vortex-expanded':''}`} aria-label="3D vortex structure"><div className="vortex-heading"><h2>GEFS 3D PV structure</h2><button ref={fullButton} className="seasonal-refresh vortex-fullscreen" onClick={()=>void fullscreen()} aria-pressed={expanded}>{expanded?'Exit full screen':'Full screen'}</button>
  <p className="vortex-stamp">{run?`Run ${stamp(data?.run||run)} UTC · forecast +${data?.hour??hour}h · valid ${stamp(new Date(Date.parse(data?.run||run)+(data?.hour??hour)*3600000).toISOString())} UTC`:''}</p></div>
  <div className="vortex-stage">{data?<VortexCanvas data={data} expanded={expanded}/>:<div className="vortex-pending" role="status">{loading?'Loading complete forecast geometry…':error}</div>}</div><div className="vortex-load-status" role="status" title={error}>{error|| (loading?`Loading forecast +${hour}h… Previous complete view remains visible.`:catalogue?`Ready · ${times.length}/33 complete forecast times prepared${catalogue.timelineComplete?'':' · preparation continues'}`:'')}</div>
  <div className="vortex-timeline"><button className="seasonal-refresh" disabled={loading||times.indexOf(hour)<=0} onClick={()=>changeHour(times[times.indexOf(hour)-1])}>← Previous</button><button className="seasonal-refresh" disabled={!data||times.length<2} onClick={()=>setPlaying(v=>!v)}>{playing?'Pause':'Loop'}</button><button className="seasonal-refresh" disabled={loading||times.indexOf(hour)>=times.length-1} onClick={()=>changeHour(times[times.indexOf(hour)+1])}>Next →</button><label>Forecast time<select aria-label="3D forecast time" value={hour} onChange={e=>changeHour(Number(e.target.value))}>{times.map(h=><option key={h} value={h}>{h===0?'Initial field':`+${h} hours`}</option>)}</select></label><button className="seasonal-refresh" onClick={()=>{setPlaying(false);setRefresh(v=>v+1)}}>Refresh 3D data</button></div>
  <details className="vortex-heat"><summary>Heat flux · 100 hPa</summary><HeatFluxChart catalogue={catalogue} hour={data?.hour??hour} displayedRun={data?.run||run} onSelect={changeHour}/></details>
  <details className="vortex-method"><summary>Data, method & controls</summary><p>Potential vorticity estimated from complete 31-member mean temperature and winds on 13 pressure levels (200–1 hPa), sampled at 1°. Contours at 400–1200 K enclose a high-PV area equivalent to 70°N. This is a fixed-area structure diagnostic, not a formally diagnosed vortex edge. PV of ensemble-mean fields differs from ensemble-mean PV; averaging can soften or hide member-specific splits.</p><p>{catalogue?`${times.length}/33 complete forecast times prepared${catalogue.timelineComplete?'':'; remaining times appear as preparation completes'}. Every displayed time uses all 31 members.`:''} Colours run from cyan at 400 K to orange at 1200 K. Vertical spacing represents potential temperature, not physical altitude.</p>
  <p>The optional base map shows the complete 31-member GEFS 500 hPa mean height minus the NCEP/NCAR Reanalysis 1 calendar-day mean for 1991–2020, in metres. Orange/red indicates above-average heights; blue/purple indicates below-average heights. The fixed scale saturates at ±300 m. Each map uses the same run and valid time as the vortex. The stored 2.5° daily reference is bilinearly interpolated to the 1° forecast display grid; February 29 uses the average of February 28 and March 1. It is a daily-mean reference, without forecast-bias correction.</p><p>The base plane is geographical context, not a potential-temperature surface or a physical vertical separation. Height anomalies help locate ridges and troughs; they do not measure upward wave activity or prove a causal influence on the vortex.</p>
  <p>Heat flux is calculated separately for all 31 members at 100 hPa on the 1° sampled grid. At each latitude, northward wind and temperature departures from their instantaneous zonal means are multiplied and averaged over longitude. Latitude-cell areas clipped to 45–75°N supply the spherical weights. The plotted mean is then averaged over members; shading shows the 10th–90th member percentiles, not a confidence interval. It includes all resolved zonal waves and uses 12-hourly forecast samples, with no time smoothing or historical baseline. The marker follows the displayed vortex frame, including while a new frame loads.</p>
  <p>3D time controls are independent of the main globe. Downloaded geometry is cached; playback waits for each complete frame. Drag to rotate and tilt, scroll or pinch to zoom. With the view focused, arrow keys rotate, +/− zoom and Home resets.</p><a href="https://registry.opendata.aws/noaa-gefs/" target="_blank" rel="noreferrer">GEFS source ↗</a>{' · '}<a href="https://psl.noaa.gov/data/gridded/data.ncep.reanalysis.html" target="_blank" rel="noreferrer">Daily climatology source ↗</a>{' · '}<a href="https://mdtf-diagnostics.readthedocs.io/en/main/sphinx_pods/stc_eddy_heat_fluxes.html" target="_blank" rel="noreferrer">Heat-flux interpretation ↗</a></details>
 </section>}</div>;
}
