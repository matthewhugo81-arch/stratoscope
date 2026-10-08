'use client';
import {useEffect,useRef,useState} from 'react';
import {Orbit,RefreshCw,Layers,ChevronLeft,ChevronRight,Info,Repeat2,Pause,Images} from 'lucide-react';
import {Slider} from '@/components/ui/slider';
import {Switch} from '@/components/ui/switch';
import {Tabs,TabsList,TabsTrigger} from '@/components/ui/tabs';
import {RadioGroup,RadioGroupItem} from '@/components/ui/radio-group';
import {Select,SelectContent,SelectItem,SelectTrigger,SelectValue} from '@/components/ui/select';
import {PolarMap} from '@/components/polar-map';
import {ZonalWindCard} from '@/components/zonal-wind-card';
import {ForecastStamps} from '@/components/forecast-stamps';
import {GloSeaOutlook} from '@/components/glosea-outlook';
import {MemberPanels} from '@/components/member-panels';
import {NorthernComparison} from '@/components/northern-diagnostics';
import {VortexView} from '@/components/vortex-view';
import {MODELS,isModel,isCycle,isEnsemble,memberCount,supports,type ModelId,type ForecastMeta,type EnsembleView} from '@/lib/models';
import {loadForecast,peekForecast,clearForecastCache,activateForecastSequence} from '@/lib/forecast-client';
import {forecastMeta} from '@/lib/forecast-transport';
import {temperatureGradient,temperaturePosition,temperatureTicks} from '@/lib/temperature-scale';
import type {Frame} from '@/lib/grib';
const levels=[10,20,30,50,70,100];
const alt:Record<number,string>={10:'~31 km',20:'~26 km',30:'~24 km',50:'~21 km',70:'~18 km',100:'~16 km'};
const date=(v:string)=>new Date(v).toLocaleString('en-GB',{timeZone:'UTC',day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit',hour12:false}).replace(',','');
export default function Home(){
 const [model,setModel]=useState<ModelId>('gfs'),[meta,setMeta]=useState<ForecastMeta|null>(null),[level,setLevel]=useState(10),[hour,setHour]=useState(0),[field,setField]=useState('temperature'),[contours,setContours]=useState(true),[grid,setGrid]=useState(true),[rawFrame,setFrame]=useState<Frame|null>(null),[loading,setLoading]=useState(true),[error,setError]=useState(''),[refresh,setRefresh]=useState(0),[retryAt,setRetryAt]=useState(0),[attempt,setAttempt]=useState(0),[retryTick,setRetryTick]=useState(0);
 const [view,setView]=useState<EnsembleView>('mean'),[member,setMember]=useState(0),[progress,setProgress]=useState(0),[pair,setPair]=useState<{mean:Frame;spread:Frame}|null>(null);
 const [playing,setPlaying]=useState(false),[delay,setDelay]=useState(1000),[showStamps,setShowStamps]=useState(false),[zonalReady,setZonalReady]=useState(''),[,setCacheVersion]=useState(0);
 const direction=useRef(1);
 const [showMembers,setShowMembers]=useState(false);
 const config=MODELS[model],maxHour=config.maxHour,run=meta?.model===model?meta.run:'',cyclic=isCycle(model),ensemble=isEnsemble(model),count=ensemble?memberCount(model):0,selectionMember=ensemble&&view==='member'?member:-1;
 const prepared=ensemble&&selectionMember<0;
 const selected=peekForecast(model,run,hour,level,selectionMember);
 const currentPair=selected?.pair??pair,pairMatches=currentPair&&currentPair.mean.model===model&&currentPair.mean.run===run&&currentPair.mean.level===level&&currentPair.mean.hour===hour;
 const frame=ensemble&&view!=='member'&&pairMatches?currentPair[view]:selected?.frame??rawFrame,displaySpread=frame?.ensemble?.view==='spread';
 const absoluteTemperature=field==='temperature'&&!displaySpread;
 function chooseHour(value:number){setPlaying(false);direction.current=value<hour?-1:1;setHour(Math.max(0,Math.min(maxHour,value)));}
 function chooseModel(value:string){if(!isModel(value))return;setPlaying(false);setModel(value);if(!supports(value,level))setLevel(MODELS[value].levels[0]);setHour(h=>Math.min(h,MODELS[value].maxHour));if(isEnsemble(value))setMember(m=>Math.min(m,memberCount(value)-1));}
 function refreshData(){setPlaying(false);clearForecastCache(model);setRefresh(v=>v+1)}
 useEffect(()=>{activateForecastSequence(model,run,level,selectionMember);setCacheVersion(v=>v+1);setPlaying(false);},[model,run,level,selectionMember,refresh]);
 useEffect(()=>{setPlaying(false);},[view]);
 useEffect(()=>{const hidden=()=>{if(document.hidden)setPlaying(false);};document.addEventListener('visibilitychange',hidden);return()=>document.removeEventListener('visibilitychange',hidden);},[]);
 useEffect(()=>{
  const c=new AbortController();setMeta(null);setLoading(true);setError('');setRetryAt(0);
  forecastMeta(model,AbortSignal.any([c.signal,AbortSignal.timeout(55000)]),prepared).then(setMeta).catch(e=>{if(e.name!=='AbortError'){setError(e.name==='TimeoutError'?'Finding the latest forecast took too long. Please retry.':e.message);setLoading(false)}});
  return()=>c.abort();
 },[model,refresh,prepared]);
 useEffect(()=>{
  if(!run||!supports(model,level))return;const c=new AbortController();setError('');setRetryAt(0);setProgress(0);setLoading(true);
  let preload:ReturnType<typeof setTimeout>|undefined;
  const apply=(result:Awaited<ReturnType<typeof loadForecast>>)=>{
   if(c.signal.aborted)return;setFrame(result.frame);if(result.pair)setPair(result.pair);setLoading(false);
   // A single adjacent frame or prepared summary; no browser ensemble calculations.
   const adjacent=hour+direction.current*6;
   if(cyclic&&adjacent>=0&&adjacent<=maxHour)preload=setTimeout(()=>{
    const connection=(navigator as Navigator & {connection?:{saveData?:boolean;effectiveType?:string}}).connection;
    if(document.visibilityState!=='visible'||connection?.saveData||connection?.effectiveType?.includes('2g'))return;
    void loadForecast(model,run,adjacent,level,selectionMember,c.signal,()=>{}).then(()=>{if(!c.signal.aborted)setCacheVersion(v=>v+1)}).catch(()=>{});
   },120);
  };
  const cached=peekForecast(model,run,hour,level,selectionMember);
  if(cached)apply(cached);else void loadForecast(model,run,hour,level,selectionMember,c.signal,n=>{if(!c.signal.aborted)setProgress(n)}).then(apply).catch(e=>{if(!c.signal.aborted){if(e.retryAfter)setRetryAt(Date.now()+e.retryAfter*1000);setError(e.name==='TimeoutError'?'The model download took too long. Please retry.':e.message);setLoading(false)}});
  return()=>{clearTimeout(preload);c.abort()};
 },[run,model,hour,level,selectionMember,refresh,attempt]);
 useEffect(()=>{
  const step=(e:KeyboardEvent)=>{
   if(e.defaultPrevented||e.altKey||e.ctrlKey||e.metaKey||e.shiftKey||!['ArrowLeft','ArrowRight'].includes(e.key))return;
   const target=e.target instanceof Element?e.target:null;
   if(target?.closest('input,textarea,select,[contenteditable]:not([contenteditable="false"]),[role="slider"],[role="tablist"],[role="radiogroup"],[role="combobox"],[role="listbox"],[role="menu"],[role="dialog"]'))return;
   e.preventDefault();if(!e.repeat)chooseHour(hour+(e.key==='ArrowRight'?6:-6));
  };
  window.addEventListener('keydown',step);return()=>window.removeEventListener('keydown',step);
 },[maxHour,hour]);
 useEffect(()=>{
  const context=(document as Document & {modelContext?:{registerTool:(tool:unknown,options:{signal:AbortSignal})=>unknown}}).modelContext;
  if(!context?.registerTool)return;const lifecycle=new AbortController();
  const tool={name:'select_forecast',title:'Select a stratosphere forecast',description:'Select model, pressure, lead time, field and ensemble view. GEFS has 31 members and 16 days. ECMWF ENS and AIFS ENS have 51 members and 15 days at 10, 50 and 100 hPa. Member 0 is the control. Data loads after selection.',inputSchema:{type:'object',properties:{model:{type:'string',enum:Object.keys(MODELS).filter(isModel)},level:{type:'integer',enum:levels},hour:{type:'integer',minimum:0,maximum:384,multipleOf:6},field:{type:'string',enum:['temperature','wind']},view:{type:'string',enum:['mean','spread','member']},member:{type:'integer',minimum:0,maximum:50}},required:['level','hour','field'],additionalProperties:false},annotations:{readOnlyHint:false,untrustedContentHint:false},execute:async(input:unknown)=>{
   const v=input as {model?:string;level:number;hour:number;field:string;view?:EnsembleView;member?:number},m=v?.model??model;
   if(!v||!isModel(m)||!supports(m,v.level)||!Number.isInteger(v.hour)||v.hour<0||v.hour>MODELS[m].maxHour||v.hour%6||!['temperature','wind'].includes(v.field)||v.view&&!['mean','spread','member'].includes(v.view)||v.member!==undefined&&(!isEnsemble(m)||!Number.isInteger(v.member)||v.member<0||v.member>=memberCount(m)))throw Error('Unsupported model, level, hour, field or ensemble member.');
   setPlaying(false);setModel(m);setLevel(v.level);setHour(v.hour);setField(v.field);if(isEnsemble(m)){setView(v.view??'mean');setMember(v.member??0);}await new Promise<void>(resolve=>requestAnimationFrame(()=>resolve()));return {status:'selected',model:m,level:v.level,hour:v.hour,field:v.field,view:v.view??'mean',member:v.member??0};
  }};
  try{Promise.resolve(context.registerTool(tool,{signal:lifecycle.signal})).catch(()=>{})}catch{}return()=>lifecycle.abort();
 },[model]);
 const valid=run?new Date(Date.parse(run)+hour*3600000).toISOString():'';
 const matching=frame&&frame.hour===hour&&frame.level===level&&frame.run===run&&(frame.model??'gfs')===model&&(!ensemble||(frame.ensemble?.view===view&&(view!=='member'||frame.ensemble.member===member)));
 const zonalKey=`${model}/${run}/${hour}/${selectionMember}/${refresh}`;
 useEffect(()=>{
  if(error){setPlaying(false);return;}
  if(!playing||loading||!matching||zonalReady!==zonalKey)return;
  // Start the dwell time only after the displayed map and wind readout settle.
  const timer=setTimeout(()=>{direction.current=1;setHour(h=>h>=maxHour?0:h+6);},delay);
  return()=>clearTimeout(timer);
 },[playing,loading,matching,error,zonalReady,zonalKey,hour,maxHour,delay]);
 const times=Array.from({length:maxHour/6+1},(_,i)=>{const h=i*6,result=peekForecast(model,run,h,level,selectionMember);return {hour:h,frame:result?.pair&&view!=='member'?result.pair[view]:result?.frame};});
 const readyCount=times.filter(t=>t.frame).length;
 const previousName=frame&&isModel(frame.model??'gfs')?MODELS[(frame.model??'gfs') as ModelId].label:'';
 useEffect(()=>{if(!retryAt)return;const timer=setTimeout(()=>{setRetryAt(0);setAttempt(v=>v+1)},Math.max(0,retryAt-Date.now())),tick=setInterval(()=>setRetryTick(v=>v+1),1000);return()=>{clearTimeout(timer);clearInterval(tick)}},[retryAt]);
 const retrySeconds=retryTick>=0?Math.max(0,Math.ceil((retryAt-Date.now())/1000)):0;
 const initialLabel=model==='gfs'?'Analysis':cyclic?'Initial field':'Today · 00 UTC';
 const label=hour===0?initialLabel:`Forecast +${hour}h`;
 const ecSource=model==='ecmwf_direct'||model==='ifs_ens'||model==='aifs_ens',noaaSource=model==='gfs'||model==='gefs';
 const directAlternative=model==='ecmwf'?'ecmwf_direct':'gfs';
 const documentation=noaaSource?`https://www.nco.ncep.noaa.gov/pmb/products/${model==='gefs'?'gens':'gfs'}/`:ecSource?'https://www.ecmwf.int/en/forecasts/datasets/open-data':'https://opendata.dwd.de/weather/nwp/icon/';
 const method=ensemble?`Direct ${model==='gefs'?'0.5° NOAA GEFS':'0.25° ECMWF'} pressure-level fields, sampled every 1° without vertical interpolation. All ${count} members, including the control, contribute equally. Mean and population standard deviation are calculated at each grid point. Wind statistics use each member’s scalar wind speed. Mean and spread are prepared once per model run on GitHub, then delivered as compact files. Spread is model disagreement, not forecast error or a confidence interval. Height contours always show ensemble-mean height on mean and spread maps.`:model==='gfs'?'Direct GFS fields on a 1° grid from one model cycle.':model==='ecmwf_direct'?'Direct ECMWF IFS 0.25° fields from one completed 00 or 12 UTC run. Every fourth grid point is retained for a 1° display grid. These are native pressure-level fields, with no vertical interpolation.':'DWD ICON global pressure-level fields from one 00 or 12 UTC run. The native triangular grid is sampled to a 1° display grid using the nearest cell on the sphere. Temperature is converted to Celsius and geopotential to metres using standard gravity. No vertical interpolation is performed. The newest complete 180-hour run is checked hourly from the official DWD feed; the browser loads one compact file per time and level.';
 return <main className="atlas">
  <header className="topbar"><div className="brand"><Orbit size={31}/><span>stratoscope<span className="brand-mark"> / </span></span><span className="brand-sub">ATMOSPHERIC ATLAS</span></div><div className="hemisphere">NORTHERN HEMISPHERE <span>00°—90° N</span></div></header>
  <section className="workspace">
   <aside className="controls">
    <div className="eyebrow">THE STRATOSPHERE</div><h1>A view from <br/>above.</h1>
    <div className="model-control"><label className="section-label" id="model-label">Forecast model</label><Select value={model} onValueChange={chooseModel}><SelectTrigger aria-labelledby="model-label" className="model-trigger"><SelectValue/></SelectTrigger><SelectContent className="model-options">{Object.entries(MODELS).filter(([id])=>isModel(id)).map(([id,c])=><SelectItem key={id} value={id}>{c.label}</SelectItem>)}</SelectContent></Select><p className="model-note">{prepared?'Prepared mean & spread · newest complete run':config.note}</p></div>
    <div className="control-section"><span className="section-label"><Layers size={15}/> Pressure level <small>hPa</small></span>
     <RadioGroup className="level-list" aria-label="Pressure level" value={String(level)} onValueChange={v=>setLevel(Number(v))}>{levels.map(l=><label key={l} className={`level ${level===l?'selected':''} ${!supports(model,l)?'unavailable':''}`} title={!supports(model,l)?`Not available for ${config.label}`:undefined}><RadioGroupItem value={String(l)} disabled={!supports(model,l)} aria-label={`${l} hPa${!supports(model,l)?' unavailable':''}`} className="level-radio"/><span>{l}<small> hPa</small></span><span>{supports(model,l)?alt[l]:'—'}</span></label>)}</RadioGroup>
     <p className="muted footnote">{ecSource?'Direct ECMWF supplies 10, 50 and 100 hPa. Its open feed does not include 20, 30 or 70 hPa.':model==='ecmwf'?'Open-Meteo ECMWF supplies 50 and 100 hPa. Select ECMWF IFS · direct for 10 hPa.':noaaSource?'Lower pressure, higher altitude. Altitudes are approximate.':'DWD’s public ICON pressure-level feed supplies 30, 50, 70 and 100 hPa. Use NOAA or ECMWF for 10 hPa.'}</p>
    </div>
    <div className="control-section overlay-controls"><span className="section-label">Map layers</span><label className="toggle-row">Height contours <Switch checked={contours} onCheckedChange={setContours} aria-label="Height contours"/></label><label className="toggle-row">Latitude & longitude <Switch checked={grid} onCheckedChange={setGrid} aria-label="Latitude and longitude"/></label></div>
    <div className="source-card"><span className="source-label">DATA SOURCE</span><strong>{config.resolution}</strong><span className="muted">{config.provider}</span><div className="run-meta">{run?`${cyclic?'Run: ':'Timeline: '}${date(run)} UTC`:'Finding latest forecast'}</div>{!cyclic&&<span className="rolling-note">Rolling forecast, not a fixed model run</span>}<button className="text-button" onClick={refreshData}><RefreshCw size={13}/> Refresh data</button></div>
   </aside>
   <div className="plot-area">
    {ensemble&&<div className="ensemble-panel"><div className="ensemble-topline"><span className="eyebrow">ENSEMBLE EXPLORER</span><span>{count} members · control included</span></div><div className="ensemble-actions"><Tabs value={view} onValueChange={v=>setView(v as EnsembleView)}><TabsList className="field-tabs ensemble-tabs" aria-label="Ensemble view" aria-describedby="ensemble-description"><TabsTrigger value="mean" title={`Average of all ${count} members, including the control`}>Mean</TabsTrigger><TabsTrigger value="spread" title="One standard deviation: warmer colours show more disagreement">Spread</TabsTrigger><TabsTrigger value="member" title="View the control or an individual perturbed forecast">Member</TabsTrigger></TabsList></Tabs><button className="all-members-button" disabled={!run} onClick={()=>{setPlaying(false);setShowMembers(true)}}>All members</button>{view==='member'&&<Select value={String(member)} onValueChange={v=>setMember(Number(v))}><SelectTrigger aria-label="Ensemble member" className="member-trigger"><SelectValue/></SelectTrigger><SelectContent className="model-options">{Array.from({length:count},(_,i)=><SelectItem value={String(i)} key={i}>{i===0?'Control':`Member ${String(i).padStart(2,'0')}`}</SelectItem>)}</SelectContent></Select>}</div><p id="ensemble-description" className="ensemble-description">{view==='spread'?'One standard deviation · warmer colours show more disagreement.':view==='mean'?`Average of all ${count} members · a view of the shared pattern.`:member===0?'The unperturbed control forecast.':`One possible forecast scenario · perturbed member ${member}.`}</p></div>}
    <div className="map-shell"><div className="plot-heading"><div><span className="eyebrow">INTERACTIVE 3D GLOBE</span><h2>{level} hPa <span>/ {field==='temperature'?'Temperature':'Wind speed'}{ensemble&&view==='spread'?' spread':''}</span></h2></div><Tabs value={field} onValueChange={setField}><TabsList className="field-tabs"><TabsTrigger value="temperature">Temperature</TabsTrigger><TabsTrigger value="wind">Wind</TabsTrigger></TabsList></Tabs></div><PolarMap frame={frame} field={field} contours={contours} graticule={grid}/>{loading&&<div className="map-status" role="status"><RefreshCw size={14} className="spin"/> Loading {config.label} · {level} hPa{ensemble&&view!=='member'?' · prepared ensemble map':model==='icon'?' · prepared DWD map':model!=='gfs'?' · first download may take a moment':''}</div>}{error&&<div className="map-error" role="alert"><strong>{retryAt?'Download paused':'Forecast unavailable'}</strong><span>{error}</span>{retryAt?<span>Resuming in {retrySeconds} seconds</span>:<button onClick={refreshData}>Try again</button>}{!cyclic&&<button onClick={()=>chooseModel(directAlternative)}>Use {directAlternative==='gfs'?'direct NOAA GFS':'direct ECMWF IFS'} — independent of Open-Meteo’s quota</button>}</div>}{frame&&!matching&&<div className="previous-label">Previous plot: {previousName}{frame.ensemble?` · ${frame.ensemble.view}${frame.ensemble.view==='member'?` ${frame.ensemble.member}`:''}`:''} · {frame.level} hPa · {date(frame.valid)} UTC</div>}</div>
    <div className="legend"><div><span>{field==='temperature'?'TEMPERATURE':'WIND SPEED'}{displaySpread?' SPREAD (1σ)':''}</span><span>{field==='temperature'?'°C':'m/s'}</span></div><div className={`color-ramp ${absoluteTemperature?'':'wind-ramp'}`} style={absoluteTemperature?{background:temperatureGradient}:undefined}/><div className={`legend-ticks ${absoluteTemperature?'temperature-ticks':''}`}>{(displaySpread?(field==='temperature'?[0,2.5,5,7.5,10,12.5,15]:[0,5,10,15,20,25,30]):absoluteTemperature?temperatureTicks:[0,20,40,60,80,100,120]).map(v=><span key={v} style={absoluteTemperature?{left:`${temperaturePosition(v)}%`}:undefined}>{absoluteTemperature&&v>0?'+':''}{v}{displaySpread&&v===(field==='temperature'?15:30)?'+':''}</span>)}</div>{displaySpread&&<p className="spread-note">Higher spread = less agreement · contours show mean height</p>}</div>
   </div>
   <aside className="readout"><div className="eyebrow">VALID AT</div><h3>{valid?new Date(valid).toLocaleDateString('en-GB',{timeZone:'UTC',day:'numeric',month:'long'}):'—'}</h3><div className="valid-hour">{valid?valid.slice(11,16):'—'} <span>UTC</span></div><span className="forecast-badge">{label}</span><ZonalWindCard model={model} run={run} hour={hour} member={selectionMember} mapLevel={level} mapFrame={frame} mapBusy={loading} mapError={error} mapProgress={progress} refresh={refresh} onReady={setZonalReady}/><div className="readout-rule"/><div className="contour-key"><span/> {frame?.ensemble&&frame.ensemble.view!=='member'?'Mean geopotential height':'Geopotential height'}</div><p className="muted">Contours every 400 m, labelled in decametres (dam).</p><p className="muted">Only the Northern Hemisphere has weather data. The unshaded south is outside this viewer’s coverage.</p><details><summary><Info size={14}/> Data & method</summary><p>{config.provider}. {method}</p>{ecSource&&<p>Contains modified ECMWF forecast data (2026), supplied under CC BY 4.0. The display samples and converts the original fields; ECMWF does not endorse this viewer.</p>}{model==='icon'&&<p>Contains modified Deutscher Wetterdienst data (2026), supplied under CC BY 4.0. The native grid is sampled and units converted for display.</p>}{model==='ecmwf'&&<p>Open-Meteo ECMWF IFS 0.25° supplies 50 and 100 hPa. Select the direct ECMWF source for 10 hPa.</p>}{ensemble&&<p>Mean and spread use complete statistics prepared from all {count} members, including the control, once per model run. Your browser downloads one compact file per forecast time. Both views share that file. Preparation checks hourly for the newest complete run; the run timestamp identifies the data shown. Missing summaries never trigger individual-member downloads.</p>}{model==='ifs_ens'&&<p>The IFS control comes from ECMWF’s oper/fc feed, which has supplied the ENS control since Cycle 50r1.</p>}<p>The timeline uses six-hour steps{cyclic?', measured from the model initialization time. The initial field is forecast hour zero.':', measured from today at 00 UTC, not from a model initialisation time. Open-Meteo timelines are cached for up to 30 minutes.'}</p><p>Globe lighting gives depth; use the pointer values for precise numbers. ← / → step through forecast times. With the globe focused, Shift + arrows rotate, +/− zoom and Home restores the north-pole view.</p><p>The polar-vortex wind indicator averages the signed eastward wind component (u) around the complete 60°N latitude circle at 10 hPa. Positive is westerly; negative is easterly. It uses every longitude on the downloaded source grid before display sampling; older cached frames are explicitly labelled as display-grid estimates. Ensemble Mean and Spread views both show the ensemble-mean zonal wind, while Member shows that member. It follows the selected forecast time and stays at 10 hPa when the map level changes.</p><p>This is an instantaneous model field, not a daily mean or an SSW event declaration. An easterly value is a reversal signal to monitor; formal major-warming identification also depends on winter timing and event criteria. <a href="https://www.ncei.noaa.gov/access/metadata/landing-page/bin/iso?id=gov.noaa.ncdc:C00960" target="_blank" rel="noreferrer">NOAA SSW reference</a></p><p>Model forecasts are not observations. Coastlines: Natural Earth.</p><a href={documentation} target="_blank" rel="noreferrer">{noaaSource?'NOAA documentation':ecSource?'ECMWF data & licence':'DWD data & documentation'}</a>{frame?.preparedAt&&<p>Forecast prepared {date(frame.preparedAt)} UTC.</p>}{frame?.fetchedAt&&<p>Map downloaded {date(frame.fetchedAt)} UTC.</p>}</details></aside>
  </section>
  <section className="timeline" aria-label="Forecast timeline" aria-keyshortcuts="ArrowLeft ArrowRight">
   <div className="timeline-title"><span className="eyebrow">FORECAST TIMELINE</span><strong>{hour===0?initialLabel:`+${hour} hours`}<span> / {maxHour/24} days</span></strong><span className="keyboard-hint">← / → step 6 hours</span></div>
   <div className="timeline-actions"><div className="step-buttons"><button aria-label="Previous forecast" title="Previous forecast (←)" disabled={hour===0} onClick={()=>chooseHour(hour-6)}><ChevronLeft size={20}/></button><button aria-label="Next forecast" title="Next forecast (→)" disabled={hour===maxHour} onClick={()=>chooseHour(hour+6)}><ChevronRight size={20}/></button></div>
    <button className={`loop-button ${playing?'active':''}`} aria-label={playing?'Pause forecast loop':'Play forecast loop'} aria-pressed={playing} disabled={!run||!!error} onClick={()=>{direction.current=1;setPlaying(v=>!v)}} title="Play every six-hour frame, waiting for each download. Repeats from memory once loaded.">{playing?<Pause size={16}/>:<Repeat2 size={17}/>}<span>{playing?'Pause':'Loop'}</span></button>
    <select className="playback-speed" aria-label="Playback speed" value={delay} onChange={e=>setDelay(Number(e.target.value))}><option value={2000}>0.5×</option><option value={1000}>1×</option><option value={500}>2×</option></select>
    <button className="stamps-toggle" aria-label={showStamps?'Hide frame previews':'Show frame previews'} aria-expanded={showStamps} aria-controls="forecast-stamps" onClick={()=>setShowStamps(v=>!v)} title="Show downloaded forecast thumbnails"><Images size={17}/><span>Frames</span></button>
   </div>
   <div className="timeline-track"><Slider aria-label="Forecast hour" value={[hour]} min={0} max={maxHour} step={6} onValueChange={v=>chooseHour(v[0])}/><div className="day-ticks">{Array.from({length:maxHour/24+1},(_,i)=><button key={i} onClick={()=>chooseHour(i*24)} className={hour===i*24?'active':''}>{i===0?(cyclic?'Run':'00Z'):`+${i}d`}</button>)}</div>
    <div className="playback-status" role="status" title="Downloaded frames are saved in this browser when storage is available, including across model changes and reloads. One run per model is retained. Refresh data clears that model’s saved frames.">{error?'Paused after download error':playing?(loading||!matching?'Buffering':zonalReady!==zonalKey?'Waiting for 10 hPa wind':readyCount===times.length?'Looping from memory':'Playing & loading'):loading?'Loading selected frame':'Ready'} · {readyCount}/{times.length} frames in memory · local run cache{ensemble&&view!=='member'&&readyCount<times.length?' · prepared ensemble maps':''}</div>
   </div>
  </section>
  {showStamps&&<ForecastStamps times={times} hour={hour} run={run} field={field} onSelect={chooseHour}/>}
  <NorthernComparison/>
  <VortexView/>
  <GloSeaOutlook/>
  {ensemble&&showMembers&&run&&<MemberPanels model={model} run={run} hour={hour} field={field} onClose={()=>setShowMembers(false)} onInspect={(m,h,f)=>{setField(f);setShowMembers(false);setLevel(10);setView('member');setMember(m);chooseHour(h)}}/>}

  <footer><span>STRATOSCOPE <b> / </b> NORTHERN HEMISPHERE</span><span>{noaaSource?'NOAA / NCEP':ecSource?<a href="https://www.ecmwf.int/en/forecasts/datasets/open-data" target="_blank" rel="noreferrer">ECMWF · CC BY 4.0</a>:<a href="https://www.dwd.de/EN/service/legal_notice/legal_notice_node.html" target="_blank" rel="noreferrer">DWD · CC BY 4.0</a>} <i>·</i> All times UTC</span></footer>
 </main>
}

