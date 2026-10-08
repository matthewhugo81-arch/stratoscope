import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import ts from 'typescript';
const source=await readFile(new URL('../lib/diagnostic-axis.ts',import.meta.url),'utf8');
const {diagnosticAxis}=await import('data:text/javascript;base64,'+Buffer.from(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext}}).outputText).toString('base64'));
test('westerly forecasts use a tight scale without forcing zero',()=>{const a=diagnosticAxis([13.6,18,22.4]);assert.ok(a.min>0&&a.min<13.6&&a.max>22.4&&a.max-a.min<20);});
test('member extremes and real reversals remain visible',()=>{for(const values of [[-3,4,27],[-22,-4],[13,40]]){const a=diagnosticAxis(values);assert.ok(a.min<Math.min(...values)&&a.max>Math.max(...values));}const a=diagnosticAxis([-3,4,27]);assert.ok(a.ticks.includes(0));});
test('optional zero reference, constant fields and absent curves have valid axes',()=>{assert.ok(diagnosticAxis([13,22],true).min<=0);for(const values of [[-54.3,-54.3],[],[NaN,Infinity]]){const a=diagnosticAxis(values);assert.ok(Number.isFinite(a.min)&&Number.isFinite(a.max)&&a.max>a.min&&a.ticks.length>=2);}});
