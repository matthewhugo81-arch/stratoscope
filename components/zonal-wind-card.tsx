'use client';
import {useEffect,useState} from 'react';
import {RefreshCw} from 'lucide-react';
import {SaveImageButton} from './save-image-button';
import {imageFilename,utcStamp,type ChartImage} from '@/lib/chart-export';

import type {Frame} from '@/lib/grib';
import {MODELS,isEnsemble,memberCount,supports,type ModelId} from '@/lib/models';
import {loadForecast,peekForecast,peekForecastZonal} from '@/lib/forecast-client';
import {frameZonalWind,matchesZonalFrame,windDisplay} from '@/lib/zonal-wind';

type Props={model:ModelId;run:string;hour:number;member:number;mapLevel:number;mapFrame:Frame|null;mapBusy:boolean;mapError:string;mapProgress:number;refresh:number;onReady?:(key:string)=>void};
export function ZonalWindCard({model,run,hour,member,mapLevel,mapFrame,mapBusy,mapError,mapProgress,refresh,onReady}:Props){
 const [loaded,setLoaded]=useState<{key:string;frame:Frame}|null>(null),[failure,setFailure]=useState<{key:string;message:string}|null>(null),[progress,setProgress]=useState(0),[attempt,setAttempt]=useState(0);
 const available=supports(model,10),ensemble=isEnsemble(model),key=`${model}/${run}/${hour}/${member}/${refresh}`;
 const direct=matchesZonalFrame(mapFrame,model,run,hour,member)?mapFrame:null;
 const candidate=direct??(loaded?.key===key&&matchesZonalFrame(loaded.frame,model,run,hour,member)?loaded.frame:null);
 useEffect(()=>{
  if(!available||!run||mapLevel===10||peekForecastZonal(model,run,hour,member))return;
  const c=new AbortController();setFailure(null);setProgress(0);
  const cached=peekForecast(model,run,hour,10,member);
  if(cached){setLoaded({key,frame:cached.frame});return;}
  // Let the selected map finish first. At 10 hPa the map supplies this value
  // directly; other map levels reuse the same cache and two-member limit.
  if(mapBusy)return;
  void loadForecast(model,run,hour,10,member,c.signal,n=>{if(!c.signal.aborted)setProgress(n)}).then(result=>{if(!c.signal.aborted)setLoaded({key,frame:result.frame});}).catch(error=>{if(!c.signal.aborted)setFailure({key,message:error.name==='TimeoutError'?'The 10 hPa download timed out.':error.message});});
  return()=>c.abort();
 },[available,run,model,hour,member,mapLevel,mapBusy,key,attempt]);
 let diagnostic=peekForecastZonal(model,run,hour,member)??null,issue=mapLevel===10?mapError:failure?.key===key?failure.message:'';
 if(candidate)try{diagnostic=frameZonalWind(candidate);}catch(error){issue=error instanceof Error?error.message:'The latitude circle is incomplete.';}
 const settled=!available||!!diagnostic||!!issue;
 useEffect(()=>{if(settled)onReady?.(key);},[settled,key,onReady]);
 const presentation=diagnostic?windDisplay(diagnostic.value):null;
 const description=ensemble?(member<0?`Ensemble mean · ${memberCount(model)} members`:member===0?'Control member':`Member ${String(member).padStart(2,'0')}`):'Zonal-mean u wind';
 const valid=run?new Date(Date.parse(run)+hour*3600000).toISOString():'';
 const stamp=valid?new Date(valid).toLocaleString('en-GB',{timeZone:'UTC',day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit',hour12:false}).replace(',',''):'';
 const imageSpec=():ChartImage=>({title:MODELS[model].label+' · 60°N, 10 hPa zonal wind',filename:imageFilename(model,'zonal-wind',run,'f'+hour,member<0?'mean':'member-'+member),subtitle:['Run '+utcStamp(run),`Forecast +${hour}h · Valid ${utcStamp(valid)}`,description],plots:[],readout:{value:(presentation?.text??'—')+' m/s',label:presentation?.direction??'Unavailable'},notes:[`${diagnostic?.longitudeStep}° ${diagnostic?.basis==='native'?'source':'display'} grid · all longitudes`,'Positive is westerly; negative is easterly. An instantaneous signed u-wind diagnostic, not a daily mean or a confirmed SSW.','Source: '+MODELS[model].label+' · Stratoscope']});
 return <section className="zonal-card" aria-label="60°N 10 hPa zonal wind">
  <div className="chart-export-heading"><div className="eyebrow">POLAR VORTEX WIND</div><SaveImageButton label="zonal wind readout" getImage={imageSpec} disabled={!diagnostic||!presentation||mapBusy}/></div><h4>60°N <span>·</span> 10 hPa</h4>
  {!available?<p className="zonal-unavailable">10 hPa is unavailable from this source. Choose direct GFS, direct ECMWF or an ensemble.</p>:<>
   <div className="zonal-reading" aria-live="polite" aria-atomic="true">
    {diagnostic&&presentation?<><output aria-label="Zonal-mean u wind" className={`zonal-value ${presentation.tone}`}>{presentation.text}<small> m/s</small></output><span className={`zonal-direction ${presentation.tone}`}>{presentation.direction}</span></>:issue?<><span className="zonal-empty">—</span><span className="zonal-unavailable" title={issue}>Wind value unavailable</span>{mapLevel!==10&&<button className="text-button" onClick={()=>setAttempt(n=>n+1)}>Retry 10 hPa wind</button>}</>:<span className="zonal-loading"><RefreshCw size={13} className="spin"/>{!run?'Finding model run…':mapBusy&&mapLevel!==10?'Waiting for map…':ensemble&&member<0?'Loading prepared 10 hPa wind…':'Loading 10 hPa…'}</span>}
   </div>
   <p className="zonal-context">{description}<br/>{hour===0?'Initial field':`Forecast +${hour}h`}{stamp&&<> · {stamp} UTC</>}</p>
   {diagnostic&&<p className="zonal-sampling">{diagnostic.longitudeStep}° {diagnostic.basis==='native'?'source':'display'} grid · all longitudes</p>}
  </>}
  <p className="zonal-note">+ westerly <span> / </span> − easterly<br/>Zero marks the change of direction.</p>
 </section>;
}
