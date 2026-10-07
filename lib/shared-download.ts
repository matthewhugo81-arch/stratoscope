// A foreground request can take over an in-flight preload without downloading twice.
export function sharedDownloads<T>() {
 const pending=new Map<string,{controller:AbortController;promise:Promise<T>;users:number;timer?:ReturnType<typeof setTimeout>}>();
 return {
  clear(prefix:string){for(const [key,task] of pending)if(key.startsWith(prefix)){task.controller.abort();pending.delete(key);}},
  get(key:string,signal:AbortSignal,download:(signal:AbortSignal)=>Promise<T>):Promise<T>{
   signal.throwIfAborted();
   let task=pending.get(key);
   if(!task){
    const controller=new AbortController();
    task={controller,users:0,promise:Promise.resolve().then(()=>download(controller.signal))};
    const current=task;pending.set(key,current);
    const remove=()=>{if(pending.get(key)===current)pending.delete(key);};
    void current.promise.then(remove,remove);
   }
   const current=task;clearTimeout(current.timer);current.users++;
   return new Promise<T>((resolve,reject)=>{
    let finished=false;
    const finish=(error:unknown,value?:T)=>{
     if(finished)return;finished=true;signal.removeEventListener('abort',abort);
     current.users--;
     // Allow React effect cleanup/setup to transfer ownership in the same turn.
     if(!current.users)current.timer=setTimeout(()=>{if(pending.get(key)===current&&!current.users){pending.delete(key);current.controller.abort();}},0);
     if(error!==undefined)reject(error);else resolve(value!);
    };
    const abort=()=>finish(signal.reason??new DOMException('Aborted','AbortError'));
    signal.addEventListener('abort',abort,{once:true});
    current.promise.then(value=>finish(undefined,value),error=>finish(error));
   });
  }
 };
}
