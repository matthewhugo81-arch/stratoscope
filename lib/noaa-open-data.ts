import {decodeGrib} from './grib';
import type {Grid} from './grib';

// NOAA Open Data Dissemination public buckets: anonymous HTTPS, no AWS account.
export function noaaFile(model:'gfs'|'gefs',run:string,hour:number,level:number,member=0){
 const day=run.slice(0,10).replaceAll('-',''),cycle=run.slice(11,13),step=String(hour).padStart(3,'0');
 if(model==='gfs')return `https://noaa-gfs-bdp-pds.s3.amazonaws.com/gfs.${day}/${cycle}/atmos/gfs.t${cycle}z.pgrb2.1p00.f${step}`;
 const part=[20,30,70].includes(level)?'b':'a',name=member===0?'gec00':'gep'+String(member).padStart(2,'0');
 return `https://noaa-gefs-pds.s3.amazonaws.com/gefs.${day}/${cycle}/atmos/pgrb2${part}p5/${name}.t${cycle}z.pgrb2${part}.0p50.f${step}`;
}
export async function noaaIndex(url:string){
 const r=await fetch(url+'.idx',{signal:AbortSignal.timeout(15000)});
 if(!r.ok)throw Error('This NOAA run is not available. Refresh for the latest complete run.');
 const text=await r.text();if(text.length>2000000)throw Error('Unexpected NOAA index size');
 return text.trim().split('\n').map(line=>line.split(':'));
}
export function northField(values:number[],g:Grid){
 if(![.25,.5,1].includes(g.dx)||Math.abs(g.dy)!==g.dx||g.nx*g.dx!==360||values.length!==g.nx*g.ny)throw Error('Unexpected NOAA grid');
 return Array.from({length:360*91},(_,n)=>{
  const y=(90-Math.floor(n/360)-g.lat0)/g.dy,x=((n%360-g.lon0+720)%360)/g.dx;
  if(!Number.isInteger(y)||y<0||y>=g.ny||!Number.isInteger(x))throw Error('Incomplete northern grid');
  const value=values[y*g.nx+x];if(!Number.isFinite(value))throw Error('Missing NOAA value');return value;
 });
}
export async function noaaFields(model:'gfs'|'gefs',run:string,hour:number,level:number,member=0){
 const source=noaaFile(model,run,hour,level,member),index=await noaaIndex(source),fields:Record<string,number[]>={};let grid:Grid|undefined;
 for(const [parameter,key] of Object.entries({TMP:'temperature',HGT:'height',UGRD:'u',VGRD:'v'})){
  const matches=index.map((p,i)=>({p,i})).filter(({p})=>p[3]===parameter&&p[4]===`${level} mb`);
  if(matches.length!==1)throw Error(`NOAA ${level} hPa ${parameter} is missing.`);
  const {p,i}=matches[0],start=Number(p[1]),end=Number(index[i+1]?.[1])-1;
  if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start<0||end<start||end-start>8000000)throw Error('Invalid NOAA field range');
  const r=await fetch(source,{cache:'no-store',headers:{Range:`bytes=${start}-${end}`},signal:AbortSignal.timeout(30000)});
  if(r.status!==206){await r.body?.cancel();throw Error('NOAA did not return the requested field range.');}
  const range=r.headers.get('Content-Range');
  // NOAA's public CORS policy does not expose Content-Range. Validate length,
  // GRIB identity, model cycle, level and ensemble member independently below.
  if(range&&!range.startsWith(`bytes ${start}-${end}/`))throw Error('Unexpected NOAA field range');
  const bytes=await r.arrayBuffer();if(bytes.byteLength!==end-start+1)throw Error('Incomplete NOAA field download');
  const d=decodeGrib(bytes);
  if(d.run!==run||d.hour!==hour||d.level!==level||(model==='gefs'&&d.member!==member)||!d.fields[key]||Object.keys(d.fields).length!==1)throw Error('NOAA returned a different forecast field.');
  if(grid&&JSON.stringify(grid)!==JSON.stringify(d.grid))throw Error('Mismatched NOAA grids');grid=d.grid;fields[key]=d.fields[key];
 }
 return {grid:grid!,fields,source};
}
