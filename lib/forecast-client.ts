import {forecastRequest,forecastMeta,clearForecastMeta,forecastFrameRevision} from './forecast-transport';
import type {Frame} from './grib';
import {isCycle,isEnsemble,memberCount,type ModelId} from './models';
import {frameZonalWind,type ZonalWind} from './zonal-wind';
import {preparedPair,clearPreparedManifest} from './prepared-ensembles';
import {clearIconManifest} from './dwd';
import {sharedDownloads} from './shared-download';
import {hasForecastStorage,readStoredForecast,writeStoredForecast,clearStoredForecast} from './forecast-storage';
import {createForecastMemory} from './forecast-memory';
export type ForecastResult={frame:Frame;pair?:{mean:Frame;spread:Frame};revision?:string};
const memory=createForecastMemory(),downloads=sharedDownloads<ForecastResult>();
type Sequence={model:ModelId;run:string;level:number;member:number};
let sequence:Sequence|undefined;
const diagnostics=new Map<string,{at:number;value:ZonalWind;revision?:string}>();
const diagnosticKey=(model:ModelId,run:string,hour:number,member:number)=>`${model}/${run}/${hour}/${member}`;
const frameKey=(model:ModelId,run:string,hour:number,level:number,member:number)=>`${model}/${run}/${level}/${hour}/${member}`;
const lifetime=(model:ModelId)=>isCycle(model)?6*3600000:900000;
function inSequence(frame:Frame,member:number){return !!sequence&&sequence.model===frame.model&&sequence.run===frame.run&&sequence.level===frame.level&&sequence.member===member;}
// There is one decoded cache. The selected timeline shares its byte budget with
// auxiliary diagnostics and other selections; it never pins a whole large run.
function trimGeneral(){
 let frames=0,pairs=0;
 for(const [key,entry] of Array.from(memory.entries()).reverse()){
  const member=Number(key.slice(key.lastIndexOf('/')+1));
  if(inSequence(entry.result.frame,member))continue;
  if(entry.result.pair?++pairs>6:++frames>24)memory.delete(key);
 }
}
export function activateForecastSequence(model:ModelId,run:string,level:number,member:number){
 if(sequence?.model===model&&sequence.run===run&&sequence.level===level&&sequence.member===member)return;
 sequence={model,run,level,member};diagnostics.clear();memory.focus('');trimGeneral();
}
export function focusForecast(model:ModelId,run:string,hour:number,level:number,member:number){memory.focus(frameKey(model,run,hour,level,member));}
export function forecastCacheUsage(){return {bytes:memory.bytes,maxBytes:memory.maxBytes,frames:memory.size};}
function retain(model:ModelId,run:string,hour:number,level:number,member:number,result:ForecastResult,at:number){
 if(level===10&&sequence?.model===model&&sequence.run===run&&sequence.member===member){
  try{diagnostics.set(diagnosticKey(model,run,hour,member),{at,value:frameZonalWind(result.frame),revision:result.revision});if(diagnostics.size>65)diagnostics.delete(diagnostics.keys().next().value!);}catch{/* The wind card reports incomplete diagnostics. */}
 }
 return result;
}
function cacheResult(model:ModelId,run:string,hour:number,level:number,member:number,result:ForecastResult){
 const at=Date.now();memory.set(frameKey(model,run,hour,level,member),result,at);trimGeneral();return retain(model,run,hour,level,member,result,at);
}
export function clearForecastCache(model:ModelId){downloads.clear(model+'/');clearPreparedManifest(model);if(model==='icon')clearIconManifest();clearForecastMeta(model);void clearStoredForecast(model);for(const key of memory.keys())if(key.startsWith(model+'/'))memory.delete(key);for(const key of diagnostics.keys())if(key.startsWith(model+'/'))diagnostics.delete(key);}
export function peekForecastZonal(model:ModelId,run:string,hour:number,member:number){
 const key=diagnosticKey(model,run,hour,member),hit=diagnostics.get(key);
 if(hit&&(Date.now()-hit.at>=lifetime(model)||hit.revision!==forecastFrameRevision(model,run,hour,10,member))){diagnostics.delete(key);return;}
 return hit?.value;
}
export function peekForecast(model:ModelId,run:string,hour:number,level:number,member:number):ForecastResult|undefined{
 if((model==='icon'||isEnsemble(model)&&member<0)&&!forecastFrameRevision(model,run,hour,level,member))return;
 const key=frameKey(model,run,hour,level,member),hit=memory.peek(key);
 if(hit&&(Date.now()-hit.at>=lifetime(model)||hit.result.revision!==forecastFrameRevision(model,run,hour,level,member))){memory.delete(key);return;}
 return hit?.result;
}
export class ForecastError extends Error{constructor(message:string,public retryAfter?:number){super(message)}}
export async function loadForecast(model:ModelId,run:string,hour:number,level:number,member:number,signal:AbortSignal,progress:(count:number)=>void):Promise<ForecastResult>{
 signal.throwIfAborted();
 // Callers other than the main page may not have loaded metadata. Verify a
 // prepared identity before consulting even a legacy persisted cache entry.
 if((model==='icon'||isEnsemble(model)&&member<0)&&!forecastFrameRevision(model,run,hour,level,member)){
  await forecastMeta(model,signal);signal.throwIfAborted();
  if(!forecastFrameRevision(model,run,hour,level,member))throw new ForecastError('This prepared run is no longer advertised. Refresh for the latest complete run.');
 }
 const key=frameKey(model,run,hour,level,member),ready=peekForecast(model,run,hour,level,member);
 if(ready){const hit=memory.get(key)!;return retain(model,run,hour,level,member,ready,hit.at);}
 const revision=forecastFrameRevision(model,run,hour,level,member);
 const assertCurrent=()=>{if(revision!==forecastFrameRevision(model,run,hour,level,member))throw new ForecastError('The forecast publication changed during download. Please retry.');};
 // Content identity also separates in-flight downloads. An old same-cycle
 // preparation cannot satisfy a subscriber to its corrected replacement.
 const result=await downloads.get(`${key}/${revision??'direct'}`,signal,async downloadSignal=>{
  const summary=isEnsemble(model)&&member<0;
  if(isCycle(model)&&hasForecastStorage()){
   const stored=await readStoredForecast(model,run,hour,level,member,revision);downloadSignal.throwIfAborted();assertCurrent();
   if(stored&&(!summary||stored.pair))return cacheResult(model,run,hour,level,member,stored);
  }
  let result:ForecastResult;
  if(summary){
   // Exactly one compact prepared file, never a silent fan-out to members.
   const pair=await preparedPair(model,run,hour,level,AbortSignal.any([downloadSignal,AbortSignal.timeout(30000)]));result={frame:pair.mean,pair,revision};
  }else{
   const frame=await forecastRequest(`model=${model}&run=${encodeURIComponent(run)}&hour=${hour}&level=${level}&member=${Math.max(0,member)}&diagnostics=u60-v1`,AbortSignal.any([downloadSignal,AbortSignal.timeout(180000)])) as Frame;
   if(frame.model!==model||frame.run!==run||frame.hour!==hour||frame.level!==level)throw Error('Received a different forecast than requested');
   result={frame,revision};
  }
  downloadSignal.throwIfAborted();assertCurrent();
  if(isCycle(model)&&hasForecastStorage())await writeStoredForecast(model,run,hour,level,member,result);
  downloadSignal.throwIfAborted();assertCurrent();return cacheResult(model,run,hour,level,member,result);
 });
 signal.throwIfAborted();assertCurrent();if(isEnsemble(model)&&member<0)progress(memberCount(model));return result;
}
