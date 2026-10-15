/** One request at a time; pause hidden tabs and check promptly on return. */
export function startVisibleRefresh(check:(signal:AbortSignal)=>Promise<void>,interval=300000){
 const lifecycle=new AbortController();let timer:ReturnType<typeof setTimeout>|undefined,busy=false;
 const run=async()=>{
  if(lifecycle.signal.aborted||document.hidden||busy)return;
  clearTimeout(timer);busy=true;
  try{await check(AbortSignal.any([lifecycle.signal,AbortSignal.timeout(60000)]));}
  catch{/* Callers retain their last valid data and report failures. Retry below. */}
  finally{busy=false;if(!lifecycle.signal.aborted)timer=setTimeout(run,interval);}
 };
 const visibility=()=>{clearTimeout(timer);if(!document.hidden)void run();};
 document.addEventListener('visibilitychange',visibility);void run();
 return()=>{lifecycle.abort();clearTimeout(timer);document.removeEventListener('visibilitychange',visibility)};
}
