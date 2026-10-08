import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import ts from 'typescript';
const source=await readFile(new URL('../lib/heat-flux.ts',import.meta.url),'utf8');
const {validateHeatFlux,heatFluxSummary}=await import('data:text/javascript;base64,'+Buffer.from(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText).toString('base64'));
const run='2026-10-08T12:00:00.000Z';
const fixture=()=>({version:1,model:'gefs',run,complete:true,count:31,pressure:100,latitudeBand:[45,75],units:'K m/s',gridDegrees:1,method:'member-zonal-eddy-heat-flux-area-45-75N',source:'https://noaa-gefs-pds.s3.amazonaws.com',step:12,maxHour:384,points:Array.from({length:33},(_,i)=>({hour:i*12,members:Array.from({length:31},(_,m)=>m-10)}))});
test('complete member heat-flux forecast has honest mean and percentiles',()=>{
 const d=validateHeatFlux(fixture(),run);assert.deepEqual(heatFluxSummary(d.points[0].members),{mean:5,low:-7,high:17});
});
test('rejects mismatched runs, incomplete or duplicate hours and invalid members',()=>{
 for(const mutate of [d=>d.run='2026-10-08T06:00:00.000Z',d=>d.count=30,d=>d.pressure=500,d=>d.points.pop(),d=>d.points[1].hour=0,d=>d.points[0].members.pop(),d=>d.points[0].members[0]=NaN,d=>d.complete=false]){const d=fixture();mutate(d);assert.throws(()=>validateHeatFlux(d,run));}
});
