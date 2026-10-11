import {noaaFields} from './noaa-open-data';
import {decodeGrib,type Frame,type Grid} from './grib';
import {memberCount,type EnsembleModel} from './models';
import {preparedMeta} from './prepared-ensembles';
import {readCachedJson,writeCachedJson} from './optional-cache';
import {zonalMeanAt60,type ZonalWind} from './zonal-wind';

// Match the ingestion replicas. Never use an index from one host to range-read
// another: replicas can temporarily have different object versions.
const ecOrigins=['https://storage.googleapis.com/ecmwf-open-data','https://d2zvc0wgha4k2l.cloudfront.net','https://data.ecmwf.int/forecasts'];
class SourceUnavailable extends Error{}
const fieldKeys=['temperature','height','u','v'] as const;
type Key=typeof fieldKeys[number];
type Entry={date:string;time:string;step:string;levtype:string;levelist:string;param:string;type:string;number?:string;_offset:number;_length:number};
const indexes=new Map<string,Promise<Entry[]>>(),frames=new Map<string,Frame>(),pending=new Map<string,Promise<Frame>>();
function parts(run:string){return {day:run.slice(0,10).replaceAll('-',''),cycle:run.slice(11,13)}}
function ecBase(model:EnsembleModel,run:string,hour:number,member:number,origin:string){
 const {day,cycle}=parts(run),system=model==='aifs_ens'?'aifs-ens':'ifs',stream=model==='ifs_ens'&&member===0?'oper':'enfo',type=stream==='oper'?'fc':member===0?'cf':model==='ifs_ens'?'ef':'pf';
 return `${origin}/${day}/${cycle}z/${system}/0p25/${stream}/${day}${cycle}0000-${hour}h-${stream}-${type}`;
}
async function get(url:string,options:RequestInit={}){
 let response:Response;
 try{response=await fetch(url,{cache:'no-store',signal:AbortSignal.timeout(15000),...options})}
 catch{throw new SourceUnavailable('The ECMWF replica could not be reached.')}
 if(!response.ok){await response.body?.cancel();throw new SourceUnavailable(`ECMWF replica returned HTTP ${response.status}.`)}
 return response;
}
async function inventory(base:string){
 let task=indexes.get(base);if(!task){task=(async()=>{const r=await get(base+'.index');let text:string;try{text=await r.text()}catch{throw new SourceUnavailable('Incomplete ECMWF inventory download.')}if(text.length>15000000)throw Error('Unexpected ensemble index size');return text.trim().split('\n').map(s=>JSON.parse(s) as Entry).filter(e=>e.levtype==='pl'&&[10,50,100].includes(Number(e.levelist))&&['t','gh','z','u','v'].includes(e.param));})();indexes.set(base,task);task.catch(()=>indexes.delete(base));if(indexes.size>8)indexes.delete(indexes.keys().next().value!);}return task;
}
function select(entries:Entry[],model:EnsembleModel,run:string,hour:number,level:number,member:number){
 const {day,cycle}=parts(run),params:Record<Key,string>={temperature:'t',height:model==='aifs_ens'?'z':'gh',u:'u',v:'v'};
 return fieldKeys.map(key=>{const found=entries.filter(e=>e.param===params[key]&&Number(e.levelist)===level&&e.date===day&&Number(e.time)===Number(cycle)*100&&Number(e.step)===hour&&(member===0?e.type===(model==='ifs_ens'?'fc':'cf'):e.type==='pf'&&Number(e.number)===member));const e=found[0];if(found.length!==1||!Number.isSafeInteger(e._offset)||e._offset<0||!Number.isSafeInteger(e._length)||e._length<20||e._length>8000000)throw Error(`Missing ${level} hPa field in ensemble member ${member}. No incomplete ensemble will be displayed.`);return {key,entry:e};});
}
export async function latestEnsembleRun(model:EnsembleModel){
 return (await preparedMeta(model,AbortSignal.timeout(15000))).run;
}
export function sampleNorth(values:number[],g:Grid){
 const north=(90-g.lat0)/g.dy,equator=-g.lat0/g.dy;
 if(![.25,.5,1].includes(g.dx)||Math.abs(g.dy)!==g.dx||g.nx*g.dx!==360||north<0||north>=g.ny||equator<0||equator>=g.ny||!Number.isInteger(north)||!Number.isInteger(equator)||values.length!==g.nx*g.ny)throw Error('Unexpected ensemble grid');
 const result=new Array<number>(360*91);
 for(let y=0;y<=90;y++)for(let lon=0;lon<360;lon++){const x=Math.round(((lon-g.lon0+720)%360)/g.dx)%g.nx,j=Math.round((90-y-g.lat0)/g.dy),value=values[j*g.nx+x];if(!Number.isFinite(value))throw Error('Missing ensemble grid value');result[y*360+lon]=value;}
 return result;
}
async function loadMember(model:EnsembleModel,run:string,hour:number,level:number,member:number):Promise<Frame>{
 const cacheKey=new Request(`https://stratoscope-cache.invalid/ensemble-v2/${model}/${run}/${hour}/${level}/${member}`);
 const cached=await readCachedJson<Frame>(cacheKey);if(cached)return cached;
 const fields:Partial<Record<Key,number[]>>={};let source='',zonalWind60N:ZonalWind|undefined;
 if(model==='gefs'){
  const decoded=await noaaFields('gefs',run,hour,level,member);source=decoded.source;
  for(const key of fieldKeys){if(!decoded.fields[key])throw Error('A GEFS weather field is missing');if(level===10&&key==='u')zonalWind60N=zonalMeanAt60(decoded.fields.u,decoded.grid);fields[key]=sampleNorth(decoded.fields[key],decoded.grid);}
 }else{
  let completed=false;
  for(const origin of ecOrigins){
   const base=ecBase(model,run,hour,member,origin);
   try{
    const selected=select(await inventory(base),model,run,hour,level,member);
    source=base+'.grib2';
    // Two compressed fields at a time overlap network latency without keeping
    // four decoded global arrays alive. Both settle before trying a new host.
    for(let i=0;i<selected.length;i+=2){
     const downloaded=await Promise.allSettled(selected.slice(i,i+2).map(async({key,entry:e})=>{
      const end=e._offset+e._length-1,r=await get(source,{headers:{Range:`bytes=${e._offset}-${end}`},signal:AbortSignal.timeout(30000)});
      const range=r.headers.get('Content-Range');
      if(r.status!==206||(range&&!range.startsWith(`bytes ${e._offset}-${end}/`))){await r.body?.cancel();throw new SourceUnavailable('ECMWF did not return the requested field range.')}
      let bytes:ArrayBuffer;try{bytes=await r.arrayBuffer()}catch{throw new SourceUnavailable('Incomplete ECMWF field download.')}
      if(bytes.byteLength!==e._length)throw new SourceUnavailable('Truncated ECMWF field.');
      return {key,bytes};
     }));
     for(const result of downloaded){
      if(result.status==='rejected')throw result.reason;
      const {key,bytes}=result.value,decoded=decodeGrib(bytes);
      const correctMember=model==='ifs_ens'&&member===0?decoded.product===0:decoded.member===member;
      if(decoded.run!==run||decoded.hour!==hour||decoded.level!==level||!correctMember||!decoded.fields[key]||Object.keys(decoded.fields).length!==1)throw Error('ECMWF returned a different ensemble field or member.');
      if(level===10&&key==='u')zonalWind60N=zonalMeanAt60(decoded.fields.u,decoded.grid);
      fields[key]=sampleNorth(decoded.fields[key],decoded.grid);
     }
    }
    completed=true;break;
   }catch(error){if(!(error instanceof SourceUnavailable))throw error;indexes.delete(base)}
  }
  if(!completed)throw Error('This ensemble member could not be downloaded from the official ECMWF replicas. Please try again.');
 }
 const data:Frame={run,hour,level,valid:new Date(Date.parse(run)+hour*3600000).toISOString(),grid:{nx:360,ny:91,lat0:90,lon0:0,dx:1,dy:-1},temperature:fields.temperature!,height:fields.height!,u:fields.u!,v:fields.v!,source,model,runKind:'cycle',fetchedAt:new Date().toISOString(),ensemble:{view:'member',member,count:memberCount(model)}};
 if(zonalWind60N)data.zonalWind60N=zonalWind60N;
 await writeCachedJson(cacheKey,data,10800);return data;
}
export async function ensembleMember(model:EnsembleModel,run:string,hour:number,level:number,member:number){
 const key=`${model}/${run}/${hour}/${level}/${member}`,hit=frames.get(key);if(hit)return hit;let task=pending.get(key);
 if(!task){task=loadMember(model,run,hour,level,member).then(data=>{frames.set(key,data);if(frames.size>10)frames.delete(frames.keys().next().value!);return data}).finally(()=>pending.delete(key));pending.set(key,task);}return task;
}
