import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import ts from 'typescript';
const source=await readFile(new URL('../lib/vortex-context.ts',import.meta.url),'utf8');
const {validateVortexBaseMap,heightReferenceId,heightReferenceSha,heightAnomalyColour,sampleHeightAnomaly}=await import('data:text/javascript;base64,'+Buffer.from(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText).toString('base64'));
const run='2028-02-28T12:00:00.000Z',hour=24;
const fixture=()=>({version:1,model:'gefs',run,hour,validTime:'2028-02-29T12:00:00.000Z',count:31,pressure:500,units:'m',method:'ensemble-mean-height-minus-daily-climatology',source:'https://noaa-gefs-pds.s3.amazonaws.com',reference:heightReferenceId,referenceSha256:heightReferenceSha,calendarDay:'02-29',grid:{nx:360,ny:61,lat0:90,lon0:0,dx:1,dy:-1},values:Array(61*360).fill(25)});
test('base map matches exact vortex forecast and verified climate reference',()=>assert.equal(validateVortexBaseMap(fixture(),run,hour).pressure,500));
test('rejects stale, partial, wrong-level and fabricated references',()=>{
 for(const mutate of [d=>d.count=30,d=>d.hour=12,d=>d.run='2028-02-28T00:00:00.000Z',d=>d.validTime=run,d=>d.calendarDay='02-28',d=>d.pressure=1000,d=>d.reference='ERA5',d=>d.referenceSha256='0'.repeat(64),d=>d.values.pop(),d=>d.values[0]=NaN]){const d=fixture();mutate(d);assert.throws(()=>validateVortexBaseMap(d,run,hour));}
});
test('symmetric scale has clear sign, transparent zero and saturated extremes',()=>{
 assert.equal(heightAnomalyColour(0)[3],0);
 assert.deepEqual(heightAnomalyColour(600),heightAnomalyColour(300));
 assert.deepEqual(heightAnomalyColour(-600),heightAnomalyColour(-300));
 assert.equal(heightAnomalyColour(60)[3],heightAnomalyColour(-60)[3]);
 assert.ok(heightAnomalyColour(180)[0]>heightAnomalyColour(180)[2]);
 assert.ok(heightAnomalyColour(-180)[2]>heightAnomalyColour(-180)[0]);
});
test('map sampling wraps date line, with correct east/north indexing',()=>{
 const d=fixture();d.values=d.values.map((_,i)=>Math.floor(i/360)*10+i%360);
 assert.equal(sampleHeightAnomaly(d,90,60),390);
 assert.equal(sampleHeightAnomaly(d,359.5,90),179.5);
 assert.equal(sampleHeightAnomaly(d,-.5,90),179.5);
});
