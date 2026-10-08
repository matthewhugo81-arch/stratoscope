import {test,afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import ts from 'typescript';
import {preparedFixture,run} from './prepared-fixture.mjs';
async function moduleUrl(name){
 let source=await readFile(new URL(`../lib/${name}.ts`,import.meta.url),'utf8');
 if(name!=='models')source=source.replace("from './models'",`from '${await moduleUrl('models')}'`);
 return 'data:text/javascript;base64,'+Buffer.from(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText).toString('base64');
}
const {decodePrepared,preparedMeta,preparedPair,clearPreparedManifest}=await import(await moduleUrl('prepared-ensembles'));
const originalFetch=globalThis.fetch,signal=()=>new AbortController().signal;
afterEach(()=>{globalThis.fetch=originalFetch;for(const m of ['gefs','ifs_ens','aifs_ens'])clearPreparedManifest(m);});
function manifest(fixture){
 const files={},levels=[10,50,100];
 for(const level of levels)for(let hour=0;hour<=360;hour+=6)files[`${level}/${hour}`]={path:`2026100700/${level}/${hour}.bin.gz`,bytes:fixture.packed.length,sha256:createHash('sha256').update(fixture.packed).digest('hex')};
 return {version:1,model:'ifs_ens',run,maxHour:360,step:6,count:51,levels,complete:true,preparedAt:'2026-10-07T10:00:00Z',files};
}
test('prepared decoder preserves row deltas, signed native wind and distinct scalar wind statistics',()=>{
 const {mean,spread}=decodePrepared(preparedFixture().bytes,'ifs_ens',run,0,10);
 assert.equal(mean.temperature[359],-56.41);assert.equal(mean.temperature[360],-59.99);
 assert.equal(mean.temperature.at(-1),-55.51);assert.equal(mean.height[0],31000);
 assert.equal(mean.u[0],3);assert.equal(mean.v[0],4);assert.equal(mean.wind[0],20);
 assert.equal(spread.temperature[0],2);assert.equal(spread.wind[0],6);assert.equal(spread.height,mean.height);
 assert.equal(mean.zonalWind60N.value,-4.5678);assert.equal(spread.zonalWind60N,mean.zonalWind60N);
 assert.equal(mean.ensemble.count,51);assert.equal(spread.ensemble.view,'spread');
});
test('prepared decoder rejects wrong identity, incomplete ensemble and invalid native diagnostic',()=>{
 for(const override of [{model:'gefs'},{run:'2026-10-06T00:00:00.000Z'},{hour:6},{level:50},{count:50},{planes:6},{scale:10},{grid:{nx:1}},{source:'unverified'},{zonalWind60N:null},{zonalWind60N:{value:1,samples:360,longitudeStep:1,basis:'display'}}])assert.throws(()=>decodePrepared(preparedFixture('ifs_ens',0,10,override).bytes,'ifs_ens',run,0,10));
 const bytes=preparedFixture().bytes;assert.throws(()=>decodePrepared(bytes.subarray(0,-1),'ifs_ens',run,0,10));
 bytes.writeInt32LE(-1,12+bytes.readUInt32LE(8)+5*360*91*4);
 assert.throws(()=>decodePrepared(bytes,'ifs_ens',run,0,10),/spread/);
});
test('catalogue requires every forecast and a complete member count',async()=>{
 const fixture=preparedFixture();
 for(const alter of [m=>m.complete=false,m=>m.count=50,m=>delete m.files['50/360'],m=>m.files['10/0'].path='../wrong',m=>m.preparedAt='invalid']){
  const m=manifest(fixture);alter(m);globalThis.fetch=async()=>Response.json(m);await assert.rejects(preparedMeta('ifs_ens',signal()));
 }
});
test('catalogue checksum binds the one compressed download to its prepared content',async()=>{
 const fixture=preparedFixture(),m=manifest(fixture);let calls=0;
 globalThis.fetch=async url=>{calls++;return String(url).endsWith('latest.json')?Response.json(m):new Response(fixture.packed);};
 const meta=await preparedMeta('ifs_ens',signal());assert.equal(meta.run,run);
 assert.equal((await preparedPair('ifs_ens',run,0,10,signal())).mean.temperature[0],-60);assert.equal(calls,2);
 globalThis.fetch=async()=>new Response(preparedFixture('ifs_ens',6).packed);
 await assert.rejects(preparedPair('ifs_ens',run,0,10,signal()),/integrity check/);
});

test('GEFS and AIFS catalogues accept complete 06Z and 18Z cycles',async()=>{
 for(const model of ['gefs','aifs_ens'])for(const cycle of ['06','18']){
  const levels=model==='gefs'?[10,20,30,50,70,100]:[10,50,100],maxHour=model==='gefs'?384:360,files={};
  for(const level of levels)for(let hour=0;hour<=maxHour;hour+=6)files[`${level}/${hour}`]={path:`20261007${cycle}/${level}/${hour}.bin.gz`,bytes:100,sha256:'a'.repeat(64)};
  const run=`2026-10-07T${cycle}:00:00.000Z`;
  globalThis.fetch=async()=>Response.json({version:1,model,run,maxHour,step:6,count:model==='gefs'?31:51,levels,complete:true,preparedAt:'2026-10-08T05:00:00Z',files});
  assert.equal((await preparedMeta(model,signal())).run,run);
 }
});
