import {forecastRequest} from './forecast-transport';
import type {Frame} from './grib';
import {MODELS,isCycle,isEnsemble,memberCount,type ModelId} from './models';
import {frameZonalWind,type ZonalWind} from './zonal-wind';
import {ensembleStatistics} from './ensemble-statistics';
import {sharedDownloads} from './shared-download';
const frames=new Map<string,{at:number;frame:Frame}>(),statistics=new Map<string,{at:number;mean:Frame;spread:Frame}>();
const downloads=sharedDownloads<Frame>();
export type ForecastResult={frame:Frame;pair?:{mean:Frame;spread:Frame}};
type Sequence={model:ModelId;run:string;level:number;member:number;results:Map<string,{at:number;result:ForecastResult}>};
let sequence:Sequence|undefined;
const diagnostics=new Map<string,{at:number;value:ZonalWind}>();
const diagnosticKey=(model:ModelId,run:string,hour:number,member:number)=>`${model}/${run}/${hour}/${member}`;
// Keep one complete selected sequence (at most 65 six-hour frames), without
// pinning the raw ensemble members. Changing selection releases the old sequence.
export function activateForecastSequence(model:ModelId,run:string,level:number,member:number){
 if(sequence?.model===model&&sequence.run===run&&sequence.level===level&&sequence.member===member)return;
 sequence={model,run,level,member,results:new Map()};diagnostics.clear();
}
function inSequence(model:ModelId,run:string,level:number,member:number){return sequence?.model===model&&sequence.run===run&&sequence.level===level&&sequence.member===member;}
function retain(model:ModelId,run:string,hour:number,level:number,member:number,result:ForecastResult,at:number){
 if(inSequence(model,run,level,member)&&hour>=0&&hour<=MODELS[model].maxHour&&hour%6===0)sequence!.results.set(String(hour),{at,result});
 if(level===10&&sequence?.model===model&&sequence.run===run&&sequence.member===member){
  try{diagnostics.set(diagnosticKey(model,run,hour,member),{at,value:frameZonalWind(result.frame)});if(diagnostics.size>65)diagnostics.delete(diagnostics.keys().next().value!);}catch{/* The wind card reports incomplete diagnostics. */}
 }
 return result;
}
const lifetime=(model:ModelId)=>isCycle(model)?6*3600000:900000;
function cached<T extends {at:number}>(cache:Map<string,T>,key:string,model:ModelId){const hit=cache.get(key);if(!hit)return;if(Date.now()-hit.at>=lifetime(model)){cache.delete(key);return;}cache.delete(key);cache.set(key,hit);return hit;}
export function clearForecastCache(model:ModelId){downloads.clear(model+'/');for(const cache of [frames,statistics,diagnostics])for(const key of cache.keys())if(key.startsWith(model+'/'))cache.delete(key);if(sequence?.model===model)sequence.results.clear();}
export function peekForecastZonal(model:ModelId,run:string,hour:number,member:number){return cached(diagnostics,diagnosticKey(model,run,hour,member),model)?.value;}
export function peekForecast(model:ModelId,run:string,hour:number,level:number,member:number):ForecastResult|undefined{
 if(inSequence(model,run,level,member)){const held=cached(sequence!.results,String(hour),model);if(held)return held.result;}
 const id=`${model}/${run}/${level}/${hour}`;
 if(isEnsemble(model)&&member<0){const pair=cached(statistics,id,model);return pair?retain(model,run,hour,level,member,{frame:pair.mean,pair},pair.at):undefined;}
 const hit=cached(frames,`${id}/${member}`,model);return hit?retain(model,run,hour,level,member,{frame:hit.frame},hit.at):undefined;
}
export class ForecastError extends Error{constructor(message:string,public retryAfter?:number){super(message)}}
export async function loadForecast(model:ModelId,run:string,hour:number,level:number,member:number,signal:AbortSignal,progress:(count:number)=>void):Promise<ForecastResult>{
 signal.throwIfAborted();const ready=peekForecast(model,run,hour,level,member);if(ready)return ready;
 const id=`${model}/${run}/${level}/${hour}`;
 async function one(m:number){
  signal.throwIfAborted();const k=`${id}/${m}`,hit=cached(frames,k,model);if(hit)return hit.frame;
  return downloads.get(k,signal,async downloadSignal=>{
  const j=await forecastRequest(`model=${model}&run=${encodeURIComponent(run)}&hour=${hour}&level=${level}&member=${Math.max(0,m)}&diagnostics=u60-v1`,AbortSignal.any([downloadSignal,AbortSignal.timeout(180000)])) as Frame;downloadSignal.throwIfAborted();
  if(j.model!==model||j.run!==run||j.hour!==hour||j.level!==level)throw Error('Received a different forecast than requested');
  frames.set(k,{at:Date.now(),frame:j});if(frames.size>24)frames.delete(frames.keys().next().value!);return j;
  });
 }
 if(!isEnsemble(model)||member>=0){const frame=await one(member);signal.throwIfAborted();return retain(model,run,hour,level,member,{frame},Date.now());}
 const hit=cached(statistics,id,model);if(hit)return {frame:hit.mean,pair:hit};
 const count=memberCount(model),accumulator=ensembleStatistics(count);let next=0,complete=0,failed=false;
 // At most two upstream member downloads at once. No partial statistics are plotted.
 async function worker(){while(next<count&&!failed){const m=next++;try{const f=await one(m);signal.throwIfAborted();if(failed)return;accumulator.add(f);progress(++complete);}catch(e){failed=true;throw e;}}}
 await Promise.all([worker(),worker()]);signal.throwIfAborted();const pair=accumulator.finish();statistics.set(id,{at:Date.now(),...pair});if(statistics.size>6)statistics.delete(statistics.keys().next().value!);
 return retain(model,run,hour,level,member,{frame:pair.mean,pair},Date.now());
}
