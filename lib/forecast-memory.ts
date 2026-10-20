import type {ForecastResult} from './forecast-client';

// A bounded estimate of retained decoded payloads, not a browser heap limit.
// Shared mean/spread planes are counted once; JS numbers use eight bytes.
export function decodedForecastBytes(result:ForecastResult){
 const planes=new Set<number[]>();
 for(const frame of [result.frame,result.pair?.mean,result.pair?.spread])if(frame){
  for(const values of [frame.temperature,frame.height,frame.u,frame.v,frame.wind])if(values)planes.add(values);
 }
 return 2048+Array.from(planes).reduce((bytes,values)=>bytes+values.length*8+64,0);
}
export function forecastMemoryBudget(){
 const browser=globalThis.navigator as (Navigator & {deviceMemory?:number})|undefined;
 const small=!!browser?.deviceMemory&&browser.deviceMemory<=4||globalThis.matchMedia?.('(max-width: 640px)').matches;
 return (small?24:48)*1024*1024;
}
export type MemoryEntry={at:number;result:ForecastResult;bytes:number};
export function createForecastMemory(maxBytes=forecastMemoryBudget()){
 const entries=new Map<string,MemoryEntry>();let bytes=0,focus='';
 const remove=(key:string)=>{const previous=entries.get(key);if(previous){bytes-=previous.bytes;entries.delete(key);}};
 function trim(){for(const key of entries.keys()){if(bytes<=maxBytes)break;if(key!==focus)remove(key);}}
 return {
  get size(){return entries.size;},get bytes(){return bytes;},maxBytes,
  entries:()=>entries.entries(),keys:()=>entries.keys(),delete:remove,
  focus(key:string){focus=key;trim();},
  // Rendering thumbnails must not promote every cached time in the LRU.
  peek:(key:string)=>entries.get(key),
  get(key:string){const entry=entries.get(key);if(entry){entries.delete(key);entries.set(key,entry);}return entry;},
  set(key:string,result:ForecastResult,at=Date.now()){
   remove(key);const size=decodedForecastBytes(result);
   // An oversized frame remains usable by its caller, without defeating the cap.
   if(size>maxBytes)return;
   entries.set(key,{at,result,bytes:size});bytes+=size;trim();
  },
 };
}
