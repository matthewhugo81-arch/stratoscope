import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import ts from 'typescript';
async function moduleUrl(name){let source=await readFile(new URL(`../lib/${name}.ts`,import.meta.url),'utf8');if(name!=='models')source=source.replace("from './models'",`from '${await moduleUrl('models')}'`);return 'data:text/javascript;base64,'+Buffer.from(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText).toString('base64');}
const {validateDiagnostics,diagnosticMean}=await import(await moduleUrl('northern-diagnostics'));
const fixture=()=>({version:1,model:'gefs',run:'2026-10-07T18:00:00.000Z',level:10,count:31,maxHour:384,complete:true,inputSha256:'a'.repeat(64),preparedAt:'2026-10-08T06:00:00Z',windBasis:'native 60N full longitude circle',temperatureBasis:'area-weighted 2 degree display grid, 60–90N',points:Array.from({length:65},(_,i)=>({hour:i*6,wind:Array(31).fill(-4),temperature:Array(31).fill(-50)}))});
test('accepts complete four-cycle series and signed means',()=>{assert.equal(validateDiagnostics(fixture(),'gefs').points.length,65);assert.equal(diagnosticMean([-4,-6,1]),-3);});
test('rejects partial timeline, partial members and unqualified temperature',()=>{for(const mutate of [d=>d.points.pop(),d=>d.points[0].wind.pop(),d=>d.temperatureBasis='native',d=>d.points[2].temperature[0]=NaN]){const d=fixture();mutate(d);assert.throws(()=>validateDiagnostics(d,'gefs'));}});
