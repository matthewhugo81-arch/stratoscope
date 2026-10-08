import {preparedMeta} from './prepared-ensembles';
import {loadForecast} from './forecast-client';
import type {EnsembleModel} from './models';
export type VortexLayer={theta?:number;pressure?:number;pv?:number;segments:number[][]};
export type VortexGeometry={version:1;model:EnsembleModel;run:string;hour:number;count:number;method:string;source?:string;pressureLevels?:number[];gridDegrees?:number;layers:VortexLayer[]};
export type VortexCatalogue={version:1;model:'vortex';run:string;count:31;complete:true;timelineComplete:boolean;targetHour:384;step:12;method:string;files:Record<string,{path:string;bytes:number;sha256:string}>};
const root='https://raw.githubusercontent.com/matthewhugo81-arch/stratoscope/forecast-data-vortex/';
const cache=new Map<string,VortexGeometry>();
export function validateVortex(d:VortexGeometry,run:string,hour:number){
 if(d.version!==1||d.model!=='gefs'||d.run!==run||d.hour!==hour||d.count!==31||d.method!=='mean-field-pv-equivalent-area-70N'||d.source!=='https://noaa-gefs-pds.s3.amazonaws.com'||d.gridDegrees!==1||JSON.stringify(d.pressureLevels)!=='[1,2,3,5,7,10,20,30,50,70,100,150,200]'||!Array.isArray(d.layers)||d.layers.length!==33)throw Error('Incomplete GEFS vortex geometry');
 for(let i=0;i<33;i++){const l=d.layers[i];if(l.theta!==400+i*25||!Number.isFinite(l.pv)||!Array.isArray(l.segments)||!l.segments.length||l.segments.length>15000||l.segments.some(s=>s.length!==4||s.some(v=>!Number.isFinite(v))||s[0]<0||s[0]>360||s[2]<0||s[2]>360||s[1]<30||s[1]>90||s[3]<30||s[3]>90))throw Error('Invalid vortex contour');}
 return d;
}
export async function vortexCatalogue(signal:AbortSignal){
 const r=await fetch(root+'latest.json',{signal,cache:'no-cache'});if(!r.ok)throw Error('GEFS 3D geometry is being prepared. Complete forecast times appear here as they are published.');
 const d=await r.json() as VortexCatalogue;
 if(d.version!==1||d.model!=='vortex'||d.count!==31||d.complete!==true||d.step!==12||d.targetHour!==384||d.method!=='mean-field-pv-equivalent-area-70N'||typeof d.timelineComplete!=='boolean'||!/^\d{4}-\d{2}-\d{2}T(00|06|12|18):00:00\.000Z$/.test(d.run)||!Number.isFinite(Date.parse(d.run))||!d.files||!d.files['0'])throw Error('Invalid vortex catalogue');
 const key=d.run.slice(0,10).replaceAll('-','')+d.run.slice(11,13);
 for(const [hour,e] of Object.entries(d.files)){const h=Number(hour);if(!Number.isInteger(h)||h<0||h>384||h%12||e.path!==`${key}/gefs/${h}.json`||!Number.isInteger(e.bytes)||e.bytes<=0||e.bytes>8000000||!/^[a-f0-9]{64}$/.test(e.sha256))throw Error('Invalid vortex forecast entry');}
 if(d.timelineComplete&&Array.from({length:33},(_,i)=>i*12).some(h=>!d.files[String(h)]))throw Error('Incomplete vortex timeline');
 return d;
}
export async function loadVortex(c:VortexCatalogue,hour:number,signal:AbortSignal){
 const e=c.files[String(hour)];if(!e)throw Error('This GEFS forecast time is not prepared yet.');
 const key=`gefs/${c.run}/${hour}/${e.sha256}`;if(cache.has(key))return cache.get(key)!;
 const r=await fetch(root+e.path+'?sha='+e.sha256,{signal,cache:'force-cache'});if(!r.ok)throw Error('Vortex geometry could not be loaded.');
 const b=await r.arrayBuffer();if(b.byteLength!==e.bytes)throw Error('Incomplete vortex download');
 const sha=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',b)),v=>v.toString(16).padStart(2,'0')).join('');if(sha!==e.sha256)throw Error('Vortex geometry integrity check failed');
 const d=validateVortex(JSON.parse(new TextDecoder().decode(b)),c.run,hour);cache.set(key,d);if(cache.size>70)cache.delete(cache.keys().next().value!);return d;
}
// ECMWF's three available levels are shown as real independent height contours.
// Do not manufacture a continuous PV surface across the large vertical gaps.
export function heightContours(values:number[]){
 const weights:number[]=[],rank:{v:number;w:number}[]=[];
 for(let y=0;y<=60;y++){const lat=90-y,w=(Math.sin(Math.min(90,lat+.5)*Math.PI/180)-Math.sin(Math.max(30,lat-.5)*Math.PI/180))/360;weights.push(w);for(let x=0;x<360;x++)rank.push({v:values[y*360+x],w});}
 rank.sort((a,b)=>a.v-b.v);let area=0,threshold=rank[0].v;
 for(const p of rank){area+=p.w;threshold=p.v;if(area>=1-Math.sin(70*Math.PI/180))break;}
 const segments:number[][]=[];
 for(let y=0;y<60;y++)for(let x=0;x<360;x++){
  const a=[[x,90-y,values[y*360+x]],[x+1,90-y,values[y*360+(x+1)%360]],[x+1,89-y,values[(y+1)*360+(x+1)%360]],[x,89-y,values[(y+1)*360+x]]],points:number[][]=[];
  for(let k=0;k<4;k++){const p=a[k],q=a[(k+1)%4];if((p[2]>=threshold)!==(q[2]>=threshold)){const f=(threshold-p[2])/(q[2]-p[2]);points.push([p[0]+f*(q[0]-p[0]),p[1]+f*(q[1]-p[1])]);}}
  if(points.length===4&&(a.reduce((s,p)=>s+p[2],0)/4>=threshold)!==(a[0][2]>=threshold))points.push(points.shift()!);
  for(let i=0;i<points.length-1;i+=2)segments.push([...points[i],...points[i+1]]);
 }
 return segments;
}
export async function ecmwfLayers(model:'ifs_ens'|'aifs_ens',run:string,hour:number,signal:AbortSignal):Promise<VortexGeometry>{
 const key=`${model}/${run}/${hour}`;if(cache.has(key))return cache.get(key)!;
 const layers:VortexLayer[]=[];
 for(const pressure of [100,50,10]){const {frame}=await loadForecast(model,run,hour,pressure,-1,signal,()=>{});if(frame.run!==run||frame.level!==pressure||frame.hour!==hour||frame.ensemble?.count!==51)throw Error('Mismatched ECMWF layer');layers.push({pressure,segments:heightContours(frame.height)});}
 const data:VortexGeometry={version:1,model,run,hour,count:51,method:'three-independent-geopotential-layers',layers};cache.set(key,data);return data;
}
export const layerMeta=(model:'ifs_ens'|'aifs_ens',signal:AbortSignal)=>preparedMeta(model,signal);
