import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import ts from 'typescript';
const source=await readFile(new URL('../lib/wind-arrows.ts',import.meta.url),'utf8');
const {windArrowTarget:target}=await import('data:text/javascript;base64,'+Buffer.from(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText).toString('base64'));
test('positive u points east, negative u west, positive v north',()=>{
 assert.ok(target(60,0,20,0).lon>0);assert.ok(target(60,0,-20,0).lon<0);assert.ok(target(60,0,0,20).lat>60);assert.ok(target(60,0,0,-20).lat<60);
});
test('arrows handle the longitude seam and high latitudes without changing wind magnitude',()=>{
 const p=target(86,179.9,60,30);assert.ok(Number.isFinite(p.lat)&&Number.isFinite(p.lon));assert.equal(p.speed,Math.hypot(60,30));assert.ok(p.length>target(86,179.9,6,3).length);
});
test('calm and invalid vectors do not invent flow directions',()=>{assert.equal(target(60,0,0,0),null);assert.equal(target(60,0,NaN,3),null);});
