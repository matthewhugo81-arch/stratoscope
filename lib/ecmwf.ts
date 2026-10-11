import {decodeGrib,type Frame,type Grid} from './grib';
import {readCachedJson,writeCachedJson} from './optional-cache';
import {zonalMeanAt60,type ZonalWind} from './zonal-wind';

type Entry={date:string;time:string;step:string;levtype:string;levelist:string;param:string;_offset:number;_length:number};
const origins=['https://storage.googleapis.com/ecmwf-open-data','https://data.ecmwf.int/forecasts'] as const;
const parameters={t:'temperature',gh:'height',u:'u',v:'v'} as const;
const frames=new Map<string,Frame>(),pending=new Map<string,Promise<Frame>>();
let latest:{at:number;run:string}|undefined;
class MissingInventory extends Error{}
class TransportFailure extends Error{}
class IncompleteInventory extends Error{}
function baseUrl(run:string,hour:number,origin:string){const day=run.slice(0,10).replaceAll('-',''),cycle=run.slice(11,13);return `${origin}/${day}/${cycle}z/ifs/0p25/oper/${day}${cycle}0000-${hour}h-oper-fc`;}
async function get(url:string,options:RequestInit={}){
 let response:Response;
 try{response=await fetch(url,{cache:'no-store',signal:AbortSignal.timeout(15000),...options});}
 catch(e){throw new TransportFailure(e instanceof Error?e.message:'ECMWF transport unavailable');}
 if(response.status===404||response.status===410){await response.body?.cancel();throw new MissingInventory('This ECMWF file has not been published or has expired.');}
 if(!response.ok){await response.body?.cancel();throw new TransportFailure(`ECMWF source returned HTTP ${response.status}.`);}
 return response;
}
async function inventory(run:string,hour:number,origin:string){
 const response=await get(baseUrl(run,hour,origin)+'.index');
 let text:string;
 try{text=await response.text();}catch{throw new TransportFailure('Incomplete ECMWF inventory download');}
 if(text.length>2000000)throw Error('Unexpected ECMWF index size');
 return text.trim().split('\n').map(line=>JSON.parse(line) as Entry);
}
function select(entries:Entry[],run:string,hour:number,level:number){
 return Object.entries(parameters).map(([param,key])=>{
  const found=entries.filter(e=>e.param===param&&Number(e.levelist)===level&&e.levtype==='pl'&&Number(e.step)===hour&&e.date===run.slice(0,10).replaceAll('-','')&&Number(e.time)===Number(run.slice(11,13))*100);
  const e=found[0];
  if(found.length!==1)throw new IncompleteInventory(`ECMWF ${level} hPa ${param} is missing or duplicated. No substitute model was used.`);
  if(!Number.isSafeInteger(e._offset)||e._offset<0||!Number.isSafeInteger(e._length)||e._length<20||e._length>8000000)throw Error('Invalid ECMWF field byte range');
  return {entry:e,key:key as 'temperature'|'height'|'u'|'v'};
 });
}
async function independentlyAuditedRun():Promise<string|undefined>{
 // Some official 404 responses omit CORS headers, so a browser sees a generic
 // network error rather than the actual HTTP status. Use our bounded, successful
 // server-side inventory audit in that case; never infer a run from the clock.
 try{
  const r=await fetch('https://raw.githubusercontent.com/matthewhugo81-arch/stratoscope/forecast-status/latest.json?check='+Date.now(),{cache:'no-store',signal:AbortSignal.timeout(10000)});
  if(!r.ok)return;
  const text=await r.text();if(text.length>100000)return;
  const d=JSON.parse(text),checked=Date.parse(d.checkedAt),age=Date.now()-checked;
  if(d.version!==1||!Number.isFinite(checked)||age< -300000||age>12600000||!Array.isArray(d.models))return;
  const f=d.models.find((x:{model?:string})=>x?.model==='ecmwf_direct');
  if(f?.sourceStatus!=='verified'||f?.status!=='direct'||typeof f.availableRun!=='string')return;
  const time=Date.parse(f.availableRun),date=new Date(time);
  if(!Number.isFinite(time)||time>Date.now()||Date.now()-time>172800000||![0,12].includes(date.getUTCHours())||date.getUTCMinutes()||date.getUTCSeconds())return;
  const run=date.toISOString();
  // Recheck the reported run's terminal fields before returning it. The visible
  // pipeline notice retains the audit time and any source-pending warning.
  for(const origin of origins){
   try{const entries=await inventory(run,240,origin);for(const level of [10,50,100])select(entries,run,240,level);return run;}catch{}
  }
 }catch{}
}
export async function latestEcmwfRun(){
 if(latest&&Date.now()-latest.at<60000)return latest.run;
 const start=Math.floor(Date.now()/(12*3600000))*12*3600000;
 for(let back=0;back<4;back++){
  const run=new Date(start-back*12*3600000).toISOString();
  let outage:Error|undefined;
  for(const origin of origins){
   try{
    const entries=await inventory(run,240,origin);
    for(const level of [10,50,100])select(entries,run,240,level);
    latest={at:Date.now(),run};return run;
   }catch(e){
    if(e instanceof TransportFailure)outage=e;
    else if(!(e instanceof MissingInventory)&&!(e instanceof IncompleteInventory))throw e;
   }
  }
  if(outage){
   const audited=await independentlyAuditedRun();
   if(audited){latest={at:Date.now(),run:audited};return audited;}
   throw new Error('Unable to verify the newest ECMWF run on the official feeds. Please retry; an older run was not silently substituted.');
  }
 }
 throw Error('ECMWF is not returning a complete ten-day IFS run. Please try again shortly.');
}
// Keep every fourth native 0.25° point; no vertical interpolation.
export function northernGrid(values:number[],g:Grid){
 if(g.nx!==1440||g.ny!==721||g.dx!==.25||g.dy!==-.25||g.lat0!==90||values.length!==g.nx*g.ny)throw Error('Unexpected ECMWF grid');
 const result=new Array<number>(360*91);
 for(let y=0;y<=90;y++)for(let lon=0;lon<360;lon++){
  const x=Math.round(((lon-g.lon0+720)%360)/g.dx)%g.nx,value=values[y*4*g.nx+x];
  if(!Number.isFinite(value))throw Error('Missing ECMWF grid value');result[y*360+lon]=value;
 }
 return result;
}
async function fromOrigin(run:string,hour:number,level:number,origin:string):Promise<Frame>{
 const selected=select(await inventory(run,hour,origin),run,hour,level),fields:Partial<Record<'temperature'|'height'|'u'|'v',number[]>>={};
 let zonalWind60N:ZonalWind|undefined;
 for(const {entry:e,key} of selected){
  const end=e._offset+e._length-1,response=await get(baseUrl(run,hour,origin)+'.grib2',{headers:{Range:`bytes=${e._offset}-${end}`},signal:AbortSignal.timeout(30000)});
  const range=response.headers.get('Content-Range');
  if(response.status!==206||(range&&!range.startsWith(`bytes ${e._offset}-${end}/`))){await response.body?.cancel();throw new TransportFailure('ECMWF did not return the requested field range.');}
  let bytes:ArrayBuffer;
  try{bytes=await response.arrayBuffer();}catch{throw new TransportFailure('Incomplete ECMWF download');}
  if(bytes.byteLength!==e._length)throw new TransportFailure('Truncated ECMWF field');
  const decoded=decodeGrib(bytes);
  if(decoded.run!==run||decoded.hour!==hour||decoded.level!==level||!decoded.fields[key]||Object.keys(decoded.fields).length!==1)throw Error('ECMWF returned a different field than requested.');
  if(level===10&&key==='u')zonalWind60N=zonalMeanAt60(decoded.fields.u,decoded.grid);
  fields[key]=northernGrid(decoded.fields[key],decoded.grid);
 }
 const data:Frame={run,hour,level,valid:new Date(Date.parse(run)+hour*3600000).toISOString(),grid:{nx:360,ny:91,lat0:90,lon0:0,dx:1,dy:-1},temperature:fields.temperature!,height:fields.height!,u:fields.u!,v:fields.v!,model:'ecmwf_direct',runKind:'cycle',fetchedAt:new Date().toISOString(),source:baseUrl(run,hour,origin)+'.grib2'};
 if(zonalWind60N)data.zonalWind60N=zonalWind60N;
 return data;
}
async function loadFrame(run:string,hour:number,level:number):Promise<Frame>{
 const cacheKey=new Request(`https://stratoscope-cache.invalid/ecmwf-direct-v2/${run}/${level}/${hour}`);
 const cached=await readCachedJson<Frame>(cacheKey);if(cached)return cached;
 let failed:unknown;
 for(const origin of origins){
  try{const data=await fromOrigin(run,hour,level,origin);await writeCachedJson(cacheKey,data,10800);return data;}
  catch(e){
   if(!(e instanceof TransportFailure)&&!(e instanceof MissingInventory)&&!(e instanceof IncompleteInventory))throw e;
   failed=e;
  }
 }
 throw failed??Error('ECMWF source unavailable');
}
export async function ecmwfFrame(run:string,hour:number,level:number){
 const key=`${run}/${level}/${hour}`,hit=frames.get(key);if(hit)return hit;
 let task=pending.get(key);if(!task){task=loadFrame(run,hour,level).then(data=>{frames.set(key,data);if(frames.size>12)frames.delete(frames.keys().next().value!);return data}).finally(()=>pending.delete(key));pending.set(key,task);}return task;
}
