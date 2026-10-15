import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import ts from 'typescript';
async function moduleUrl(name){let source=await readFile(new URL(`../lib/${name}.ts`,import.meta.url),'utf8');if(name!=='models')source=source.replace("from './models'",`from '${await moduleUrl('models')}'`);return 'data:text/javascript;base64,'+Buffer.from(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText).toString('base64');}
const {validateDiagnostics,diagnosticMean,fetchDiagnostics,fetchDiagnosticParent,diagnosticFreshness}=await import(await moduleUrl('northern-diagnostics'));
const fixture=()=>({version:1,model:'gefs',run:'2026-10-07T18:00:00.000Z',level:10,count:31,maxHour:384,complete:true,inputSha256:'a'.repeat(64),preparedAt:'2026-10-08T06:00:00Z',windBasis:'native 60N full longitude circle',temperatureBasis:'area-weighted 2 degree display grid, 60–90N',points:Array.from({length:65},(_,i)=>({hour:i*6,wind:Array(31).fill(-4),temperature:Array(31).fill(-50)}))});
test('accepts complete four-cycle series and signed means',()=>{assert.equal(validateDiagnostics(fixture(),'gefs').points.length,65);assert.equal(diagnosticMean([-4,-6,1]),-3);});
test('rejects partial timeline, partial members and unqualified temperature',()=>{for(const mutate of [d=>d.points.pop(),d=>d.points[0].wind.pop(),d=>d.temperatureBasis='native',d=>d.points[2].temperature[0]=NaN]){const d=fixture();mutate(d);assert.throws(()=>validateDiagnostics(d,'gefs'));}});

test('diagnostic freshness distinguishes stale charts, matching runs and failed checks',()=>{
 const old='2026-10-14T18:00:00.000Z',current='2026-10-15T00:00:00.000Z';
 assert.match(diagnosticFreshness(old,current),/behind the maps/);
 assert.match(diagnosticFreshness(old,current),/15 Oct/);
 assert.equal(diagnosticFreshness(current,current),null);
 assert.match(diagnosticFreshness(current,old),/not yet verified/);
 assert.match(diagnosticFreshness(current,current,true),/could not be checked/);
 assert.match(diagnosticFreshness(current),/Checking/);
});

test('parent comparison requires complete maps and the correct model',async()=>{
 const original=globalThis.fetch,run='2026-10-15T00:00:00.000Z',files={};
 for(const level of [10,50,100])for(let hour=0;hour<=360;hour+=6)files[`${level}/${hour}`]={path:`2026101500/${level}/${hour}.bin.gz`,bytes:100,sha256:'a'.repeat(64)};
 const m={version:1,model:'ifs_ens',complete:true,count:51,maxHour:360,levels:[10,50,100],step:6,run,files};
 try{
  globalThis.fetch=async url=>{assert.match(url,/forecast-data-ifs-ens\/latest.json\?check=/);return Response.json(m)};
  assert.equal(await fetchDiagnosticParent('ifs_ens',new AbortController().signal),run);
  delete m.files['10/360'];await assert.rejects(fetchDiagnosticParent('ifs_ens',new AbortController().signal),/Incomplete/);
  m.model='gefs';await assert.rejects(fetchDiagnosticParent('ifs_ens',new AbortController().signal),/Invalid/);
 }finally{globalThis.fetch=original;}
});

test('diagnostics reuse recent data then discover a newly published run',async()=>{
 const originalFetch=globalThis.fetch,originalNow=Date.now;let now=1000,calls=0;
 Date.now=()=>now;
 globalThis.fetch=async url=>{assert.ok(new URL(url).searchParams.has('check'));calls++;return Response.json({...fixture(),run:calls===1?'2026-10-07T18:00:00.000Z':'2026-10-08T00:00:00.000Z'});};
 try{
  const signal=new AbortController().signal;
  assert.equal((await fetchDiagnostics('gefs',signal)).run,'2026-10-07T18:00:00.000Z');
  await fetchDiagnostics('gefs',signal);assert.equal(calls,1);
  now+=300001;
  assert.equal((await fetchDiagnostics('gefs',signal)).run,'2026-10-08T00:00:00.000Z');
  await fetchDiagnostics('gefs',signal,true);assert.equal(calls,3);
 }finally{globalThis.fetch=originalFetch;Date.now=originalNow;}
});
