import type {Frame} from './grib';
import {isEnsemble,type ForecastMeta,type ModelId} from './models';
import {preparedMeta} from './prepared-ensembles';
declare const __STRATOSCOPE_STATIC__:boolean;
const browserData=typeof __STRATOSCOPE_STATIC__!=='undefined'&&__STRATOSCOPE_STATIC__;
export async function forecastRequest(query:string,signal:AbortSignal):Promise<Frame|ForecastMeta>{
 if(browserData){const {requestWeather}=await import('./weather-client');return requestWeather(query,signal);}
 const r=await fetch(`/api/forecast?${query}`,{signal}),j=await r.json() as (Frame|ForecastMeta)&{error?:string;retryAfter?:number};
 if(!r.ok)throw Object.assign(Error(j.error??'Forecast unavailable'),{retryAfter:j.retryAfter});return j;
}
export function forecastMeta(model:ModelId,signal:AbortSignal,summary=true){return isEnsemble(model)&&summary?preparedMeta(model,signal):forecastRequest(`meta=1&model=${model}`,signal) as Promise<ForecastMeta>;}
