import {noaaFile,noaaIndex,noaaFields,northField} from './noaa-open-data';
import {type Frame} from './grib';
import {zonalMeanAt60} from './zonal-wind';
export const LEVELS=[100,70,50,30,20,10];
const frames=new Map<string,{at:number;data:Frame}>();
let latest:{at:number;run:string}|undefined;
export async function latestRun(){
 if(latest&&Date.now()-latest.at<900000)return latest.run;
 const base=Math.floor((Date.now()-5*3600000)/(6*3600000))*6*3600000;
 for(let back=0;back<5;back++){
  const run=new Date(base-back*6*3600000).toISOString(),day=run.slice(0,10).replaceAll('-',''),cycle=run.slice(11,13);
  try{const entries=await noaaIndex(noaaFile('gfs',run,240,10));if(entries.some(p=>p[3]==='TMP'&&p[4]==='10 mb')){latest={at:Date.now(),run};return run;}}catch{}
 }
 throw Error('NOAA is not returning a complete GFS run. Please try again shortly.');
}
export async function getFrame(run:string,hour:number,level:number):Promise<Frame>{
 const id=`${run}/${level}/${hour}`,cached=frames.get(id);if(cached&&Date.now()-cached.at<3600000)return cached.data;
 const decoded=await noaaFields('gfs',run,hour,level);
 const data:Frame={model:'gfs',runKind:'cycle',run,hour,level,valid:new Date(Date.parse(run)+hour*3600000).toISOString(),grid:{nx:360,ny:91,lat0:90,lon0:0,dx:1,dy:-1},temperature:northField(decoded.fields.temperature,decoded.grid),height:northField(decoded.fields.height,decoded.grid),u:northField(decoded.fields.u,decoded.grid),v:northField(decoded.fields.v,decoded.grid),source:decoded.source};
 if(level===10)data.zonalWind60N=zonalMeanAt60(decoded.fields.u,decoded.grid);
 frames.set(id,{at:Date.now(),data});if(frames.size>18)frames.delete(frames.keys().next().value!);return data;
}
