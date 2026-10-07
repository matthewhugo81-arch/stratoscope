import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import ts from 'typescript';
async function moduleUrl(name){let source=await readFile(new URL(`../lib/${name}.ts`,import.meta.url),'utf8');for(const dep of ['models','forecast-storage'])if(source.includes(`from './${dep}'`))source=source.replace(`from './${dep}'`,`from '${await moduleUrl(dep)}'`);return 'data:text/javascript;base64,'+Buffer.from(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText).toString('base64')}
const {decodeMemberPanels,isEasterly}=await import(await moduleUrl('member-panels'));
const run='2026-10-07T00:00:00.000Z';
function fixture(overrides={}){
 const h={version:1,model:'ifs_ens',run,hour:360,level:10,count:51,grid:{nx:180,ny:46,lat0:90,lon0:0,dx:2,dy:-2},scale:100,planes:3,zonal:Array.from({length:51},(_,i)=>i===0?-.00001:i-1),samples:1440,source:'https://data.ecmwf.int/forecasts',...overrides};
 const header=new TextEncoder().encode(JSON.stringify(h)),bytes=new Uint8Array(12+header.length+51*3*46*180*4),d=new DataView(bytes.buffer);bytes.set(new TextEncoder().encode('STRATP01'));d.setUint32(8,header.length,true);bytes.set(header,12);let offset=12+header.length;
 for(let m=0;m<51;m++)for(let p=0;p<3;p++)for(let y=0;y<46;y++)for(let x=0;x<180;x++){d.setInt32(offset,x===0?[-6000,3100000,2500][p]+m:0,true);offset+=4}
 return bytes;
}
test('complete panel bundles preserve member identity, field planes and native wind signs',()=>{
 const panels=decodeMemberPanels(fixture(),'ifs_ens',run,360);
 assert.equal(panels.length,51);assert.equal(panels[50].ensemble.member,50);assert.equal(panels[50].temperature[0],-59.5);assert.equal(panels[50].wind[0],25.5);assert.equal(panels[0].zonalWind60N.samples,1440);
 assert.equal(isEasterly(panels[0].zonalWind60N.value),true);assert.equal(isEasterly(-0),false);assert.equal(isEasterly(0),false);assert.equal(isEasterly(.00001),false);assert.equal(isEasterly(NaN),false);
});
test('reject partial, mismatched and malformed bundles',()=>{
 assert.throws(()=>decodeMemberPanels(fixture().slice(0,-4),'ifs_ens',run,360));
 for(const changes of [{count:50},{hour:0},{level:50},{source:'https://untrusted.invalid'},{zonal:[-1]},{samples:360}])assert.throws(()=>decodeMemberPanels(fixture(changes),'ifs_ens',run,360));
});
