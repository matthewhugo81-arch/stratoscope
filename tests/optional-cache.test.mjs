import {test,afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import ts from 'typescript';

const source=await readFile(new URL('../lib/optional-cache.ts',import.meta.url),'utf8');
const {outputText}=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}});
const {readCachedJson,writeCachedJson}=await import('data:text/javascript;base64,'+Buffer.from(outputText).toString('base64'));
const original=Object.getOwnPropertyDescriptor(globalThis,'caches'),key=new Request('https://cache-test.invalid/forecast');
const denied=()=>{throw Error('This Worker is not permitted to access the default cache.');};
const setCache=value=>Object.defineProperty(globalThis,'caches',{configurable:true,value});
afterEach(()=>{if(original)Object.defineProperty(globalThis,'caches',original);else delete globalThis.caches;});

test('missing cache is a miss and writes are optional',async()=>{
 delete globalThis.caches;
 assert.equal(await readCachedJson(key),undefined);
 await writeCachedJson(key,{forecast:true},60);
});
test('a throwing CacheStorage getter cannot stop a forecast',async()=>{
 Object.defineProperty(globalThis,'caches',{configurable:true,get:denied});
 assert.equal(await readCachedJson(key),undefined);
 await writeCachedJson(key,{forecast:true},60);
});
test('the exact production default-cache permission error is optional',async()=>{
 setCache({get default(){return denied();}});
 assert.equal(await readCachedJson(key),undefined);
 await writeCachedJson(key,{forecast:true},60);
});
test('synchronous and asynchronous lookup errors and bad JSON are misses',async()=>{
 for(const match of [denied,async()=>denied(),async()=>new Response('invalid JSON')]){
  setCache({default:{match}});assert.equal(await readCachedJson(key),undefined);
 }
});
test('synchronous and asynchronous write errors preserve successful data',async()=>{
 for(const put of [denied,async()=>denied()]){
  setCache({default:{put}});await writeCachedJson(key,{forecast:true},60);
 }
});
test('available cache still returns data and stores its requested lifetime',async()=>{
 let written;
 setCache({default:{match:async request=>{assert.equal(request,key);return Response.json({forecast:true});},put:async(request,response)=>{assert.equal(request,key);written=response;}}});
 assert.deepEqual(await readCachedJson(key),{forecast:true});
 await writeCachedJson(key,{forecast:true},10800);
 assert.equal(written.headers.get('Cache-Control'),'public, max-age=10800');
 assert.deepEqual(await written.json(),{forecast:true});
});
