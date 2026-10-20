import {test} from 'node:test';
import assert from 'node:assert/strict';
import {moduleUrl} from './module-fixture.mjs';
import {preparedResponse} from './prepared-fixture.mjs';
const {createForecastMemory,decodedForecastBytes}=await import(await moduleUrl('forecast-memory'));
const tiny=()=>({frame:{temperature:[1,2],height:[3,4],u:[5,6],v:[7,8]}});
test('decoded cache accounts for shared ensemble arrays once and enforces its byte cap',()=>{
 const mean={temperature:[1,2],height:[3,4],u:[5,6],v:[7,8],wind:[9,10]},spread={...mean,temperature:[2,2],wind:[3,3]};
 assert.equal(decodedForecastBytes({frame:mean,pair:{mean,spread}}),2048+7*(2*8+64));
 const size=decodedForecastBytes(tiny()),cache=createForecastMemory(size*2);cache.set('selected',tiny());cache.focus('selected');
 for(let i=0;i<65;i++){cache.set(String(i),tiny());assert.ok(cache.bytes<=cache.maxBytes);}
 assert.ok(cache.peek('selected'));assert.ok(cache.peek('64'));assert.equal(cache.size,2);
 cache.set('oversize',{frame:{temperature:Array(2000).fill(0),height:[],u:[],v:[]}});assert.equal(cache.peek('oversize'),undefined);assert.ok(cache.bytes<=cache.maxBytes);
});
test('thumbnail peeks do not evict a recently used playback frame',()=>{
 const cache=createForecastMemory(decodedForecastBytes(tiny())*2);cache.set('a',tiny());cache.set('b',tiny());cache.get('a');cache.peek('b');cache.set('c',tiny());
 assert.ok(cache.peek('a'));assert.equal(cache.peek('b'),undefined);
});
test('a full selected GEFS sequence cannot pin 119 MB of decoded grids',async()=>{
 const client=await import(await moduleUrl('forecast-client')),original=globalThis.fetch,run='2026-10-07T00:00:00.000Z';let calls=0;
 globalThis.fetch=async url=>{if(!String(url).includes('latest.json'))calls++;return preparedResponse(url)};
 try{
  client.activateForecastSequence('gefs',run,10,-1);client.focusForecast('gefs',run,0,10,-1);
  for(let hour=0;hour<=384;hour+=6){await client.loadForecast('gefs',run,hour,10,-1,new AbortController().signal,()=>{});const usage=client.forecastCacheUsage();assert.ok(usage.bytes<=usage.maxBytes);}
  assert.equal(calls,65);assert.ok(client.forecastCacheUsage().frames<65);assert.ok(client.peekForecast('gefs',run,0,10,-1),'foreground frame stays available');assert.equal(client.peekForecast('gefs',run,6,10,-1),undefined);
 }finally{globalThis.fetch=original;client.clearForecastCache('gefs');}
});
