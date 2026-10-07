import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import ts from 'typescript';
const scaleSource=await readFile(new URL('../lib/temperature-scale.ts',import.meta.url),'utf8');
const scaleCode=ts.transpileModule(scaleSource,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
const scaleUrl='data:text/javascript;base64,'+Buffer.from(scaleCode).toString('base64');
const source=(await readFile(new URL('../lib/globe.ts',import.meta.url),'utf8')).replace("from './temperature-scale'",`from '${scaleUrl}'`);
const {outputText}=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}});
const {viewBasis,rotateBasis,projectGlobe,inverseGlobe}=await import('data:text/javascript;base64,'+Buffer.from(outputText).toString('base64'));
for(const viewport of [{width:1120,height:630,dpr:1},{width:693,height:350,dpr:2},{width:362,height:362,dpr:3}])test(`globe fits and pointer coordinates round-trip in ${viewport.width}×${viewport.height}`,()=>{
 const basis=viewBasis(65,0),centre=projectGlobe(0,65,basis,1,viewport);
 assert.ok(Math.abs(centre.x-viewport.width/2)<1e-9);assert.ok(Math.abs(centre.y-viewport.height/2)<1e-9);
 for(const [lon,lat] of [[0,65],[-50,60],[100,75],[0,0]]){
  const p=projectGlobe(lon,lat,basis,1,viewport);if(p.depth<=0)continue;
  assert.ok(p.x>=0&&p.x<=viewport.width&&p.y>=0&&p.y<=viewport.height);
  const location=inverseGlobe(p.x,p.y,basis,1,viewport);
  assert.ok(Math.abs(location.lat-lat)<1e-8);assert.ok(Math.abs(location.lon-lon)<1e-8);
 }
 let rotated=basis;for(let i=0;i<500;i++)rotated=rotateBasis(rotated,3,-2);
 for(const axis of Object.values(rotated))assert.ok(Math.abs(Math.hypot(...axis)-1)<1e-10);
});
