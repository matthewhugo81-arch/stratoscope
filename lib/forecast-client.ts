import type {Frame} from './grib';
import {isCycle,isEnsemble,memberCount,type ModelId} from './models';
import {ensembleStatistics} from './ensemble-statistics';
import {sharedDownloads} from './shared-download';
const frames=new Map<string,{at:number;frame:Frame}>(),statistics=new Map<string,{at:number;mean:Frame;spread:Frame}>();
const downloads=sharedDownloads<Frame>();
const lifetime=(model:ModelId)=>isCycle(model)?6*3600000:900000;
function cached<T extends {at:number}>(cache:Map<string,T>,key:string,model:ModelId){const hit=cache.get(key);if(!hit)return;if(Date.now()-hit.at>=lifetime(model)){cache.delete(key);return;}cache.delete(key);cache.set(key,hit);return hit;}
export function clearForecastCache(model:ModelId){downloads.clear(model+'/');for(const cache of [frames,statistics])for(const key of cache.keys())if(key.startsWith(model+'/'))cache.delete(key);}
export function peekForecast(model:ModelId,run:string,hour:number,level:number,member:number){
 const id=`${model}/${run}/${level}/${hour}`;
 if(isEnsemble(model)&&member<0){const pair=cached(statistics,id,model);return pair?{frame:pair.mean,pair}:undefined;}
 const hit=cached(frames,`${id}/${member}`,model);return hit?{frame:hit.frame}:undefined;
}
export class ForecastError extends Error{constructor(message:string,public retryAfter?:number){super(message)}}
export async function loadForecast(model:ModelId,run:string,hour:number,level:number,member:number,signal:AbortSignal,progress:(count:number)=>void){
 const id=`${model}/${run}/${level}/${hour}`;
 async function one(m:number){
  signal.throwIfAborted();const k=`${id}/${m}`,hit=cached(frames,k,model);if(hit)return hit.frame;
  return downloads.get(k,signal,async downloadSignal=>{
  const r=await fetch(`/api/forecast?model=${model}&run=${encodeURIComponent(run)}&hour=${hour}&level=${level}&member=${Math.max(0,m)}&diagnostics=u60-v1`,{signal:AbortSignal.any([downloadSignal,AbortSignal.timeout(180000)])}),j=await r.json() as Frame & {error?:string;retryAfter?:number};downloadSignal.throwIfAborted();
  if(!r.ok)throw new ForecastError(j.error??'Forecast unavailable',j.retryAfter);if(j.model!==model||j.run!==run||j.hour!==hour||j.level!==level)throw Error('Received a different forecast than requested');
  frames.set(k,{at:Date.now(),frame:j});if(frames.size>24)frames.delete(frames.keys().next().value!);return j;
  });
 }
 if(!isEnsemble(model)||member>=0)return {frame:await one(member)};
 const hit=cached(statistics,id,model);if(hit)return {frame:hit.mean,pair:hit};
 const count=memberCount(model),accumulator=ensembleStatistics(count);let next=0,complete=0,failed=false;
 // At most two upstream member downloads at once. No partial statistics are plotted.
 async function worker(){while(next<count&&!failed){const m=next++;try{const f=await one(m);signal.throwIfAborted();if(failed)return;accumulator.add(f);progress(++complete);}catch(e){failed=true;throw e;}}}
 await Promise.all([worker(),worker()]);signal.throwIfAborted();const pair=accumulator.finish();statistics.set(id,{at:Date.now(),...pair});if(statistics.size>6)statistics.delete(statistics.keys().next().value!);
 return {frame:pair.mean,pair};
}
