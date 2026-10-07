import type {Frame} from './grib';
import type {ForecastMeta} from './models';
const ROOT='https://raw.githubusercontent.com/matthewhugo81-arch/stratoscope/forecast-data-icon/';
const SOURCE='https://opendata.dwd.de/weather/nwp/icon/grib';
const LEVELS=[30,50,70,100];
type Manifest={version:number;model:string;run:string;maxHour:number;levels:number[];step:number;complete:boolean;preparedAt:string;files:Record<string,{path:string;bytes:number;sha256:string}>};
let manifest:Manifest|undefined;
export function validateIconManifest(m:Manifest){
 if(m.version!==1||m.model!=='icon'||!m.complete||m.maxHour!==180||m.step!==6||JSON.stringify(m.levels)!==JSON.stringify(LEVELS)||!/^\d{4}-\d{2}-\d{2}T(00|12):00:00\.000Z$/.test(m.run)||!Number.isFinite(Date.parse(m.run))||!Number.isFinite(Date.parse(m.preparedAt)))throw Error('The prepared DWD ICON catalogue is incomplete.');
 const key=m.run.slice(0,10).replaceAll('-','')+m.run.slice(11,13);
 for(const level of LEVELS)for(let hour=0;hour<=180;hour+=6){const f=m.files?.[`${level}/${hour}`];if(!f||f.path!==`${key}/${level}/${hour}.json.gz`||!Number.isInteger(f.bytes)||f.bytes<1||f.bytes>2000000||!/^[a-f0-9]{64}$/.test(f.sha256))throw Error('DWD ICON catalogue has missing forecast times.');}
 return m;
}
export async function iconMeta(signal:AbortSignal):Promise<ForecastMeta>{
 const response=await fetch(ROOT+'latest.json',{signal,cache:'no-cache'});
 if(!response.ok)throw Error('Prepared DWD ICON maps are unavailable. Please retry shortly.');
 manifest=validateIconManifest(await response.json());
 return {model:'icon',run:manifest.run,maxHour:180,levels:LEVELS,step:6,runKind:'cycle',fetchedAt:manifest.preparedAt};
}
export function validateIconFrame(f:Frame,run:string,hour:number,level:number){
 const g=f.grid;
 if(f.model!=='icon'||f.run!==run||f.hour!==hour||f.level!==level||!LEVELS.includes(level)||hour<0||hour>180||hour%6||f.valid!==new Date(Date.parse(run)+hour*3600000).toISOString()||f.source!==SOURCE||f.runKind!=='cycle'||f.ensemble||f.zonalWind60N||!f.preparedAt||!Number.isFinite(Date.parse(f.preparedAt))||g?.nx!==360||g?.ny!==91||g?.lat0!==90||g?.lon0!==0||g?.dx!==1||g?.dy!==-1)throw Error('DWD ICON data does not match the selected forecast.');
 for(const key of ['temperature','height','u','v'] as const)if(!Array.isArray(f[key])||f[key].length!==360*91||!f[key].every(Number.isFinite))throw Error('Incomplete DWD ICON field.');
 return {...f,fetchedAt:new Date().toISOString()};
}
export async function iconFrame(run:string,hour:number,level:number,signal:AbortSignal):Promise<Frame>{
 if(!manifest)await iconMeta(signal);
 const entry=manifest?.run===run?manifest.files[`${level}/${hour}`]:undefined;
 if(!entry)throw Error('This DWD run has changed. Refresh for the latest complete forecast.');
 const response=await fetch(ROOT+entry.path+'?sha='+entry.sha256,{signal,cache:'force-cache'});
 if(!response.ok)throw Error('This prepared DWD forecast is unavailable. Please refresh.');
 const packed=await response.arrayBuffer();signal.throwIfAborted();
 if(packed.byteLength!==entry.bytes||packed.byteLength>2000000)throw Error('Incomplete DWD forecast download.');
 const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',packed)),v=>v.toString(16).padStart(2,'0')).join('');
 if(digest!==entry.sha256)throw Error('DWD forecast failed its integrity check.');
 const reader=new Blob([packed]).stream().pipeThrough(new DecompressionStream('gzip')).getReader();const chunks:Uint8Array[]=[];let size=0;
 try{while(true){signal.throwIfAborted();const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>4000000)throw Error('Unexpected DWD forecast size.');chunks.push(value);}}finally{await reader.cancel();}
 const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
 signal.throwIfAborted();return validateIconFrame(JSON.parse(new TextDecoder().decode(bytes)),run,hour,level);
}
