import type {ForecastResult} from './forecast-client';
// Public decoded weather fields only. One run per model; all levels and member
// selections share that run. IndexedDB survives model switches and page reloads.
let opening:Promise<IDBDatabase|null>|undefined;
function database(){
 if(!globalThis.indexedDB)return Promise.resolve(null);
 return opening??=new Promise(resolve=>{
  let settled=false;
  const finish=(db:IDBDatabase|null)=>{if(settled){db?.close();return;}settled=true;clearTimeout(timer);resolve(db)};
  const timer=setTimeout(()=>finish(null),2000);
  try{const request=indexedDB.open('stratoscope-forecast-v1',1);
   request.onupgradeneeded=()=>{const db=request.result;db.createObjectStore('runs');db.createObjectStore('frames',{keyPath:'key'}).createIndex('model','model')};
   request.onsuccess=()=>{request.result.onversionchange=()=>{request.result.close();opening=undefined};finish(request.result)};
   request.onerror=request.onblocked=()=>finish(null);
  }catch{finish(null)}
 });
}
export const hasForecastStorage=()=>!!globalThis.indexedDB;
const key=(model:string,run:string,hour:number,level:number,member:number)=>`${model}/${run}/${level}/${hour}/${member}`;
export async function readStoredForecast(model:string,run:string,hour:number,level:number,member:number):Promise<ForecastResult|undefined>{
 try{const db=await database();if(!db)return;
  return await new Promise<ForecastResult|undefined>(resolve=>{
   const tx=db.transaction('frames','readonly'),r=tx.objectStore('frames').get(key(model,run,hour,level,member));
   r.onsuccess=()=>{const value=r.result?.value as ForecastResult|undefined;
    const f=value?.frame;
    resolve(f?.model===model&&f.run===run&&f.hour===hour&&f.level===level?value:undefined)};
   r.onerror=()=>resolve(undefined);tx.onabort=()=>resolve(undefined);
  });
 }catch{return undefined}
}
export async function writeStoredForecast(model:string,run:string,hour:number,level:number,member:number,value:ForecastResult){
 try{const db=await database();if(!db)return;
  await new Promise<void>(resolve=>{
   const tx=db.transaction(['runs','frames'],'readwrite'),runs=tx.objectStore('runs'),frames=tx.objectStore('frames'),r=runs.get(model);
   tx.oncomplete=()=>resolve();tx.onabort=tx.onerror=()=>resolve();
   r.onsuccess=()=>{
    const previous=r.result as string|undefined;
    // An old in-flight request must not replace a newer model cycle.
    if(previous&&Date.parse(previous)>Date.parse(run))return;
    if(previous!==run){
     const cursor=frames.index('model').openCursor(IDBKeyRange.only(model));
     cursor.onsuccess=()=>{const c=cursor.result;if(c){if(c.value.run!==run)c.delete();c.continue()}};
     runs.put(run,model);
    }
    frames.put({key:key(model,run,hour,level,member),model,run,value});
   };
  });
 }catch{/* Denied storage or quota exhaustion never discards a usable download. */}
}
export async function clearStoredForecast(model:string){
 try{const db=await database();if(!db)return;
  await new Promise<void>(resolve=>{
   const tx=db.transaction(['runs','frames'],'readwrite');tx.oncomplete=()=>resolve();tx.onabort=tx.onerror=()=>resolve();
   tx.objectStore('runs').delete(model);
   const r=tx.objectStore('frames').index('model').openCursor(IDBKeyRange.only(model));
   r.onsuccess=()=>{const c=r.result;if(c){c.delete();c.continue()}};
  });
 }catch{/* Optional browser storage. */}
}
