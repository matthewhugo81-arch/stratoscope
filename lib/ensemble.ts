import {noaaFile,noaaIndex,noaaFields} from './noaa-open-data';
import {decodeGrib,type Frame,type Grid} from './grib';
import {MODELS,memberCount,type EnsembleModel} from './models';
import {readCachedJson,writeCachedJson} from './optional-cache';
import {zonalMeanAt60,type ZonalWind} from './zonal-wind';

const ec='https://data.ecmwf.int/forecasts';
const fieldKeys=['temperature','height','u','v'] as const;
type Key=typeof fieldKeys[number];
type Entry={date:string;time:string;step:string;levtype:string;levelist:string;param:string;type:string;number?:string;_offset:number;_length:number};
const indexes=new Map<string,Promise<Entry[]>>(),frames=new Map<string,Frame>(),pending=new Map<string,Promise<Frame>>(),latest=new Map<EnsembleModel,{run:string;at:number}>();
function parts(run:string){return {day:run.slice(0,10).replaceAll('-',''),cycle:run.slice(11,13)}}
function ecBase(model:EnsembleModel,run:string,hour:number,member:number){
 const {day,cycle}=parts(run),system=model==='aifs_ens'?'aifs-ens':'ifs',stream=model==='ifs_ens'&&member===0?'oper':'enfo',type=stream==='oper'?'fc':member===0?'cf':model==='ifs_ens'?'ef':'pf';
 return `${ec}/${day}/${cycle}z/${system}/0p25/${stream}/${day}${cycle}0000-${hour}h-${stream}-${type}`;
}
async function inventory(base:string){
 let task=indexes.get(base);if(!task){task=(async()=>{const r=await fetch(base+'.index',{signal:AbortSignal.timeout(15000)});if(!r.ok)throw Error('This ECMWF ensemble run is unavailable. Refresh for the latest completed run.');const text=await r.text();if(text.length>15000000)throw Error('Unexpected ensemble index size');return text.trim().split('\n').map(s=>JSON.parse(s) as Entry).filter(e=>e.levtype==='pl'&&[10,50,100].includes(Number(e.levelist))&&['t','gh','z','u','v'].includes(e.param));})();indexes.set(base,task);task.catch(()=>indexes.delete(base));if(indexes.size>8)indexes.delete(indexes.keys().next().value!);}return task;
}
function select(entries:Entry[],model:EnsembleModel,run:string,hour:number,level:number,member:number){
 const {day,cycle}=parts(run),params:Record<Key,string>={temperature:'t',height:model==='aifs_ens'?'z':'gh',u:'u',v:'v'};
 return fieldKeys.map(key=>{const found=entries.filter(e=>e.param===params[key]&&Number(e.levelist)===level&&e.date===day&&Number(e.time)===Number(cycle)*100&&Number(e.step)===hour&&(member===0?e.type===(model==='ifs_ens'?'fc':'cf'):e.type==='pf'&&Number(e.number)===member));const e=found[0];if(found.length!==1||!Number.isSafeInteger(e._offset)||e._offset<0||!Number.isSafeInteger(e._length)||e._length<20||e._length>8000000)throw Error(`Missing ${level} hPa field in ensemble member ${member}. No incomplete ensemble will be displayed.`);return {key,entry:e};});
}
export async function latestEnsembleRun(model:EnsembleModel){
 const hit=latest.get(model);if(hit&&Date.now()-hit.at<900000)return hit.run;
 const interval=model==='ifs_ens'?12:6,start=Math.floor((Date.now()-8*3600000)/(interval*3600000))*interval*3600000;
 for(let back=0;back<4;back++){
  const run=new Date(start-back*interval*3600000).toISOString();
  try{
   if(model==='gefs'){
    for(const level of [10,30]){const entries=await noaaIndex(noaaFile('gefs',run,384,level,30));for(const field of ['TMP','HGT','UGRD','VGRD'])if(!entries.some(p=>p[3]===field&&p[4]===`${level} mb`))throw Error('Incomplete GEFS cycle');}
   }else{
    const members=await inventory(ecBase(model,run,360,1)),control=await inventory(ecBase(model,run,360,0));
    for(const level of MODELS[model].levels)for(let member=0;member<51;member++)select(member?members:control,model,run,360,level,member);
   }
   latest.set(model,{run,at:Date.now()});return run;
  }catch{}
 }
 throw Error(`No complete ${MODELS[model].label} cycle is available from its provider. Please retry later.`);
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
  const base=ecBase(model,run,hour,member),selected=select(await inventory(base),model,run,hour,level,member);source=base+'.grib2';
  // One global field at a time bounds memory. Each request handles just one member.
  for(const {key,entry:e} of selected){
   const end=e._offset+e._length-1,r=await fetch(source,{cache:'no-store',headers:{Range:`bytes=${e._offset}-${end}`},signal:AbortSignal.timeout(30000)});
   // Content-Range may be hidden by provider CORS; byte count and GRIB identity remain mandatory.
  const range=r.headers.get('Content-Range');
   if(r.status!==206||(range&&!range.startsWith(`bytes ${e._offset}-${end}/`))){await r.body?.cancel();throw Error('ECMWF did not return the requested ensemble field range.');}
   const bytes=await r.arrayBuffer();if(bytes.byteLength!==e._length)throw Error('Incomplete ECMWF ensemble download');const decoded=decodeGrib(bytes);
   const correctMember=model==='ifs_ens'&&member===0?decoded.product===0:decoded.member===member;
   if(decoded.run!==run||decoded.hour!==hour||decoded.level!==level||!correctMember||!decoded.fields[key]||Object.keys(decoded.fields).length!==1)throw Error('ECMWF returned a different ensemble field or member.');
   if(level===10&&key==='u')zonalWind60N=zonalMeanAt60(decoded.fields.u,decoded.grid);
   fields[key]=sampleNorth(decoded.fields[key],decoded.grid);
  }
 }
 const data:Frame={run,hour,level,valid:new Date(Date.parse(run)+hour*3600000).toISOString(),grid:{nx:360,ny:91,lat0:90,lon0:0,dx:1,dy:-1},temperature:fields.temperature!,height:fields.height!,u:fields.u!,v:fields.v!,source,model,runKind:'cycle',fetchedAt:new Date().toISOString(),ensemble:{view:'member',member,count:memberCount(model)}};
 if(zonalWind60N)data.zonalWind60N=zonalWind60N;
 await writeCachedJson(cacheKey,data,10800);return data;
}
export async function ensembleMember(model:EnsembleModel,run:string,hour:number,level:number,member:number){
 const key=`${model}/${run}/${hour}/${level}/${member}`,hit=frames.get(key);if(hit)return hit;let task=pending.get(key);
 if(!task){task=loadMember(model,run,hour,level,member).then(data=>{frames.set(key,data);if(frames.size>10)frames.delete(frames.keys().next().value!);return data}).finally(()=>pending.delete(key));pending.set(key,task);}return task;
}
