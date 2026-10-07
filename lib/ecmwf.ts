import {decodeGrib,type Frame,type Grid} from './grib';
import {readCachedJson,writeCachedJson} from './optional-cache';
import {zonalMeanAt60,type ZonalWind} from './zonal-wind';

type Entry={date:string;time:string;step:string;levtype:string;levelist:string;param:string;_offset:number;_length:number};
const origin='https://data.ecmwf.int/forecasts';
const parameters={t:'temperature',gh:'height',u:'u',v:'v'} as const;
const frames=new Map<string,Frame>(),pending=new Map<string,Promise<Frame>>();
let latest:{at:number;run:string}|undefined;
function baseUrl(run:string,hour:number){const day=run.slice(0,10).replaceAll('-',''),cycle=run.slice(11,13);return `${origin}/${day}/${cycle}z/ifs/0p25/oper/${day}${cycle}0000-${hour}h-oper-fc`;}
async function inventory(run:string,hour:number){
 const response=await fetch(baseUrl(run,hour)+'.index',{signal:AbortSignal.timeout(9000)});
 if(!response.ok)throw Error('This ECMWF run is unavailable or has expired. Refresh to get the latest run.');
 const text=await response.text();if(text.length>2000000)throw Error('Unexpected ECMWF index size');
 return text.trim().split('\n').map(line=>JSON.parse(line) as Entry);
}
function select(entries:Entry[],run:string,hour:number,level:number){
 return Object.entries(parameters).map(([param,key])=>{
  const found=entries.filter(e=>e.param===param&&Number(e.levelist)===level&&e.levtype==='pl'&&Number(e.step)===hour&&e.date===run.slice(0,10).replaceAll('-','')&&Number(e.time)===Number(run.slice(11,13))*100);
  const e=found[0];if(found.length!==1||!Number.isSafeInteger(e._offset)||e._offset<0||!Number.isSafeInteger(e._length)||e._length<20||e._length>8000000)throw Error(`ECMWF ${level} hPa ${param} is missing from this run. No substitute model was used.`);
  return {entry:e,key:key as 'temperature'|'height'|'u'|'v'};
 });
}
export async function latestEcmwfRun(){
 if(latest&&Date.now()-latest.at<900000)return latest.run;
 // Use completed 00/12 UTC cycles so every selected run spans all ten days.
 const start=Math.floor((Date.now()-8*3600000)/(12*3600000))*12*3600000;
 for(let back=0;back<4;back++){
  const run=new Date(start-back*12*3600000).toISOString();
  try{const entries=await inventory(run,240);for(const level of [10,50,100])select(entries,run,240,level);latest={at:Date.now(),run};return run;}catch{}
 }
 throw Error('ECMWF is not returning a complete ten-day IFS run. Please try again shortly.');
}
// Keep every fourth native 0.25° point, with a consistent 0–359° longitude
// origin. This is a 1° display grid; no vertical interpolation is performed.
export function northernGrid(values:number[],g:Grid){
 if(g.nx!==1440||g.ny!==721||g.dx!==.25||g.dy!==-.25||g.lat0!==90||values.length!==g.nx*g.ny)throw Error('Unexpected ECMWF grid');
 const result=new Array<number>(360*91);
 for(let y=0;y<=90;y++)for(let lon=0;lon<360;lon++){
  const x=Math.round(((lon-g.lon0+720)%360)/g.dx)%g.nx,value=values[y*4*g.nx+x];
  if(!Number.isFinite(value))throw Error('Missing ECMWF grid value');result[y*360+lon]=value;
 }
 return result;
}
async function loadFrame(run:string,hour:number,level:number):Promise<Frame>{
 const cacheKey=new Request(`https://stratoscope-cache.invalid/ecmwf-direct-v2/${run}/${level}/${hour}`);
 const cached=await readCachedJson<Frame>(cacheKey);if(cached)return cached;
 const selected=select(await inventory(run,hour),run,hour,level),fields:Partial<Record<'temperature'|'height'|'u'|'v',number[]>>={};
 let zonalWind60N:ZonalWind|undefined;
 // Decode one global field at a time to keep Worker memory bounded.
 for(const {entry:e,key} of selected){
  const end=e._offset+e._length-1,response=await fetch(baseUrl(run,hour)+'.grib2',{cache:'no-store',headers:{Range:`bytes=${e._offset}-${end}`},signal:AbortSignal.timeout(30000)});
  // Content-Range may be hidden by provider CORS; byte count and GRIB identity remain mandatory.
  const range=response.headers.get('Content-Range');
  if(response.status!==206||(range&&!range.startsWith(`bytes ${e._offset}-${end}/`))){await response.body?.cancel();throw Error('ECMWF did not return the requested field range. Please retry.');}
  const bytes=await response.arrayBuffer();if(bytes.byteLength!==e._length)throw Error('Incomplete ECMWF download');
  const decoded=decodeGrib(bytes);
  if(decoded.run!==run||decoded.hour!==hour||decoded.level!==level||!decoded.fields[key]||Object.keys(decoded.fields).length!==1)throw Error('ECMWF returned a different field than requested.');
  if(level===10&&key==='u')zonalWind60N=zonalMeanAt60(decoded.fields.u,decoded.grid);
  fields[key]=northernGrid(decoded.fields[key],decoded.grid);
 }
 const data:Frame={run,hour,level,valid:new Date(Date.parse(run)+hour*3600000).toISOString(),grid:{nx:360,ny:91,lat0:90,lon0:0,dx:1,dy:-1},temperature:fields.temperature!,height:fields.height!,u:fields.u!,v:fields.v!,model:'ecmwf_direct',runKind:'cycle',fetchedAt:new Date().toISOString(),source:baseUrl(run,hour)+'.grib2'};
 if(zonalWind60N)data.zonalWind60N=zonalWind60N;
 await writeCachedJson(cacheKey,data,10800);
 return data;
}
export async function ecmwfFrame(run:string,hour:number,level:number){
 const key=`${run}/${level}/${hour}`,hit=frames.get(key);if(hit)return hit;
 let task=pending.get(key);if(!task){task=loadFrame(run,hour,level).then(data=>{frames.set(key,data);if(frames.size>12)frames.delete(frames.keys().next().value!);return data}).finally(()=>pending.delete(key));pending.set(key,task);}return task;
}
