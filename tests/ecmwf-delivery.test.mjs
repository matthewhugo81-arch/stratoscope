import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import ts from 'typescript';
const original=await readFile(new URL('../lib/ecmwf.ts',import.meta.url),'utf8');
const source=original.replace(/^import .* from '\.\/grib';$/m,'const decodeGrib=()=>{throw Error("Not requested by discovery tests")}; type Frame=any; type Grid=any;')
 .replace(/^import .* from '\.\/optional-cache';$/m,'const readCachedJson=async()=>null,writeCachedJson=async()=>{};')
 .replace(/^import .* from '\.\/zonal-wind';$/m,'const zonalMeanAt60=()=>null; type ZonalWind=any;');
let serial=0;
async function module(){return import('data:text/javascript;base64,'+Buffer.from(ts.transpileModule(source+'\n// '+serial++,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText).toString('base64'));}
const current='2026-10-11T00:00:00.000Z',old='2026-10-10T12:00:00.000Z';
function inventory(run=current){const date=run.slice(0,10).replaceAll('-',''),time=run.slice(11,13)+'00';return [10,50,100].flatMap((level,j)=>['t','gh','u','v'].map((param,i)=>({date,time,step:'240',levtype:'pl',levelist:String(level),param,_offset:(j*4+i)*100,_length:100}))).map(v=>JSON.stringify(v)).join('\n');}
function setup(t,fn){const originalFetch=globalThis.fetch,originalNow=Date.now;let now=Date.parse('2026-10-11T08:30:00Z');Date.now=()=>now;globalThis.fetch=fn;t.after(()=>{globalThis.fetch=originalFetch;Date.now=originalNow;});return n=>{now+=n};}
const ok=run=>new Response(inventory(run),{status:200});
test('direct IFS uses the official cloud replica before the canonical host',async t=>{
 const calls=[];setup(t,async u=>{calls.push(u);return ok(current)});
 assert.equal(await(await module()).latestEcmwfRun(),current);
 assert.equal(calls.length,1);assert.ok(calls[0].startsWith('https://storage.googleapis.com/ecmwf-open-data/'));
});
test('a missing primary replica does not hide the same new cycle on the other host',async t=>{
 const calls=[];setup(t,async u=>{calls.push(u);return u.includes('googleapis')?new Response('',{status:404}):ok(current)});
 assert.equal(await(await module()).latestEcmwfRun(),current);
 assert.equal(calls.length,2);assert.ok(calls.every(u=>u.includes('/20261011/')));
});
test('only absence on both replicas permits the preceding complete run',async t=>{
 const calls=[];setup(t,async u=>{calls.push(u);return u.includes('/20261011/')?new Response('',{status:404}):ok(old)});
 assert.equal(await(await module()).latestEcmwfRun(),old);
 assert.equal(calls.length,3);assert.ok(calls.slice(0,2).every(u=>u.includes('/20261011/')));
});
test('two outages never silently become an older latest cycle',async t=>{
 const calls=[];setup(t,async u=>{calls.push(u);return new Response('',{status:503})});
 await assert.rejects((await module()).latestEcmwfRun(),/not silently substituted/);
 assert.equal(calls.length,2);
});
test('missing on one source plus outage on the other is unverified, not absent',async t=>{
 setup(t,async u=>new Response('',{status:u.includes('googleapis')?404:503}));
 await assert.rejects((await module()).latestEcmwfRun(),/not silently substituted/);
});
test('brief discovery cache does not pin an old run for fifteen minutes',async t=>{
 let ready=false;const calls=[];
 const advance=setup(t,async u=>{calls.push(u);return u.includes('/20261011/')?(ready?ok(current):new Response('',{status:404})):ok(old)});
 const m=await module();assert.equal(await m.latestEcmwfRun(),old);ready=true;
 advance(30000);assert.equal(await m.latestEcmwfRun(),old);assert.equal(calls.length,3);
 advance(31000);assert.equal(await m.latestEcmwfRun(),current);assert.equal(calls.length,4);
});
test('malformed provider data are not hidden by an older-cycle fallback',async t=>{
 setup(t,async()=>new Response('not-json',{status:200}));
 await assert.rejects((await module()).latestEcmwfRun(),SyntaxError);
});
test('the source-wait notice is distinct from a failed import',async()=>{
 const text=await readFile(new URL('../lib/pipeline-status-message.ts',import.meta.url),'utf8');
 const {pipelineNotice}=await import('data:text/javascript;base64,'+Buffer.from(ts.transpileModule(text,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText).toString('base64'));
 const report={version:1,checkedAt:'2026-10-11T07:00:00Z',models:[]};
 const result=pipelineNotice(report,{model:'ifs_ens',availableRun:old,publishedRun:old,status:'current',sourcePendingRun:current},old,Date.parse(report.checkedAt));
 assert.equal(result.kind,'warning');assert.match(result.text,/Waiting for/);assert.match(result.text,/at the provider/);assert.doesNotMatch(result.text,/failed/);
});
