import {test,afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import ts from 'typescript';

// Load the browser modules without a browser, bundler, or upstream weather requests.
async function moduleUrl(name){
 let source=await readFile(new URL(`../lib/${name}.ts`,import.meta.url),'utf8');
 for(const dependency of ['models','ensemble-statistics','shared-download','zonal-wind']){
  if(source.includes(`from './${dependency}'`))source=source.replace(`from './${dependency}'`,`from '${await moduleUrl(dependency)}'`);
 }
 const {outputText}=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}});
 return 'data:text/javascript;base64,'+Buffer.from(outputText).toString('base64');
}
const {loadForecast,peekForecast,clearForecastCache}=await import(await moduleUrl('forecast-client'));
const originalFetch=globalThis.fetch,run='2026-10-07T00:00:00.000Z';
const controller=()=>new AbortController(),pause=()=>new Promise(resolve=>setTimeout(resolve,10));
const request=(hour=0,signal=controller().signal,model='ecmwf_direct',member=-1)=>loadForecast(model,run,hour,10,member,signal,()=>{});
const frame=(url)=>{const q=new URL(url,'https://test.invalid').searchParams,model=q.get('model'),hour=Number(q.get('hour'));return {model,run:q.get('run'),hour,level:Number(q.get('level')),valid:new Date(Date.parse(run)+hour*3600000).toISOString(),grid:{nx:1,ny:1,lat0:90,lon0:0,dx:1,dy:-1},temperature:[-60],height:[31000],u:[10],v:[20],...(model==='ifs_ens'?{ensemble:{view:'member',member:Number(q.get('member')),count:51}}:{})};};
afterEach(()=>{globalThis.fetch=originalFetch;for(const model of ['ecmwf_direct','ifs_ens','ecmwf'])clearForecastCache(model);});

test('a selected forecast joins a preload without a second fetch',async()=>{
 let calls=0,release,upstream;
 globalThis.fetch=async(url,{signal})=>{calls++;upstream=signal;await new Promise(resolve=>release=resolve);return Response.json(frame(url));};
 const preloader=controller(),first=request(6,preloader.signal);await Promise.resolve();
 preloader.abort();const foreground=request(6);release();
 await assert.rejects(first,{name:'AbortError'});assert.equal((await foreground).frame.hour,6);
 assert.equal(calls,1);assert.equal(upstream.aborted,false);
 assert.equal(peekForecast('ecmwf_direct',run,6,10,-1).frame.hour,6);
 await request(6);assert.equal(calls,1);
});
test('abandoned downloads stop and do not poison later retries',async()=>{
 let calls=0,aborted=false;
 globalThis.fetch=async(url,{signal})=>{calls++;if(calls===1)return new Promise((resolve,reject)=>signal.addEventListener('abort',()=>{aborted=true;reject(signal.reason);},{once:true}));return Response.json(frame(url));};
 const c=controller(),job=request(12,c.signal);await Promise.resolve();c.abort();
 await assert.rejects(job,{name:'AbortError'});await pause();assert.equal(aborted,true);
 assert.equal((await request(12)).frame.hour,12);assert.equal(calls,2);
});
test('refresh discards completed forecasts',async()=>{
 let calls=0;globalThis.fetch=async url=>{calls++;return Response.json(frame(url));};
 await request();clearForecastCache('ecmwf_direct');assert.equal(peekForecast('ecmwf_direct',run,0,10,-1),undefined);
 await request();assert.equal(calls,2);
});
test('refresh aborts an in-flight forecast before starting a fresh one',async()=>{
 let calls=0;globalThis.fetch=async(url,{signal})=>{calls++;if(calls===1)return new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(signal.reason),{once:true}));return Response.json(frame(url));};
 const job=request();await Promise.resolve();clearForecastCache('ecmwf_direct');
 await assert.rejects(job,{name:'AbortError'});await request();assert.equal(calls,2);
});
test('wrong-time responses and failed preloads are never cached',async()=>{
 let calls=0;globalThis.fetch=async url=>{calls++;return calls===1?Response.json({error:'Try later'},{status:502}):Response.json({...frame(url),hour:99});};
 await assert.rejects(request(18),/Try later/);await assert.rejects(request(18),/different forecast/);
 assert.equal(peekForecast('ecmwf_direct',run,18,10,-1),undefined);
});
test('fixed-cycle cache lasts across navigation, rolling data still expires in 15 minutes',async()=>{
 const now=Date.now;let clock=now(),calls=0;Date.now=()=>clock;
 globalThis.fetch=async url=>{calls++;return Response.json(frame(url));};
 try{await request();await request(0,controller().signal,'ecmwf');clock+=16*60000;
  await request();assert.equal(calls,2);await request(0,controller().signal,'ecmwf');assert.equal(calls,3);
  clock+=6*3600000;assert.equal(peekForecast('ecmwf_direct',run,0,10,-1),undefined);
 }finally{Date.now=now;}
});
test('ensemble mean and spread reuse a complete 51-member result with bounded concurrency',async()=>{
 let calls=0,active=0,maxActive=0;globalThis.fetch=async url=>{calls++;active++;maxActive=Math.max(maxActive,active);await Promise.resolve();active--;return Response.json(frame(url));};
 const first=await request(24,controller().signal,'ifs_ens');
 assert.equal(calls,51);assert.ok(maxActive<=2);assert.equal(first.pair.mean.ensemble.count,51);
 const cached=peekForecast('ifs_ens',run,24,10,-1);assert.equal(cached.pair.spread.temperature[0],0);
 await request(24,controller().signal,'ifs_ens');assert.equal(calls,51);
});
