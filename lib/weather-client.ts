import type {Frame} from './grib';
import type {ForecastMeta} from './models';
type Slot={worker:Worker|null;busy:boolean};
type Job={query:string;signal:AbortSignal;resolve:(v:Frame|ForecastMeta)=>void;reject:(e:unknown)=>void;cancel:()=>void;slot?:Slot};
const slots:Slot[]=[{worker:null,busy:false},{worker:null,busy:false}],queue:Job[]=[];
function drain(){
 for(const slot of slots){
  if(slot.busy)continue;const job=queue.shift();if(!job)break;
  if(job.signal.aborted){job.cancel();continue;}
  slot.busy=true;job.slot=slot;
  const finish=()=>{job.signal.removeEventListener('abort',job.cancel);job.slot=undefined;slot.busy=false;drain();};
  try{
   const worker=slot.worker??=new Worker(new URL('./weather.worker.ts',import.meta.url),{type:'module'});
   worker.onmessage=({data})=>{if(data.ok)job.resolve(data.data);else job.reject(Object.assign(Error(data.data.error),{retryAfter:data.data.retryAfter}));finish();};
   worker.onerror=()=>{worker.terminate();slot.worker=null;job.reject(Error('Weather processing could not start. Please reload.'));finish();};
   worker.postMessage(job.query);
  }catch(e){slot.worker?.terminate();slot.worker=null;job.reject(e);finish();}
 }
}
export function requestWeather(query:string,signal:AbortSignal):Promise<Frame|ForecastMeta>{
 return new Promise((resolve,reject)=>{
  signal.throwIfAborted();
  const job:Job={query,signal,resolve,reject,cancel:()=>{
   const i=queue.indexOf(job);if(i>=0)queue.splice(i,1);
   if(job.slot){job.slot.worker?.terminate();job.slot.worker=null;job.slot.busy=false;job.slot=undefined;}
   signal.removeEventListener('abort',job.cancel);reject(signal.reason??new DOMException('Cancelled','AbortError'));drain();
  }};
  signal.addEventListener('abort',job.cancel,{once:true});queue.push(job);drain();
 });
}
