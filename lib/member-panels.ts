import type {Frame} from './grib';
import {memberCount,type EnsembleModel} from './models';
import {readStoredForecast,writeStoredForecast} from './forecast-storage';
const cache=new Map<string,Frame[]>();
export const isEasterly=(value:number)=>Number.isFinite(value)&&value<0;
export function decodeMemberPanels(bytes:Uint8Array,model:EnsembleModel,run:string,hour:number):Frame[]{
 const d=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),text=new TextDecoder();
 if(bytes.length<12||text.decode(bytes.subarray(0,8))!=='STRATP01')throw Error('Invalid member panel file');
 const length=d.getUint32(8,true);if(length>8192||12+length>bytes.length)throw Error('Invalid member panel header');
 const h=JSON.parse(text.decode(bytes.subarray(12,12+length))),count=memberCount(model),g=h.grid,n=180*46;
 if(h.version!==1||h.model!==model||h.run!==run||h.hour!==hour||h.level!==10||h.count!==count||h.scale!==100||h.planes!==3||g?.nx!==180||g?.ny!==46||g?.lat0!==90||g?.lon0!==0||g?.dx!==2||g?.dy!==-2||bytes.length!==12+length+count*3*n*4)throw Error('Member panels do not match the selected forecast');
 const samples=model==='gefs'?720:1440;
 if(h.samples!==samples||!Array.isArray(h.zonal)||h.zonal.length!==count||h.zonal.some((v:unknown)=>typeof v!=='number'||!Number.isFinite(v)||Math.abs(v)>200)||h.source!==(model==='gefs'?'https://noaa-gefs-pds.s3.amazonaws.com':'https://data.ecmwf.int/forecasts'))throw Error('Invalid member wind diagnostics');
 let offset=12+length;
 return Array.from({length:count},(_,member)=>{
  const planes=Array.from({length:3},()=>{const values:number[]=[];for(let y=0;y<46;y++){let value=0;for(let x=0;x<180;x++){value+=d.getInt32(offset,true);offset+=4;values.push(value/100)}}return values});
  if(planes[0].some(v=>v< -150||v>100)||planes[1].some(v=>v<15000||v>50000)||planes[2].some(v=>v<0||v>300))throw Error('Invalid panel field values');
  return {model,run,hour,level:10,valid:new Date(Date.parse(run)+hour*3600000).toISOString(),grid:g,temperature:planes[0],height:planes[1],wind:planes[2],u:[],v:[],source:h.source,ensemble:{view:'member',member,count},zonalWind60N:{value:h.zonal[member],samples,longitudeStep:360/samples,basis:'native'}};
 });
}
export async function loadMemberPanels(model:EnsembleModel,run:string,hour:number,signal:AbortSignal){
 const key=`${model}/${run}/${hour}`;if(cache.has(key))return cache.get(key)!;
 const stored=await readStoredForecast(model,run,hour,10,-2) as {panels?:Frame[]}|undefined;signal.throwIfAborted();
 if(stored?.panels?.length===memberCount(model))return stored.panels;
 const runKey=run.slice(0,10).replaceAll('-','')+run.slice(11,13);
 const url=`https://raw.githubusercontent.com/matthewhugo81-arch/stratoscope/forecast-data-${model.replaceAll('_','-')}/${runKey}/10/${hour}.members.bin.gz`;
 const r=await fetch(url,{signal,cache:'force-cache'});
 if(!r.ok)throw Error('Member panels for this run are still being prepared. No individual-member downloads have been started.');
 const packed=await r.arrayBuffer();if(packed.byteLength>8000000)throw Error('Unexpected panel file size');
 const reader=new Blob([packed]).stream().pipeThrough(new DecompressionStream('gzip')).getReader(),chunks:Uint8Array[]=[];let size=0;
 try{while(true){signal.throwIfAborted();const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>5200000)throw Error('Unexpected panel data size');chunks.push(value)}}finally{await reader.cancel()}
 const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length}
 const panels=decodeMemberPanels(bytes,model,run,hour);signal.throwIfAborted();
 const result={frame:panels[0],panels};await writeStoredForecast(model,run,hour,10,-2,result);
 cache.set(key,panels);if(cache.size>3)cache.delete(cache.keys().next().value!);return panels;
}
