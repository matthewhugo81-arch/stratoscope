import {decodeGrib,type Frame} from './grib';
export const LEVELS=[100,70,50,30,20,10];
const origin='https://nomads.ncep.noaa.gov',frames=new Map<string,{at:number;data:Frame}>();
let latest:{at:number;run:string}|undefined;
export async function latestRun(){
 if(latest&&Date.now()-latest.at<900000)return latest.run;
 const base=Math.floor((Date.now()-5*3600000)/(6*3600000))*6*3600000;
 for(let back=0;back<5;back++){
  const run=new Date(base-back*6*3600000).toISOString(),day=run.slice(0,10).replaceAll('-',''),cycle=run.slice(11,13);
  try{const r=await fetch(`${origin}/pub/data/nccf/com/gfs/prod/gfs.${day}/${cycle}/atmos/gfs.t${cycle}z.pgrb2.1p00.f240.idx`,{signal:AbortSignal.timeout(9000)});if(r.ok&&(await r.text()).includes(':TMP:10 mb:')){latest={at:Date.now(),run};return run;}}catch{}
 }
 throw Error('NOAA is not returning a complete GFS run. Please try again shortly.');
}
export async function getFrame(run:string,hour:number,level:number):Promise<Frame>{
 const id=`${run}/${level}/${hour}`,cached=frames.get(id);if(cached&&Date.now()-cached.at<3600000)return cached.data;
 const day=run.slice(0,10).replaceAll('-',''),cycle=run.slice(11,13);
 const q=new URLSearchParams({file:`gfs.t${cycle}z.pgrb2.1p00.f${String(hour).padStart(3,'0')}`,[`lev_${level}_mb`]:'on',var_TMP:'on',var_HGT:'on',var_UGRD:'on',var_VGRD:'on',subregion:'',leftlon:'0',rightlon:'359',toplat:'90',bottomlat:'0',dir:`/gfs.${day}/${cycle}/atmos`});
 const url=`${origin}/cgi-bin/filter_gfs_1p00.pl?${q}`,r=await fetch(url,{signal:AbortSignal.timeout(25000)});if(!r.ok)throw Error('This NOAA forecast is temporarily unavailable.');
 const decoded=decodeGrib(await r.arrayBuffer());if(decoded.run!==run||decoded.hour!==hour||decoded.level!==level)throw Error('NOAA returned a different forecast than requested.');
 for(const key of ['temperature','height','u','v'])if(!decoded.fields[key])throw Error('A required weather field is missing.');
 const data:Frame={run,hour,level,valid:new Date(Date.parse(run)+hour*3600000).toISOString(),grid:decoded.grid,temperature:decoded.fields.temperature,height:decoded.fields.height,u:decoded.fields.u,v:decoded.fields.v,source:url};
 frames.set(id,{at:Date.now(),data});if(frames.size>18)frames.delete(frames.keys().next().value!);return data;
}
