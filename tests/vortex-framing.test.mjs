import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import ts from 'typescript';
const source=await readFile(new URL('../lib/vortex-projection.ts',import.meta.url),'utf8');
const {vortexScreenOrigin:origin,projectVortexPoint:project}=await import('data:text/javascript;base64,'+Buffer.from(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText).toString('base64'));
test('desktop fullscreen lifts the complete scene by 75 CSS pixels',()=>{
 for(const [w,h] of [[1580,785],[1900,910],[2540,1270]]){
  const old=origin(w,h,false),full=origin(w,h,true);
  assert.equal(full.x,old.x);assert.equal(old.y-full.y,75);
 }
});
test('short screens use a proportional lift rather than losing 75 pixels',()=>{
 for(const [w,h] of [[370,634],[824,300],[1000,530],[0,0]]){
  const lift=origin(w,h,false).y-origin(w,h,true).y;
  assert.ok(Math.abs(lift-Math.min(75,h*.1))<1e-9);
 }
});
test('inline framing remains unchanged',()=>{
 for(const [w,h] of [[1580,785],[370,530],[824,300]])assert.deepEqual(origin(w,h,false),{x:w/2,y:h*.42});
});
test('all geographic and PV points move together without changing scale or orientation',()=>{
 const w=1580,h=785,old=origin(w,h,false),full=origin(w,h,true);
 for(const zoom of [.5,1,1.75,2.5])for(const tilt of [.1,.55,1.4])for(const yaw of [0,.6,3]){
  const scale=Math.min(w*.34,h*.35)*zoom;
  for(const [lon,lat,z] of [[0,30,-.14],[90,60,0],[210,75,.7],[360,70,1.4]]){
   const p=project(lon,lat,z,yaw,tilt);
   assert.equal(old.x+p.x*scale,full.x+p.x*scale);
   assert.ok(Math.abs((old.y+p.y*scale)-(full.y+p.y*scale)-75)<1e-9);
  }
 }
});
test('fullscreen state is passed through and schedules a repaint',async()=>{
 const canvas=await readFile(new URL('../components/vortex-view.tsx',import.meta.url),'utf8');
 assert.ok(canvas.includes('<VortexCanvas data={data} expanded={expanded}/>'));
 assert.ok(canvas.includes('vortexScreenOrigin(size.w,size.h,expanded)'));
 assert.ok(canvas.includes('[data,size,texture,showBase,opacity,expanded]'));
 assert.ok(canvas.includes('scale=Math.min(size.w*.34,size.h*.35)*zoom'));
});
