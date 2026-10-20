import {test,afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {gzipSync} from 'node:zlib';
import {indexedDB,IDBKeyRange} from 'fake-indexeddb';
import {moduleUrl} from './module-fixture.mjs';
import {preparedFixture,run} from './prepared-fixture.mjs';
globalThis.indexedDB=indexedDB;globalThis.IDBKeyRange=IDBKeyRange;
const client=await import(await moduleUrl('forecast-client'));
const storage=await import(await moduleUrl('forecast-storage'));
const {preparedMeta,clearPreparedManifest}=await import(await moduleUrl('prepared-ensembles'));
const {iconMeta}=await import(await moduleUrl('dwd'));
const original=globalThis.fetch,signal=()=>new AbortController().signal;
const load=(c=client,model='ifs_ens',level=10)=>c.loadForecast(model,run,0,level,-1,signal(),()=>{});
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
function catalogue(bytes,{model='ifs_ens',preparedAt=run}={}){
 const levels=model==='icon'?[30,50,70,100]:[10,50,100],maxHour=model==='icon'?180:360,files={};
 for(const level of levels)for(let hour=0;hour<=maxHour;hour+=6)files[`${level}/${hour}`]={path:`2026100700/${level}/${hour}.${model==='icon'?'json':'bin'}.gz`,bytes:bytes.length,sha256:sha(bytes)};
 return {version:1,model,run,maxHour,step:6,count:51,levels,complete:true,preparedAt,files};
}
function correction(){
 const f=preparedFixture('ifs_ens',0,10,{preparedAt:'2026-10-07T11:00:00Z',zonalWind60N:{value:-8,samples:1440,longitudeStep:.25,basis:'native'}});
 f.bytes.writeInt32LE(-5000,12+f.bytes.readUInt32LE(8));return gzipSync(f.bytes);
}
afterEach(async()=>{globalThis.fetch=original;for(const model of ['ifs_ens','icon']){client.clearForecastCache(model);clearPreparedManifest(model);await storage.clearStoredForecast(model);}});
test('same-cycle corrected content replaces memory, wind and IndexedDB results after a catalogue refresh',async()=>{
 const first=preparedFixture().packed,corrected=correction(),blobs=new Map([[sha(first),first],[sha(corrected),corrected]]);let current=catalogue(first),downloads=0;
 globalThis.fetch=async url=>{const u=new URL(url);if(u.pathname.endsWith('latest.json'))return Response.json(current);downloads++;return new Response(blobs.get(u.searchParams.get('sha')))};
 const before=await preparedMeta('ifs_ens',signal());client.activateForecastSequence('ifs_ens',run,10,-1);
 assert.equal((await load()).frame.temperature[0],-60);assert.equal(client.peekForecastZonal('ifs_ens',run,0,-1).value,-4.5678);
 current=catalogue(corrected,{preparedAt:'2026-10-07T11:00:00Z'});const after=await preparedMeta('ifs_ens',signal());assert.notEqual(before.revision,after.revision);
 assert.equal(client.peekForecast('ifs_ens',run,0,10,-1),undefined);assert.equal(client.peekForecastZonal('ifs_ens',run,0,-1),undefined);
 const fresh=await import(await moduleUrl('forecast-client','corrected reload'));fresh.activateForecastSequence('ifs_ens',run,10,-1);
 const changed=await load(fresh);assert.equal(changed.frame.temperature[0],-50);assert.equal(changed.frame.preparedAt,'2026-10-07T11:00:00Z');assert.equal(fresh.peekForecastZonal('ifs_ens',run,0,-1).value,-8);assert.equal(downloads,2);
 const restored=await load();assert.equal(restored.frame.temperature[0],-50);assert.equal(downloads,2,'corrected disk data is reusable without another download');
});
test('a check timestamp or JSON key order change does not invalidate unchanged file content',async()=>{
 const packed=preparedFixture().packed;let current=catalogue(packed),downloads=0;
 globalThis.fetch=async url=>new URL(url).pathname.endsWith('latest.json')?Response.json(current):(downloads++,new Response(packed));
 const before=await preparedMeta('ifs_ens',signal());await load();
 current={...current,preparedAt:'2026-10-07T12:00:00Z',files:Object.fromEntries(Object.entries(current.files).reverse())};
 const after=await preparedMeta('ifs_ens',signal());assert.equal(after.revision,before.revision);await load();assert.equal(downloads,1);
});
test('legacy persisted data cannot satisfy a hash-identified publication',async()=>{
 const fixture=preparedFixture(),{decodePrepared}=await import(await moduleUrl('prepared-ensembles')),pair=decodePrepared(fixture.bytes,'ifs_ens',run,0,10);
 await storage.writeStoredForecast('ifs_ens',run,0,10,-1,{frame:pair.mean,pair});let downloads=0;
 globalThis.fetch=async url=>new URL(url).pathname.endsWith('latest.json')?Response.json(catalogue(fixture.packed)):(downloads++,new Response(fixture.packed));
 // No preceding metadata call: the client must verify before reading IndexedDB.
 await load();assert.equal(downloads,1);
});
test('a corrected file does not evict another unchanged time in the same publication',async()=>{
 const old=preparedFixture().packed,next=preparedFixture('ifs_ens',6).packed,corrected=correction(),blobs=new Map([[sha(old),old],[sha(next),next],[sha(corrected),corrected]]);let current=catalogue(old),downloads=0;
 current.files['10/6']={path:'2026100700/10/6.bin.gz',bytes:next.length,sha256:sha(next)};
 globalThis.fetch=async url=>{const u=new URL(url);if(u.pathname.endsWith('latest.json'))return Response.json(current);downloads++;return new Response(blobs.get(u.searchParams.get('sha')))};
 await load();await client.loadForecast('ifs_ens',run,6,10,-1,signal(),()=>{});
 current={...current,files:{...current.files,'10/0':{path:'2026100700/10/0.bin.gz',bytes:corrected.length,sha256:sha(corrected)}}};await preparedMeta('ifs_ens',signal());
 assert.ok(client.peekForecast('ifs_ens',run,6,10,-1));assert.equal(client.peekForecast('ifs_ens',run,0,10,-1),undefined);
 await load();await client.loadForecast('ifs_ens',run,6,10,-1,signal(),()=>{});assert.equal(downloads,3);
});
test('a late old-revision download cannot overwrite or satisfy the corrected publication',async()=>{
 const old=preparedFixture().packed,corrected=correction();let current=catalogue(old),release;
 globalThis.fetch=async url=>{const u=new URL(url);if(u.pathname.endsWith('latest.json'))return Response.json(current);if(u.searchParams.get('sha')===sha(old))return new Promise(resolve=>release=()=>resolve(new Response(old)));return new Response(corrected)};
 await preparedMeta('ifs_ens',signal());const pending=load(),rejected=assert.rejects(pending,/publication changed/);
 while(!release)await new Promise(resolve=>setImmediate(resolve));
 current=catalogue(corrected);await preparedMeta('ifs_ens',signal());assert.equal((await load()).frame.temperature[0],-50);
 release();await rejected;assert.equal(client.peekForecast('ifs_ens',run,0,10,-1).frame.temperature[0],-50);
 const fresh=await import(await moduleUrl('forecast-client','after late write'));assert.equal((await load(fresh)).frame.temperature[0],-50);
});
test('same-cycle ICON content corrections also invalidate the decoded and persisted identity',async()=>{
 const frame={model:'icon',run,hour:0,level:30,valid:run,grid:{nx:360,ny:91,lat0:90,lon0:0,dx:1,dy:-1},source:'https://opendata.dwd.de/weather/nwp/icon/grib',runKind:'cycle',preparedAt:run,temperature:Array(32760).fill(-55),height:Array(32760).fill(23000),u:Array(32760).fill(-8),v:Array(32760).fill(3)};
 const old=gzipSync(JSON.stringify(frame)),corrected=gzipSync(JSON.stringify({...frame,temperature:Array(32760).fill(-50)}));let current=catalogue(old,{model:'icon'}),downloads=0;
 globalThis.fetch=async url=>{const u=new URL(url);if(u.pathname.endsWith('latest.json'))return Response.json(current);downloads++;return new Response(u.searchParams.get('sha')===sha(old)?old:corrected)};
 const before=await iconMeta(signal());assert.equal((await load(client,'icon',30)).frame.temperature[0],-55);
 current=catalogue(corrected,{model:'icon'});assert.notEqual((await iconMeta(signal())).revision,before.revision);assert.equal(client.peekForecast('icon',run,0,30,-1),undefined);
 const fresh=await import(await moduleUrl('forecast-client','icon reload'));assert.equal((await load(fresh,'icon',30)).frame.temperature[0],-50);assert.equal(downloads,2);
});
