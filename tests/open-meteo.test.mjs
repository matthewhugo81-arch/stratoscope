import {test,afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import ts from 'typescript';
let instance=0;
async function moduleUrl(name,seed){
 let source=await readFile(new URL(`../lib/${name}.ts`,import.meta.url),'utf8');
 for(const dependency of ['models','optional-cache','open-meteo-storage'])if(source.includes(`from './${dependency}'`))source=source.replace(`from './${dependency}'`,`from '${await moduleUrl(dependency,seed)}'`);
 return 'data:text/javascript;base64,'+Buffer.from(ts.transpileModule(source+`\n// Worker ${seed}`,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText).toString('base64');
}
const fresh=async name=>import(await moduleUrl(name,instance++));
const originalFetch=globalThis.fetch,originalCaches=Object.getOwnPropertyDescriptor(globalThis,'caches'),originalNow=Date.now;
let clock=Date.parse('2026-10-07T13:00:00Z');
function storage(){
 const values=new Map();
 Object.defineProperty(globalThis,'caches',{configurable:true,value:{open:async()=>({match:async k=>values.get(k.url)?.clone(),put:async(k,v)=>{values.set(k.url,v.clone());},keys:async()=>[...values.keys()].map(k=>new Request(k)),delete:async k=>values.delete(k.url)})}});
 Date.now=()=>clock;return values;
}
afterEach(()=>{globalThis.fetch=originalFetch;Date.now=originalNow;if(originalCaches)Object.defineProperty(globalThis,'caches',originalCaches);else delete globalThis.caches;clock=Date.parse('2026-10-07T13:00:00Z');});
const run='2026-10-07T00:00:00.000Z';
function response(url){
 const q=new URL(url).searchParams,variables=q.get('hourly').split(','),lat=q.get('latitude').split(',').map(Number);
 const time=Array.from({length:41},(_,i)=>new Date(Date.parse(run)+i*6*3600000).toISOString().slice(0,16));
 return Response.json(lat.map(latitude=>({latitude,longitude:0,hourly_units:Object.fromEntries(variables.map((v,i)=>[v,['°C','m','m/s','°'][i]])),hourly:{time,...Object.fromEntries(variables.map((v,i)=>[v,time.map(()=>[-60+latitude/100,30000,10,90][i])]))}})));
}
test('shared request pacing counts locations across worker restarts and model switches',async()=>{
 storage();const first=await fresh('open-meteo-storage');
 for(let i=0;i<6;i++)assert.equal((await first.reserveOpenMeteoLocations(60)).wait,0);
 const second=await fresh('open-meteo-storage');
 for(let i=0;i<2;i++)assert.equal((await second.reserveOpenMeteoLocations(60)).wait,0);
 assert.equal((await second.reserveOpenMeteoLocations(60)).wait,61);
 clock+=61000;assert.equal((await first.reserveOpenMeteoLocations(60)).wait,0);
 await first.pauseOpenMeteo(120);assert.equal((await second.reserveOpenMeteoLocations(60)).wait,120);
});
test('saved partial hemisphere resumes in a new worker, and the whole timeline survives reload',async()=>{
 storage();let calls=0,firstLat=[];
 globalThis.fetch=async url=>{calls++;firstLat.push(new URL(url).searchParams.get('latitude').split(',')[0]);if(calls===2)return Response.json({reason:'Minutely API request limit exceeded'},{status:429,headers:{'Retry-After':'90'}});return response(url);};
 const a=await fresh('open-meteo');await assert.rejects(a.openMeteoFrame('gfs_om',run,50,0),e=>e.retryAfter===90);assert.equal(calls,2);
 clock+=91000;const b=await fresh('open-meteo');const frame=await b.openMeteoFrame('gfs_om',run,50,168);
 assert.equal(calls,7);assert.equal(firstLat[2],'10'); // Offset 60, not offset zero.
 assert.equal(frame.temperature.length,360);assert.equal(frame.temperature[0],-60);assert.equal(frame.temperature[359],-59.1);assert.equal(frame.u[0],-10);
 const c=await fresh('open-meteo');assert.equal((await c.openMeteoFrame('gfs_om',run,50,240)).hour,240);assert.equal(calls,7);
});
test('cache and hourly budgets expire, without silently downloading beyond the budget',async()=>{
 storage();const m=await fresh('open-meteo-storage');
 await m.writeOpenMeteo('example',{ok:true},1000);assert.equal((await m.readOpenMeteo('example')).ok,true);
 clock+=1001;assert.equal(await m.readOpenMeteo('example'),undefined);
 for(let minute=0;minute<10;minute++){for(let i=0;i<7;i++)assert.equal((await m.reserveOpenMeteoLocations(60)).wait,0);clock+=61000;}
 for(let i=0;i<5;i++)assert.equal((await m.reserveOpenMeteoLocations(60)).wait,0);
 assert.equal((await m.reserveOpenMeteoLocations(60)).exhausted,'hourly');
 clock+=3600000;assert.equal((await m.reserveOpenMeteoLocations(60)).wait,0);
});
test('denied browser storage still permits forecast loading and in-worker reuse',async()=>{
 Object.defineProperty(globalThis,'caches',{configurable:true,get(){throw Error('Storage denied');}});Date.now=()=>clock;
 let calls=0;globalThis.fetch=async url=>{calls++;return response(url);};
 const m=await fresh('open-meteo');await m.openMeteoFrame('gfs_om',run,50,0);await m.openMeteoFrame('gfs_om',run,50,6);assert.equal(calls,6);
});
