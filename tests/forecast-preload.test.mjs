import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import ts from 'typescript';
const source=await readFile(new URL('../lib/forecast-preload.ts',import.meta.url),'utf8');
const {preloadTimeline}=await import('data:text/javascript;base64,'+Buffer.from(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText).toString('base64'));
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function setup(overrides={}){
 const c=new AbortController(),ready=new Set(),jobs=new Map(),calls=[],busy=[];
 const options={maxHour:360,concurrency:4,signal:c.signal,selection:()=>({hour:204,direction:1,paused:false}),hasFrame:h=>ready.has(h),
  load:h=>{calls.push(h);return new Promise(resolve=>jobs.set(h,()=>{ready.add(h);jobs.delete(h);resolve()}))},
  onProgress:()=>{},onBusy:b=>busy.push(b),...overrides};
 const stop=preloadTimeline(options);
 return {c,ready,jobs,calls,busy,stop};
}
test('four prepared downloads start together and refill without an inter-frame delay',async()=>{
 const s=setup();await tick();assert.deepEqual(s.calls,[204,210,216,222]);assert.equal(s.jobs.size,4);
 s.jobs.get(210)();await tick();assert.equal(s.calls.at(-1),228);assert.equal(s.jobs.size,4);
 while(s.ready.size<61){for(const finish of [...s.jobs.values()])finish();await tick()}
 assert.equal(s.calls.length,61);assert.equal(new Set(s.calls).size,61);assert.equal(s.busy.at(-1),false);s.stop();
});
test('newly free slots prioritize a changed forecast time and direction',async()=>{
 let selected={hour:204,direction:1,paused:false};
 const s=setup({selection:()=>selected});await tick();selected={hour:60,direction:-1,paused:false};
 s.jobs.get(204)();await tick();assert.equal(s.calls.at(-1),60);
 s.jobs.get(210)();await tick();assert.equal(s.calls.at(-1),54);s.stop();s.c.abort();
});
test('direct-member preloads remain single-file work and foreground can take the other worker',async()=>{
 const s=setup({concurrency:1});await tick();assert.equal(s.jobs.size,1);s.jobs.get(204)();await tick();
 assert.equal(s.jobs.size,1);assert.deepEqual(s.calls,[204,210]);s.stop();s.c.abort();
});
test('a transient failure retries while all the other frames keep loading',async()=>{
 const ready=new Set(),attempts=new Map(),order=[];let complete;
 const done=new Promise(resolve=>complete=resolve);
 const s=setup({maxHour:24,retryDelays:[5,5],hasFrame:h=>ready.has(h),load:async h=>{
  const n=(attempts.get(h)??0)+1;attempts.set(h,n);
  if(h===6&&n<3)throw Error('Temporary network failure');ready.add(h);order.push(h);
 },onProgress:()=>{if(ready.size===5)complete()}});
 await done;assert.equal(attempts.get(6),3);assert.equal(order.at(-1),6);assert.equal(ready.size,5);s.stop();
});
test('permanent failures stop after bounded retries and do not restart successful times',async()=>{
 let calls=0;const s=setup({maxHour:0,retryDelays:[],load:async()=>{calls++;throw Error('Unavailable')}});
 await tick();await tick();assert.equal(calls,1);assert.equal(s.busy.at(-1),false);s.stop();
});
test('pausing for foreground work, hidden tabs or data saver starts no background downloads',async()=>{
 const s=setup({selection:()=>({hour:0,direction:1,paused:true})});await tick();assert.equal(s.calls.length,0);
 s.c.abort();assert.equal(s.busy.at(-1),false);
});
test('selection cancellation prevents late progress and any additional downloads',async()=>{
 let progress=0;const s=setup({onProgress:()=>progress++});await tick();s.c.abort();
 for(const finish of [...s.jobs.values()])finish();await tick();
 assert.equal(s.calls.length,4);assert.equal(progress,0);assert.equal(s.busy.at(-1),false);
});
