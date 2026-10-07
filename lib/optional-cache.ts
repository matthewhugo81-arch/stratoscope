// Some hosted Workers expose CacheStorage but throw when .default is read.
// Cache access, lookup, decoding and writes must all remain optional; callers
// retain their bounded memory caches and can fetch directly from the provider.
function defaultCache(){
 return (globalThis as unknown as {caches?:{default?:Cache}}).caches?.default;
}

export async function readCachedJson<T>(key:Request):Promise<T|undefined>{
 try{
  const hit=await defaultCache()?.match(key);
  return hit?await hit.json() as T:undefined;
 }catch{return undefined;}
}

export async function writeCachedJson(key:Request,value:unknown,maxAge:number):Promise<void>{
 try{
  const cache=defaultCache();
  if(cache)await cache.put(key,Response.json(value,{headers:{'Cache-Control':`public, max-age=${maxAge}`}}));
 }catch{
  // A cache failure must never discard a successful forecast download.
 }
}
