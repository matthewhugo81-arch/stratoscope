import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import ts from 'typescript';
const source=await readFile(new URL('../lib/chart-export-meta.ts',import.meta.url),'utf8');
const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
const {boundedImageSize,imageFilename,utcStamp}=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));
test('PNG dimensions are high resolution but bounded for phones and large montages',()=>{
 for(const [w,h] of [[1000,600],[1600,2400],[1800,9000],[10000,10000]]){
  const s=boundedImageSize(w,h);assert.ok(s.width<=4096&&s.height<=8192&&s.width*s.height<=12000000);assert.ok(s.scale<=2&&s.scale>0);
 }
 assert.equal(boundedImageSize(1000,600).width,2000);
});
test('empty and invalid export dimensions cannot produce blank success',()=>{
 for(const pair of [[0,100],[-1,3],[NaN,40],[40,Infinity]])assert.throws(()=>boundedImageSize(...pair));
});
test('image filenames retain model, cycle and lead without filesystem-unsafe characters',()=>{
 const name=imageFilename('Mét Office / GloSea','2026-10-01T00:00:00.000Z','f84');
 assert.match(name,/^stratoscope-Met-Office-GloSea-2026-10-01T00-00-00-000Z-f84\.png$/);
 assert.ok(imageFilename('x'.repeat(400)).length<210);assert.ok(!/[\\/:*?"<>|]/.test(name));
});
test('timestamps remain UTC rather than the browser local timezone',()=>{
 assert.equal(utcStamp('2026-10-10T13:00:00+01:00'),'2026-10-10 12:00:00 UTC');
 assert.equal(utcStamp('bad'),'Time unavailable');
});
test('all chart-bearing sections have a Save control, including independent heat flux',async()=>{
 for(const file of ['seasonal-chart','ec46-chart','heat-flux-chart','northern-diagnostics','vortex-view','polar-map','zonal-wind-card','forecast-stamps','member-panels']){
  const text=await readFile(new URL('../components/'+file+'.tsx',import.meta.url),'utf8');assert.ok(text.includes('<SaveImageButton'),file);
 }
});
test('canvas snapshots precede asynchronous decoding and WebGL is redrawn before capture',async()=>{
 const code=await readFile(new URL('../lib/chart-export.ts',import.meta.url),'utf8');assert.ok(code.indexOf('input.plots.map(freezePlot)')<code.indexOf('await drawable'));
 const map=await readFile(new URL('../components/polar-map.tsx',import.meta.url),'utf8');assert.match(map,/beforeSave=\{\(\)=>paint.current\(\)\}/);
 const button=await readFile(new URL('../components/save-image-button.tsx',import.meta.url),'utf8');assert.ok(button.includes('if(lock.current||disabled)return'));assert.ok(button.includes('role="alert"'));
});
