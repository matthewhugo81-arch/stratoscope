import {MODELS,type ModelId} from './models';
import type {Frame} from './grib';
type Bundle={at:number;frames:Frame[];nextOffset?:number};
type Location={latitude:number;longitude:number;hourly_units:Record<string,string>;hourly:Record<string,Array<number|null>|string[]>};
const bundles=new Map<string,Bundle>(),pending=new Map<string,Promise<Bundle>>();
const partial=new Map<string,Bundle>();
export class OpenMeteoRateLimit extends Error {retryAfter=65;constructor(message:string){super(message)}}
const fields=['temperature','geopotential_height','wind_speed','wind_direction'];
const ttl=30*60*1000;
// Fetch a level's entire timeline once, retaining only six-hour steps. This keeps
// moving through time from making a hemisphere of point requests every frame.
export async function openMeteoFrame(model:ModelId,run:string,level:number,hour:number){
 const key=`${model}/${run}/${level}`,hit=bundles.get(key);let bundle:Bundle;
 if(hit&&Date.now()-hit.at<ttl)bundle=hit;
 else{
  let task=pending.get(key);if(!task){task=loadBundle(model,run,level).then(b=>{bundles.set(key,b);if(bundles.size>6)bundles.delete(bundles.keys().next().value!);return b}).finally(()=>pending.delete(key));pending.set(key,task)}bundle=await task;
 }
 const frame=bundle.frames.find(f=>f.hour===hour);if(!frame)throw Error('This forecast time is not available from Open-Meteo.');return frame;
}
async function loadBundle(model:ModelId,run:string,level:number):Promise<Bundle>{
 const config=MODELS[model];if(!config.apiModel)throw Error('Select an Open-Meteo model.');
 const cache=(globalThis as unknown as {caches?:{default?:Cache}}).caches?.default;
 const key=`${model}/${run}/${level}`,cacheKey=new Request(`https://stratoscope-cache.invalid/open-meteo-v2/${key}`);
 let progress=partial.get(key);
 if(cache){const cached=await cache.match(cacheKey);if(cached){const saved=await cached.json() as Bundle;if(saved.nextOffset===360)return saved;progress=saved;}}
 if(progress&&Date.now()-progress.at>ttl){partial.delete(key);progress=undefined;}
 const now=Date.now(),grid={nx:36,ny:10,lat0:0,lon0:0,dx:10,dy:10};
 const frames:Frame[]=progress?.frames??Array.from({length:config.maxHour/6+1},(_,i)=>({run,hour:i*6,level,valid:new Date(Date.parse(run)+i*6*3600000).toISOString(),grid,temperature:[],height:[],u:[],v:[],model,runKind:'rolling',fetchedAt:new Date(now).toISOString(),source:'https://open-meteo.com/en/docs'}));
 const bundle:Bundle=progress??{at:now,frames,nextOffset:0};
 const variables=fields.map(v=>`${v}_${level}hPa`),start=run.slice(0,16),end=frames.at(-1)!.valid.slice(0,16);
 for(let offset=bundle.nextOffset??0;offset<360;offset+=60){
  const locations=Array.from({length:60},(_,i)=>{const n=offset+i,lon=n%36*10;return {lat:Math.floor(n/36)*10,lon:lon>180?lon-360:lon}});
  const q=new URLSearchParams({latitude:locations.map(p=>p.lat).join(','),longitude:locations.map(p=>p.lon).join(','),elevation:locations.map(()=>'nan').join(','),models:config.apiModel,hourly:variables.join(','),start_hour:start,end_hour:end,timezone:'GMT',wind_speed_unit:'ms',cell_selection:'nearest'});
  const response=await fetch(`https://api.open-meteo.com/v1/forecast?${q}`,{signal:AbortSignal.timeout(30000)});
  if(response.status===429){const body=await response.json() as {reason?:string};if(/daily|hourly/i.test(body.reason??''))throw Error('Open-Meteo’s free-service quota is temporarily exhausted. Cached maps and direct NOAA GFS are still available.');throw new OpenMeteoRateLimit('Open-Meteo’s short-term limit paused this download. It will resume automatically; downloaded sections are saved.');}
  if(!response.ok)throw Error(`Open-Meteo could not provide this map (${response.status}). Please retry.`);
  const data=await response.json() as Location[];if(!Array.isArray(data)||data.length!==60)throw Error('Open-Meteo returned an incomplete hemisphere.');
  for(let i=0;i<data.length;i++){
   const point=data[i],times=point.hourly.time as string[];
   if(point.hourly_units[variables[0]]!=='°C'||point.hourly_units[variables[1]]!=='m'||point.hourly_units[variables[2]]!=='m/s'||point.hourly_units[variables[3]]!=='°')throw Error('Unexpected Open-Meteo units.');
   for(const frame of frames){
    const t=times.indexOf(frame.valid.slice(0,16)),values=variables.map(v=>point.hourly[v]?.[t]);
    if(t<0||values.some(v=>typeof v!=='number'||!Number.isFinite(v)))throw Error(`${config.label} has missing ${level} hPa data at ${frame.valid.slice(0,16)} UTC. No substitute model was used.`);
    const [temperature,height,speed,direction]=values as number[],r=direction*Math.PI/180,n=offset+i;
    frame.temperature[n]=temperature;frame.height[n]=height;frame.u[n]=Math.round(-speed*Math.sin(r)*1000)/1000;frame.v[n]=Math.round(-speed*Math.cos(r)*1000)/1000;
   }
  }
  bundle.nextOffset=offset+60;partial.set(key,bundle);if(partial.size>6)partial.delete(partial.keys().next().value!);
  if(cache)await cache.put(cacheKey,Response.json(bundle,{headers:{'Cache-Control':'public, max-age=1800'}})).catch(()=>{});
 }
 partial.delete(key);
 return bundle;
}
