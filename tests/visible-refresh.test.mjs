import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import ts from 'typescript';
const source=await readFile(new URL('../lib/visible-refresh.ts',import.meta.url),'utf8');
const {startVisibleRefresh}=await import('data:text/javascript;base64,'+Buffer.from(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText).toString('base64'));

test('visible refresh repeats after completion, avoids overlaps, resumes and cleans up',async()=>{
 const original={document:globalThis.document,setTimeout:globalThis.setTimeout,clearTimeout:globalThis.clearTimeout};
 const doc=new EventTarget();doc.hidden=false;globalThis.document=doc;
 const timers=new Map();let id=0,calls=0,release,signal;
 globalThis.setTimeout=(fn,ms)=>{timers.set(++id,{fn,ms});return id};globalThis.clearTimeout=id=>timers.delete(id);
 const settle=async()=>{await Promise.resolve();await Promise.resolve();};
 try{
  const stop=startVisibleRefresh(async s=>{calls++;signal=s;await new Promise(r=>{release=r})},300000);
  assert.equal(calls,1);doc.dispatchEvent(new Event('visibilitychange'));assert.equal(calls,1);
  release();await settle();assert.equal(timers.size,1);assert.equal([...timers.values()][0].ms,300000);
  doc.hidden=true;doc.dispatchEvent(new Event('visibilitychange'));assert.equal(timers.size,0);
  doc.hidden=false;doc.dispatchEvent(new Event('visibilitychange'));assert.equal(calls,2);
  stop();assert.equal(signal.aborted,true);release();await settle();assert.equal(timers.size,0);
  doc.dispatchEvent(new Event('visibilitychange'));assert.equal(calls,2);
 }finally{Object.assign(globalThis,original)}
});

test('transient failures schedule another attempt and hidden mounts wait for visibility',async()=>{
 const original={document:globalThis.document,setTimeout:globalThis.setTimeout,clearTimeout:globalThis.clearTimeout};
 const doc=new EventTarget();doc.hidden=true;globalThis.document=doc;let next,calls=0;
 globalThis.setTimeout=(fn)=>{next=fn;return 1};globalThis.clearTimeout=()=>{next=undefined};
 try{
  const stop=startVisibleRefresh(async()=>{calls++;throw Error('temporary outage')},900000);
  assert.equal(calls,0);doc.hidden=false;doc.dispatchEvent(new Event('visibilitychange'));
  await Promise.resolve();await Promise.resolve();assert.equal(calls,1);assert.equal(typeof next,'function');
  await next();assert.equal(calls,2);stop();assert.equal(next,undefined);
 }finally{Object.assign(globalThis,original)}
});
