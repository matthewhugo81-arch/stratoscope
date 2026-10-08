import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import ts from 'typescript';
const source=await readFile(new URL('../lib/vortex-projection.ts',import.meta.url),'utf8');
const {projectVortexPoint:p}=await import('data:text/javascript;base64,'+Buffer.from(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText).toString('base64'));
test('north-pole map is outward-looking, with 0 down and 90E right',()=>{
 const zero=p(0,30,0,0,Math.PI/2),east=p(90,30,0,0,Math.PI/2),west=p(-90,30,0,0,Math.PI/2);
 assert.ok(zero.y>.99&&Math.abs(zero.x)<1e-10);assert.ok(east.x>.99&&west.x<-.99);
 assert.ok(zero.x*east.y-zero.y*east.x<0,'east longitude must be counterclockwise in screen coordinates');
});
test('rotation preserves handedness and height projects upwards',()=>{
 for(const yaw of [0,.6,2,4]){const a=p(0,30,0,yaw,.55),b=p(90,30,0,yaw,.55),pole=p(0,90,0,yaw,.55);assert.ok((a.x-pole.x)*(b.y-pole.y)-(a.y-pole.y)*(b.x-pole.x)<0);assert.ok(p(0,90,1.4,yaw,.55).y<pole.y);}
});
