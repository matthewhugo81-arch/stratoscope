type Selection={hour:number;direction:number;paused:boolean;windowFrames?:number};
type Options={
 maxHour:number;concurrency:number;signal:AbortSignal;
 selection:()=>Selection;hasFrame:(hour:number)=>boolean;load:(hour:number)=>Promise<unknown>;
 onProgress:()=>void;onBusy:(busy:boolean)=>void;retryDelays?:readonly number[];
};

// Fill free download slots immediately, with the selected/next times first.
// One failed time must not strand the rest of an otherwise complete timeline.
export function preloadTimeline(options:Options){
 const {maxHour,signal,selection,hasFrame,load,onProgress,onBusy}=options;
 const concurrency=Math.max(1,Math.min(4,options.concurrency)),retryDelays=options.retryDelays??[1000,4000];
 const active=new Set<number>(),failures=new Map<number,{attempts:number;after:number}>();
 let timer:ReturnType<typeof setTimeout>|undefined,stopped=false;
 const stop=()=>{stopped=true;clearTimeout(timer);signal.removeEventListener('abort',stop);onBusy(false)};
 const schedule=(delay:number)=>{clearTimeout(timer);timer=setTimeout(pump,delay)};
 function pump(){
  if(stopped||signal.aborted)return;
  const current=selection();
  if(current.paused){onBusy(active.size>0);schedule(100);return;}
  const nearby=(h:number)=>current.windowFrames===undefined||Math.abs(h-current.hour)<=12||(current.direction*(h-current.hour)+maxHour+6)%(maxHour+6)<=current.windowFrames*6;
  const hours=Array.from({length:maxHour/6+1},(_,i)=>i*6).filter(h=>nearby(h)&&!hasFrame(h)&&!active.has(h));
  const distance=(h:number)=>(current.direction*(h-current.hour)+maxHour+6)%(maxHour+6);
  hours.sort((a,b)=>distance(a)-distance(b));
  let retryAt=Infinity;
  for(const hour of hours){
   const failure=failures.get(hour);
   if(failure&&failure.attempts>retryDelays.length)continue;
   if(failure&&failure.after>Date.now()){retryAt=Math.min(retryAt,failure.after);continue;}
   if(active.size>=concurrency)break;
   active.add(hour);
   void Promise.resolve().then(()=>{signal.throwIfAborted();return load(hour)}).then(()=>{
    if(!stopped&&!signal.aborted){failures.delete(hour);onProgress();}
   },()=>{
    const attempts=(failures.get(hour)?.attempts??0)+1;
    failures.set(hour,{attempts,after:Date.now()+(retryDelays[attempts-1]??Infinity)});
   }).finally(()=>{active.delete(hour);if(!stopped&&!signal.aborted)pump()});
  }
  onBusy(active.size>0);
  if(active.size===0&&Number.isFinite(retryAt))schedule(Math.max(0,retryAt-Date.now()));
  else if(active.size===0&&current.windowFrames!==undefined)schedule(250);
 }
 signal.addEventListener('abort',stop,{once:true});
 pump();
 return stop;
}
