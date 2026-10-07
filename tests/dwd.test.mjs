import {test,afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {gzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import ts from 'typescript';
async function load(name){const s=await readFile(new URL(`../lib/${name}.ts`,import.meta.url),'utf8');return import('data:text/javascript;base64,'+Buffer.from(ts.transpileModule(s,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText).toString('base64'));}
const {validateIconFrame,validateIconManifest,iconMeta,iconFrame}=await load('dwd');
const {isModel,isCycle,MODELS}=await load('models');
const run='2026-10-07T00:00:00.000Z',originalFetch=globalThis.fetch;
afterEach(()=>{globalThis.fetch=originalFetch;});
const frame=()=>({model:'icon',run,hour:0,level:30,valid:run,grid:{nx:360,ny:91,lat0:90,lon0:0,dx:1,dy:-1},source:'https://opendata.dwd.de/weather/nwp/icon/grib',runKind:'cycle',preparedAt:run,temperature:Array(32760).fill(-55),height:Array(32760).fill(23000),u:Array(32760).fill(-8),v:Array(32760).fill(3)});
function catalogue(packed){const files={};for(const l of [30,50,70,100])for(let h=0;h<=180;h+=6)files[`${l}/${h}`]={path:`2026100700/${l}/${h}.json.gz`,bytes:packed.length,sha256:createHash('sha256').update(packed).digest('hex')};return {version:1,model:'icon',run,maxHour:180,step:6,levels:[30,50,70,100],complete:true,preparedAt:run,files};}
test('only direct providers are selectable and ICON is a fixed-cycle forecast',()=>{assert.equal(isModel('gfs_om'),false);assert.equal(isModel('ecmwf'),false);assert.equal(isCycle('icon'),true);assert.equal(MODELS.icon.maxHour,180);assert.equal(MODELS.icon.apiModel,null);assert.deepEqual(Object.keys(MODELS).filter(isModel),['gfs','ecmwf_direct','gefs','ifs_ens','aifs_ens','icon']);});
test('ICON rejects incomplete catalogues and wrong run/level/grid/field data',()=>{const packed=gzipSync(JSON.stringify(frame()));const m=catalogue(packed);assert.equal(Object.keys(validateIconManifest(m).files).length,124);delete m.files['100/180'];assert.throws(()=>validateIconManifest(m));for(const change of [{model:'ecmwf_direct'},{hour:6},{level:10},{source:'unverified'},{grid:{nx:1}},{temperature:[0]},{u:Array(32760).fill(NaN)}])assert.throws(()=>validateIconFrame({...frame(),...change},run,0,30));});
test('one compact official ICON map preserves signed wind and validates its checksum',async()=>{const packed=gzipSync(JSON.stringify(frame())),m=catalogue(packed);const urls=[];globalThis.fetch=async url=>{urls.push(String(url));return String(url).endsWith('latest.json')?Response.json(m):new Response(packed);};await iconMeta(new AbortController().signal);const f=await iconFrame(run,0,30,new AbortController().signal);assert.equal(f.u[0],-8);assert.equal(f.height[0],23000);assert.equal(urls.length,2);assert.ok(urls.every(u=>u.startsWith('https://raw.githubusercontent.com/matthewhugo81-arch/stratoscope/forecast-data-icon/')));globalThis.fetch=async()=>new Response(new Uint8Array(packed.length));await assert.rejects(iconFrame(run,0,30,new AbortController().signal),/integrity/);});
