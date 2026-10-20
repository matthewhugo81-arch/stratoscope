import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {indexedDB,IDBKeyRange} from 'fake-indexeddb';
import ts from 'typescript';
import {preparedResponse} from './prepared-fixture.mjs';
globalThis.indexedDB=indexedDB;globalThis.IDBKeyRange=IDBKeyRange;
async function moduleUrl(name,suffix=''){
 let source=await readFile(new URL(`../lib/${name}.ts`,import.meta.url),'utf8');
 for(const dep of ['forecast-revision','forecast-memory','dwd','models','prepared-ensembles','shared-download','zonal-wind','forecast-transport','forecast-storage'])
  if(source.includes(`from './${dep}'`))source=source.replace(`from './${dep}'`,`from '${await moduleUrl(dep)}'`);
 const {outputText}=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}});
 return 'data:text/javascript;base64,'+Buffer.from(outputText+'\n// '+suffix).toString('base64');
}
const storage=await import(await moduleUrl('forecast-storage'));
const run='2026-10-07T00:00:00.000Z';
const make=(model,run,hour)=>({model,run,hour,level:10,valid:new Date(Date.parse(run)+hour*3600000).toISOString(),grid:{nx:1,ny:1,lat0:60,lon0:0,dx:1,dy:-1},temperature:[-60],height:[31000],u:[12],v:[3]});
test('a whole downloaded loop survives model switching and a fresh client instance',async()=>{
 const client=await import(await moduleUrl('forecast-client','first'));
 const original=globalThis.fetch;let calls=0;
 globalThis.fetch=async url=>{calls++;const q=new URL(url,'https://test.invalid').searchParams;return Response.json(make(q.get('model'),q.get('run'),Number(q.get('hour'))))};
 const load=(c,model,hour)=>c.loadForecast(model,run,hour,10,-1,new AbortController().signal,()=>{});
 try{
  client.activateForecastSequence('gfs',run,10,-1);
  for(let h=0;h<=240;h+=6)await load(client,'gfs',h);
  client.activateForecastSequence('ecmwf_direct',run,10,-1);await load(client,'ecmwf_direct',0);
  const downloaded=calls;client.activateForecastSequence('gfs',run,10,-1);
  for(let h=0;h<=240;h+=6)assert.equal((await load(client,'gfs',h)).frame.hour,h);
  assert.equal(calls,downloaded,'returning to model must not download evicted frames');
  const fresh=await import(await moduleUrl('forecast-client','reload'));
  fresh.activateForecastSequence('gfs',run,10,-1);
  for(let h=0;h<=240;h+=6)await load(fresh,'gfs',h);
  assert.equal(calls,downloaded,'reload must reuse disk data');
 }finally{globalThis.fetch=original;await storage.clearStoredForecast('gfs');await storage.clearStoredForecast('ecmwf_direct')}
});
test('only the newest run is retained per model, including late old writes',async()=>{
 const newer='2026-10-07T12:00:00.000Z';
 await storage.writeStoredForecast('gfs',run,0,10,-1,{frame:make('gfs',run,0)});
 await storage.writeStoredForecast('icon',run,0,10,-1,{frame:make('icon',run,0)});
 await storage.writeStoredForecast('gfs',newer,6,10,-1,{frame:make('gfs',newer,6)});
 await storage.writeStoredForecast('gfs',run,12,10,-1,{frame:make('gfs',run,12)});
 assert.equal(await storage.readStoredForecast('gfs',run,0,10,-1),undefined);
 assert.equal(await storage.readStoredForecast('gfs',run,12,10,-1),undefined);
 assert.ok(await storage.readStoredForecast('gfs',newer,6,10,-1));
 assert.ok(await storage.readStoredForecast('icon',run,0,10,-1));
 await storage.clearStoredForecast('gfs');await storage.clearStoredForecast('icon');
 assert.equal(await storage.readStoredForecast('gfs',newer,6,10,-1),undefined);
});
test('prepared ensemble mean and spread survive reload as a pair',async()=>{
 const original=globalThis.fetch;let calls=0;globalThis.fetch=async url=>{if(!String(url).includes('latest.json'))calls++;return preparedResponse(url)};
 try{
  const c=await import(await moduleUrl('forecast-client','ensemble-first'));
  const first=await c.loadForecast('ifs_ens',run,24,10,-1,new AbortController().signal,()=>{});
  const fresh=await import(await moduleUrl('forecast-client','ensemble-reload'));
  const restored=await fresh.loadForecast('ifs_ens',run,24,10,-1,new AbortController().signal,()=>{});
  assert.equal(calls,1);assert.deepEqual(restored.pair,first.pair);
 }finally{globalThis.fetch=original;await storage.clearStoredForecast('ifs_ens')}
});
test('playback through byte-evicted decoded frames reuses persistent downloads',async()=>{
 const originalFetch=globalThis.fetch,descriptor=Object.getOwnPropertyDescriptor(navigator,'deviceMemory');let downloads=0;
 Object.defineProperty(navigator,'deviceMemory',{configurable:true,value:2});
 const client=await import(await moduleUrl('forecast-client','small memory playback'));
 globalThis.fetch=async url=>{downloads++;const q=new URL(url,'https://test.invalid').searchParams;return Response.json({...make('gfs',run,Number(q.get('hour'))),grid:{nx:360,ny:91,lat0:90,lon0:0,dx:1,dy:-1},temperature:Array(32760).fill(-60),height:Array(32760).fill(31000),u:Array(32760).fill(12),v:Array(32760).fill(3)})};
 const load=hour=>client.loadForecast('gfs',run,hour,10,-1,new AbortController().signal,()=>{});
 try{
  client.activateForecastSequence('gfs',run,10,-1);
  for(let hour=0;hour<=180;hour+=6)await load(hour);
  assert.equal(client.peekForecast('gfs',run,0,10,-1),undefined,'old decoded frames really were evicted');assert.ok(client.forecastCacheUsage().bytes<=24*1024*1024);
  for(let hour=0;hour<=180;hour+=6)assert.equal((await load(hour)).frame.hour,hour);
  assert.equal(downloads,31,'a deliberate second loop must use IndexedDB after decoded eviction');
 }finally{globalThis.fetch=originalFetch;if(descriptor)Object.defineProperty(navigator,'deviceMemory',descriptor);else delete navigator.deviceMemory;await storage.clearStoredForecast('gfs');}
});
