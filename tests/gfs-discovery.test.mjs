import {test} from 'node:test';
import assert from 'node:assert/strict';
import {moduleUrl} from './module-fixture.mjs';
const complete=[100,70,50,30,20,10].flatMap(level=>['TMP','HGT','UGRD','VGRD'].map(field=>`${field}:${level} mb`)).map((field,i)=>`${i+1}:${i*100}:d=2026102012:${field}:240 hour fcst:`).join('\n');
test('GFS skips truly missing or valid incomplete runs but propagates unverified source failures',async()=>{
 const original=globalThis.fetch,now=Date.now;Date.now=()=>Date.parse('2026-10-20T19:00:00Z');
 try{
  for(const status of [404,410]){let calls=0;globalThis.fetch=async()=>++calls===1?new Response('',{status}):new Response(complete);const gfs=await import(await moduleUrl('gfs',String(status)));assert.equal(await gfs.latestRun(),'2026-10-20T12:00:00.000Z');assert.equal(calls,2);}
  let calls=0;globalThis.fetch=async()=>new Response(++calls===1?complete.split('\n')[0]:complete);const partial=await import(await moduleUrl('gfs','incomplete'));assert.equal(await partial.latestRun(),'2026-10-20T12:00:00.000Z');assert.equal(calls,2);
  for(const status of [429,500,503]){let calls=0;globalThis.fetch=async()=>{calls++;return new Response('',{status})};const gfs=await import(await moduleUrl('gfs',String(status)));await assert.rejects(gfs.latestRun(),/could not be verified/);assert.equal(calls,1);}
  for(const reason of ['network','timeout','invalid']){let calls=0;globalThis.fetch=async()=>{calls++;if(reason==='invalid')return new Response('<html>Proxy error</html>');throw reason==='timeout'?new DOMException('Timed out','TimeoutError'):new TypeError('Network unreachable')};const gfs=await import(await moduleUrl('gfs',reason));await assert.rejects(gfs.latestRun());assert.equal(calls,1);}
 }finally{globalThis.fetch=original;Date.now=now;}
});
