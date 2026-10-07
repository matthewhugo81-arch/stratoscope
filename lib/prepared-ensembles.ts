import type {Frame} from './grib';
import {MODELS,memberCount,type EnsembleModel,type ForecastMeta} from './models';

const root=(model:EnsembleModel)=>`https://raw.githubusercontent.com/matthewhugo81-arch/stratoscope/forecast-data-${model.replaceAll('_','-')}/`;
type Manifest={version:number;model:EnsembleModel;run:string;maxHour:number;levels:number[];step:number;count:number;complete:boolean;preparedAt:string;files:Record<string,{path:string;bytes:number;sha256:string}>};
const manifests=new Map<EnsembleModel,Manifest>();
export function clearPreparedManifest(model:string){manifests.delete(model as EnsembleModel);}
export async function preparedMeta(model:EnsembleModel,signal:AbortSignal):Promise<ForecastMeta>{
 const response=await fetch(root(model)+'latest.json',{signal,cache:'no-cache'});
 if(!response.ok)throw Error('Prepared ensemble maps are not available yet. Please retry shortly, or select an individual member.');
 const m=await response.json() as Manifest;
 if(m.version!==1||m.model!==model||!m.complete||m.count!==memberCount(model)||m.maxHour!==MODELS[model].maxHour||m.step!==6||!/^\d{4}-\d{2}-\d{2}T(00|12):00:00\.000Z$/.test(m.run)||!Number.isFinite(Date.parse(m.run))||!Number.isFinite(Date.parse(m.preparedAt))||JSON.stringify(m.levels)!==JSON.stringify(MODELS[model].levels))throw Error('The prepared ensemble catalogue is incomplete. Please retry later.');
 const runKey=m.run.slice(0,10).replaceAll('-','')+m.run.slice(11,13);
 for(const level of m.levels)for(let hour=0;hour<=m.maxHour;hour+=6){const file=m.files?.[`${level}/${hour}`];if(!file||file.path!==`${runKey}/${level}/${hour}.bin.gz`||!Number.isInteger(file.bytes)||file.bytes<=0||file.bytes>2000000||!/^[a-f0-9]{64}$/.test(file.sha256))throw Error('The prepared ensemble catalogue has missing frames.');}
 manifests.set(model,m);
 return {model,run:m.run,maxHour:m.maxHour,levels:m.levels,step:6,runKind:'cycle',fetchedAt:m.preparedAt};
}

export function decodePrepared(bytes:Uint8Array,model:EnsembleModel,run:string,hour:number,level:number){
 const d=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),text=new TextDecoder();
 if(bytes.length<12||text.decode(bytes.subarray(0,8))!=='STRAT001')throw Error('Invalid prepared forecast file');
 const length=d.getUint32(8,true);if(length>4096||12+length>bytes.length)throw Error('Invalid prepared forecast header');
 const h=JSON.parse(text.decode(bytes.subarray(12,12+length)));
 const g=h.grid,n=360*91;
 if(h.version!==1||h.model!==model||h.run!==run||h.hour!==hour||h.level!==level||h.count!==memberCount(model)||h.scale!==100||h.planes!==7||g?.nx!==360||g?.ny!==91||g?.lat0!==90||g?.lon0!==0||g?.dx!==1||g?.dy!==-1||bytes.length!==12+length+n*7*4||!Number.isFinite(Date.parse(h.preparedAt)))throw Error('Prepared data does not match the selected forecast.');
 if(h.source!==(model==='gefs'?'https://noaa-gefs-pds.s3.amazonaws.com':'https://data.ecmwf.int/forecasts'))throw Error('Invalid prepared data source');
 const z=h.zonalWind60N,samples=model==='gefs'?720:1440;
 if(level===10&&(!z||!Number.isFinite(z.value)||z.samples!==samples||z.longitudeStep!==360/samples||z.basis!=='native'))throw Error('Invalid prepared zonal-wind diagnostic');
 const planes:number[][]=[];let offset=12+length;
 for(let p=0;p<7;p++){const values=new Array<number>(n);for(let y=0;y<91;y++){let value=0;for(let x=0;x<360;x++){value+=d.getInt32(offset,true);offset+=4;values[y*360+x]=value/100;}}planes.push(values);}
 if(planes[5].some(v=>v<0)||planes[6].some(v=>v<0))throw Error('Invalid ensemble spread');
 const base={model,run,hour,level,valid:new Date(Date.parse(run)+hour*3600000).toISOString(),grid:g,source:h.source,runKind:'cycle' as const,fetchedAt:new Date().toISOString(),preparedAt:h.preparedAt};
 const mean:Frame={...base,temperature:planes[0],height:planes[1],u:planes[2],v:planes[3],wind:planes[4],ensemble:{view:'mean',count:h.count}};
 const spread:Frame={...mean,temperature:planes[5],wind:planes[6],ensemble:{view:'spread',count:h.count}};
 if(level===10&&h.zonalWind60N){mean.zonalWind60N=h.zonalWind60N;spread.zonalWind60N=h.zonalWind60N;}
 return {mean,spread};
}

export async function preparedPair(model:EnsembleModel,run:string,hour:number,level:number,signal:AbortSignal){
 const runKey=run.slice(0,10).replaceAll('-','')+run.slice(11,13),path=`${runKey}/${level}/${hour}.bin.gz`;
 const manifest=manifests.get(model),entry=manifest?.run===run?manifest.files[`${level}/${hour}`]:undefined;
 // A repeated preparation of the same run has its own content-addressed URL.
 const response=await fetch(root(model)+path+(entry?`?sha=${entry.sha256}`:''),{signal,cache:'force-cache'});
 if(!response.ok)throw Error('This prepared ensemble forecast is unavailable. Refresh for the latest prepared model run.');
 const packed=await response.arrayBuffer();signal.throwIfAborted();
 if(packed.byteLength>2000000)throw Error('Unexpected prepared forecast size');
 if(entry){const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',packed)),v=>v.toString(16).padStart(2,'0')).join('');if(entry.path!==path||entry.bytes!==packed.byteLength||entry.sha256!==digest)throw Error('The prepared forecast failed its integrity check. Please refresh.');}
 const reader=new Blob([packed]).stream().pipeThrough(new DecompressionStream('gzip')).getReader(),chunks:Uint8Array[]=[];let size=0;
 try{while(true){signal.throwIfAborted();const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>1000000)throw Error('Unexpected decompressed forecast size');chunks.push(value);}}finally{await reader.cancel();}
 const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
 signal.throwIfAborted();return decodePrepared(bytes,model,run,hour,level);
}
