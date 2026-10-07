import type {Frame} from './grib';
import {isEnsemble,type ForecastMeta,type ModelId} from './models';
import {iconMeta,iconFrame} from './dwd';
import {preparedMeta} from './prepared-ensembles';
declare const __STRATOSCOPE_STATIC__:boolean;
const browserData=typeof __STRATOSCOPE_STATIC__!=='undefined'&&__STRATOSCOPE_STATIC__;
export async function forecastRequest(query:string,signal:AbortSignal):Promise<Frame|ForecastMeta>{
 const q=new URLSearchParams(query);if(q.get('model')==='icon')return q.get('meta')==='1'?iconMeta(signal):iconFrame(q.get('run')??'',Number(q.get('hour')),Number(q.get('level')),signal);
 if(browserData){const {requestWeather}=await import('./weather-client');return requestWeather(query,signal);}
 const r=await fetch(`/api/forecast?${query}`,{signal}),j=await r.json() as (Frame|ForecastMeta)&{error?:string;retryAfter?:number};
 if(!r.ok)throw Object.assign(Error(j.error??'Forecast unavailable'),{retryAfter:j.retryAfter});return j;
}
const metadata=new Map<string,{at:number;value:ForecastMeta}>();
export function clearForecastMeta(model:ModelId){for(const key of metadata.keys())if(key.startsWith(model+'/'))metadata.delete(key)}
export async function forecastMeta(model:ModelId,signal:AbortSignal,summary=true){
 signal.throwIfAborted();const key=model+'/'+summary,hit=metadata.get(key);
 if(hit&&Date.now()-hit.at<300000)return hit.value;
 const value=await (isEnsemble(model)&&summary?preparedMeta(model,signal):forecastRequest(`meta=1&model=${model}`,signal) as Promise<ForecastMeta>);
 signal.throwIfAborted();metadata.set(key,{at:Date.now(),value});return value;
}
