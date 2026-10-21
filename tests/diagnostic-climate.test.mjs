import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import ts from 'typescript';
const climate=JSON.parse(await readFile(new URL('../lib/diagnostic-climate.json',import.meta.url),'utf8'));
const source=(await readFile(new URL('../lib/diagnostic-climate.ts',import.meta.url),'utf8')).replace("import climate from './diagnostic-climate.json';",`const climate=${JSON.stringify(climate)};`);
const {diagnosticClimate:normal,diagnosticClimateSeries:series}=await import('data:text/javascript;base64,'+Buffer.from(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext}}).outputText).toString('base64'));
const at=s=>Date.parse(s+'Z');
test('all bundled normals match the archived NASA Mean column and source checksum',async()=>{
 for(const key of ['wind','temperature']){
  const raw=await readFile(new URL(`../scripts/data/northern-climate/${key}.txt`,import.meta.url));
  assert.equal(createHash('sha256').update(raw).digest('hex'),climate.sources[key].sha256);
  assert.equal(climate[key].length,365);
  for(const row of raw.toString().trim().split('\n').slice(7)){
   const fields=row.trim().split(/\s+/),expected=Number(fields[5])-(key==='temperature'?273.15:0);
   assert.ok(Math.abs(normal(at(fields[0]+'T00:00:00'),key)-expected)<0.00001);
  }
 }
});
test('UTC interpolation crosses New Year and leap day without shifting March',()=>{
 for(const key of ['wind','temperature']){
  assert.equal(normal(at('2026-12-31T12:00:00'),key),(climate[key][364]+climate[key][0])/2);
  assert.equal(normal(at('2028-02-29T00:00:00'),key),(climate[key][58]+climate[key][59])/2);
  assert.equal(normal(at('2028-03-01T00:00:00'),key),climate[key][59]);
  assert.equal(normal(at('2027-03-01T00:00:00'),key),climate[key][59]);
  const a=normal(at('2026-10-21T00:00:00'),key),b=normal(at('2026-10-22T00:00:00'),key);
  assert.equal(normal(at('2026-10-21T06:00:00'),key),a*.75+b*.25);
 }
});
test('reference spans exact forecast endpoints and includes each midnight',()=>{
 const start=at('2026-12-31T18:00:00'),end=at('2027-01-02T06:00:00');
 const points=series(start,end,'wind');
 assert.deepEqual(points.map(p=>p.time),[start,at('2027-01-01T00:00:00'),at('2027-01-02T00:00:00'),end]);
 assert.ok(points.every(p=>Number.isFinite(p.value)));
 assert.throws(()=>normal(NaN,'wind'));assert.throws(()=>series(end,start,'wind'));
});
