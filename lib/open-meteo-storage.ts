// Shared across browser workers and tabs. This cache stores only public weather
// data and request timestamps, and is optional when browser storage is denied.
const name='stratoscope-open-meteo-v1';
type Entry<T>={written:number;expires:number;value:T};
const memory=new Map<string,Entry<unknown>>();
const key=(id:string)=>new Request(`https://stratoscope-cache.invalid/browser-open-meteo/${id}`);
async function cache(){try{return await globalThis.caches?.open(name);}catch{return undefined;}}
export async function readOpenMeteo<T>(id:string):Promise<T|undefined>{
 let entry=memory.get(id) as Entry<T>|undefined;
 try{const hit=await (await cache())?.match(key(id));if(hit){const stored=await hit.json() as Entry<T>;if(!entry||stored.written>=entry.written)entry=stored;}}catch{/* Use memory if storage is unavailable. */}
 if(!entry||entry.expires<=Date.now()){memory.delete(id);return;}
 return entry.value;
}
export async function writeOpenMeteo(id:string,value:unknown,lifetime:number){
 const entry={written:Date.now(),expires:Date.now()+lifetime,value};memory.set(id,entry);if(memory.size>14)memory.delete(memory.keys().next().value!);
 try{
  const store=await cache();if(!store)return;
  await store.put(key(id),Response.json(entry));
  // At most 12 model/level bundles, plus the shared request ledger.
  const keys=await store.keys(),bundles=keys.filter(k=>!k.url.endsWith('/budget'));
  for(const old of bundles.slice(0,Math.max(0,bundles.length-12)))await store.delete(old);
 }catch{/* Successful batches remain usable even without persistent storage. */}
}
type Budget={requests:{at:number;count:number}[];until:number};
const budgetLifetime=86400000;
let lastBudget:Budget={requests:[],until:0};
async function locked<T>(operation:()=>Promise<T>):Promise<T>{
 // Web Locks coordinate ledger changes across tabs and the two decoding workers.
 if(typeof navigator!=='undefined'&&navigator.locks)return navigator.locks.request('stratoscope-open-meteo-budget',operation);
 return operation();
}
export async function reserveOpenMeteoLocations(count:number):Promise<{wait:number;exhausted?:'hourly'|'daily'}>{
 return locked(async()=>{
  const now=Date.now(),budget=await readOpenMeteo<Budget>('budget')??lastBudget;
  budget.requests=budget.requests.filter(r=>r.at>now-budgetLifetime);
  const used=(duration:number)=>budget.requests.filter(r=>r.at>now-duration).reduce((sum,r)=>sum+r.count,0);
  if(used(budgetLifetime)+count>9000)return {wait:0,exhausted:'daily'};
  if(used(3600000)+count>4500)return {wait:0,exhausted:'hourly'};
  if(budget.until>now)return {wait:Math.ceil((budget.until-now)/1000)};
  if(used(60000)+count>480){const first=budget.requests.find(r=>r.at>now-60000)!;return {wait:Math.max(1,Math.ceil((first.at+61000-now)/1000))};}
  budget.requests.push({at:now,count});lastBudget=budget;
  await writeOpenMeteo('budget',budget,budgetLifetime);return {wait:0};
 });
}
export async function pauseOpenMeteo(seconds:number){
 await locked(async()=>{const budget=await readOpenMeteo<Budget>('budget')??lastBudget;budget.until=Math.max(budget.until,Date.now()+seconds*1000);lastBudget=budget;await writeOpenMeteo('budget',budget,budgetLifetime);});
}
