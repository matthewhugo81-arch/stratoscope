import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import ts from 'typescript';
let source=await readFile(new URL('../lib/vortex.ts',import.meta.url),'utf8');
source=source.replace("import {preparedMeta} from './prepared-ensembles';",'const preparedMeta=()=>{};').replace("import {loadForecast} from './forecast-client';",'const loadForecast=()=>{};');
const {validateVortex}=await import('data:text/javascript;base64,'+Buffer.from(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText).toString('base64'));
const run='2026-10-07T18:00:00.000Z';
const fixture=()=>({version:1,model:'gefs',run,hour:0,count:31,method:'mean-field-pv-equivalent-area-70N',source:'https://noaa-gefs-pds.s3.amazonaws.com',pressureLevels:[1,2,3,5,7,10,20,30,50,70,100,150,200],gridDegrees:1,layers:Array.from({length:33},(_,i)=>({theta:400+i*25,pv:12,segments:[[359,70,360,70]]}))});
test('accepts complete source-qualified GEFS geometry',()=>assert.equal(validateVortex(fixture(),run,0).layers.length,33));
test('rejects partial ensembles, levels, invalid coordinates and stale runs',()=>{
 for(const mutate of [d=>d.count=30,d=>d.layers.pop(),d=>d.pressureLevels.pop(),d=>d.layers[0].segments[0][1]=NaN,d=>d.layers[0].theta=399,d=>d.run='2026-10-07T12:00:00.000Z']){const d=fixture();mutate(d);assert.throws(()=>validateVortex(d,run,0));}
});
