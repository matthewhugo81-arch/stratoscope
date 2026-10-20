type Selection={hour:number;direction:number;paused:boolean};
type Options={
 maxHour:number;concurrency:number;signal:AbortSignal;
 selection:()=>Selection;hasFrame:(hour:number)=>boolean;load:(hour:number)=>Promise<unknown>;
 onProgress:()=>void;onBusy:(busy:boolean)=>void;retryDelays?:readonly number[];windowFrames?:number;
};

// Fill free download slots immediately, with the selected/next times first.
// A moving window avoids downloading and decoding a large timeline up front.
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
  let hours=Array.from({length:maxHour/6+1},(_,i)=>i*6);
  const distance=(h:number)=>(current.direction*(h-current.hour)+maxHour+6)%(maxHour+6);
  hours.sort((a,b)=>distance(a)-distance(b));
  if(options.windowFrames!==undefined)hours=hours.slice(0,Math.max(1,Math.floor(options.windowFrames)));
  hours=hours.filter(h=>!hasFrame(h)&&!active.has(h));
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
  if(active.size===0){
   if(options.windowFrames!==undefined)schedule(Math.min(250,Math.max(0,retryAt-Date.now())));
   else if(Number.isFinite(retryAt))schedule(Math.max(0,retryAt-Date.now()));
  }
 }
 signal.addEventListener('abort',stop,{once:true});
 pump();
 return stop;
}
