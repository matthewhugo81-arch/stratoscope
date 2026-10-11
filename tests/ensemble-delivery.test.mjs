import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import ts from 'typescript';
const run='2026-10-11T00:00:00.000Z',keys=['temperature','height','u','v'];
const original=await readFile(new URL('../lib/ensemble.ts',import.meta.url),'utf8');
const source=original.replace(/^import .* from '\.\/noaa-open-data';$/m,'const noaaFields=()=>{throw Error("Unexpected NOAA request")};')
 .replace(/^import .* from '\.\/grib';$/m,`const decodeGrib=bytes=>{const b=new Uint8Array(bytes),key=['temperature','height','u','v'][b[0]],member=b[1],level=b[2];return {run:'${run}',hour:204,level,member,product:member===0?0:1,grid:{nx:360,ny:91,dx:1,dy:-1,lat0:90,lon0:0},fields:{[key]:Array(360*91).fill(b[3])}}};type Frame=any;type Grid=any;`)
 .replace(/^import .* from '\.\/models';$/m,'const memberCount=m=>m==="gefs"?31:51;type EnsembleModel=string;')
 .replace(/^import .* from '\.\/prepared-ensembles';$/m,`const preparedMeta=async()=>({run:'${run}'});`)
 .replace(/^import .* from '\.\/optional-cache';$/m,'const readCachedJson=async()=>undefined,writeCachedJson=async()=>{};')
 .replace(/^import .* from '\.\/zonal-wind';$/m,'const zonalMeanAt60=(values,grid)=>({value:values[0],samples:grid.nx,longitudeStep:1,basis:"native"});type ZonalWind=any;');
let serial=0;
const module=()=>import('data:text/javascript;base64,'+Buffer.from(ts.transpileModule(source+'\n// '+serial++,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText).toString('base64'));
function index(member=0,level=10,offset=0,model='ifs_ens'){
 return ['t',model==='aifs_ens'?'z':'gh','u','v'].map((param,i)=>JSON.stringify({date:'20261011',time:'0000',step:'204',levtype:'pl',levelist:String(level),param,type:member?'pf':model==='ifs_ens'?'fc':'cf',number:String(member),_offset:offset+i*20,_length:20})).join('\n');
}
function field(range,member=0,level=10,offset=0,value=12){
 const start=Number(range.match(/bytes=(\d+)-/)[1]),bytes=new Uint8Array(20);bytes.set([(start-offset)/20,member,level,value]);return new Response(bytes,{status:206,headers:{'Content-Range':`bytes ${start}-${start+19}/1000`}});
}
function mock(t,fn){const fetch=globalThis.fetch;globalThis.fetch=fn;t.after(()=>globalThis.fetch=fetch)}
test('Control +204h uses the Google replica, overlaps exactly two fields and retains native wind',async t=>{
 let active=0,max=0;const calls=[];
 mock(t,async(url,options)=>{calls.push(url);assert.ok(url.startsWith('https://storage.googleapis.com/ecmwf-open-data/'));
  if(url.endsWith('.index'))return new Response(index());
  active++;max=Math.max(max,active);await new Promise(resolve=>setImmediate(resolve));active--;return field(options.headers.Range);
 });
 const frame=await(await module()).ensembleMember('ifs_ens',run,204,10,0);
 assert.equal(calls.length,5);assert.equal(max,2);assert.equal(frame.ensemble.member,0);assert.equal(frame.grid.dx,1);assert.equal(frame.zonalWind60N.value,12);
});
test('a browser network error re-indexes the SAME member and time on AWS',async t=>{
 const calls=[];mock(t,async(url,options)=>{calls.push(url);if(url.includes('googleapis'))throw TypeError('Failed to fetch');
  assert.ok(url.includes('cloudfront.net'));assert.ok(url.includes('20261011000000-204h-enfo-ef'));
  return url.endsWith('.index')?new Response(index(50,100,200)):field(options.headers.Range,50,100,200);
 });
 const frame=await(await module()).ensembleMember('ifs_ens',run,204,100,50);
 assert.equal(calls.length,6);assert.equal(frame.level,100);assert.equal(frame.ensemble.member,50);assert.equal(frame.hour,204);
});
test('range failures finish active transfers and re-download all fields using the next origin own offsets',async t=>{
 let active=0;const calls=[];
 mock(t,async(url,options)=>{calls.push(url);const google=url.includes('googleapis');
  if(!google)assert.equal(active,0,'previous source transfers must have settled');
  if(url.endsWith('.index'))return new Response(index(17,50,google?0:200,'aifs_ens'));
  if(google){active++;await new Promise(resolve=>setImmediate(resolve));active--;return new Response('',{status:429})}
  return field(options.headers.Range,17,50,200,24);
 });
 const frame=await(await module()).ensembleMember('aifs_ens',run,204,50,17);
 assert.equal(frame.temperature[0],24);assert.equal(frame.v[0],24);assert.ok(frame.source.includes('cloudfront.net'));assert.equal(calls.length,8);
});
test('wrong GRIB member is fatal and is never disguised by mirror failover',async t=>{
 const calls=[];mock(t,async(url,options)=>{calls.push(url);return url.endsWith('.index')?new Response(index(17)):field(options.headers.Range,18)});
 await assert.rejects((await module()).ensembleMember('ifs_ens',run,204,10,17),/different ensemble field or member/);
 assert.ok(calls.every(u=>u.includes('googleapis')));
});
test('all unavailable replicas return a useful retry message without choosing an older run',async t=>{
 const calls=[];mock(t,async url=>{calls.push(url);return new Response('',{status:503})});
 await assert.rejects((await module()).ensembleMember('ifs_ens',run,204,10,0),/official ECMWF replicas/);
 assert.equal(calls.length,3);assert.ok(calls.every(u=>u.includes('20261011000000-204h')));
});
