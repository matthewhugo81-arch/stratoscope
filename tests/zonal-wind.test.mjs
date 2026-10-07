import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import ts from 'typescript';

async function moduleUrl(name){
 let source=await readFile(new URL(`../lib/${name}.ts`,import.meta.url),'utf8');
 for(const dependency of ['models','zonal-wind'])if(source.includes(`from './${dependency}'`))source=source.replace(`from './${dependency}'`,`from '${await moduleUrl(dependency)}'`);
 const {outputText}=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}});
 return 'data:text/javascript;base64,'+Buffer.from(outputText).toString('base64');
}
const {zonalMeanAt60,frameZonalWind,matchesZonalFrame,windDisplay}=await import(await moduleUrl('zonal-wind'));
const {ensembleStatistics}=await import(await moduleUrl('ensemble-statistics'));
const run='2026-10-07T00:00:00.000Z',grid={nx:360,ny:91,lat0:90,lon0:0,dx:1,dy:-1};
function frame(value=10){const f={model:'gfs',run,hour:0,level:10,grid,valid:run,source:'fixture'};for(const key of ['u','v','temperature','height'])f[key]=new Array(360*91).fill(key==='u'?value:100);return f;}
test('averages signed u around the complete 60N circle, not scalar speed or another latitude',()=>{
 const f=frame(99);for(let x=0;x<360;x++)f.u[30*360+x]=x<180?15:-25;
 assert.equal(frameZonalWind(f).value,-5);assert.equal(frameZonalWind(f).samples,360);
 assert.equal(frameZonalWind(f).basis,'display');
});
test('handles ascending latitudes, shifted longitudes and a repeated seam without double counting',()=>{
 const g={nx:361,ny:3,lat0:59,lon0:-180,dx:1,dy:1},u=new Array(361*3).fill(999);
 u.fill(4,361,361+360);u[361+360]=1000;
 assert.equal(zonalMeanAt60(u,g).value,4);assert.equal(zonalMeanAt60(u,g).samples,360);
});
test('rejects wrong levels, incomplete circles, absent latitude rows and missing values',()=>{
 const f=frame();assert.throws(()=>frameZonalWind({...f,level:50}),/10 hPa/);
 assert.throws(()=>zonalMeanAt60(f.u,{...grid,dx:.5}),/full latitude circle/);
 assert.throws(()=>zonalMeanAt60(f.u,{...grid,lat0:89.5}),/complete 60/);
 f.u[30*360+27]=NaN;assert.throws(()=>frameZonalWind(f),/Missing wind/);
});
test('native-grid diagnostic retains longitudes dropped from the display grid',()=>{
 const u=Array.from({length:1440},(_,i)=>i%4?4:0),z=zonalMeanAt60(u,{nx:1440,ny:1,lat0:60,lon0:0,dx:.25,dy:-.25});
 assert.equal(z.value,3);const f=frame(0);f.zonalWind60N=z;
 assert.equal(frameZonalWind(f).value,3);assert.equal(frameZonalWind(f).longitudeStep,.25);
});
test('model, run, lead and selected member must match before showing a value',()=>{
 const f=frame();assert.ok(matchesZonalFrame(f,'gfs',run,0,-1));
 for(const other of [{model:'ecmwf_direct'},{run:'2026-10-06T00:00:00.000Z'},{hour:6},{level:50}])assert.equal(matchesZonalFrame({...f,...other},'gfs',run,0,-1),false);
 const e={...f,model:'ifs_ens',ensemble:{view:'member',member:2,count:51}};
 assert.equal(matchesZonalFrame(e,'ifs_ens',run,0,-1),false);assert.equal(matchesZonalFrame(e,'ifs_ens',run,0,1),false);assert.ok(matchesZonalFrame(e,'ifs_ens',run,0,2));
 assert.ok(matchesZonalFrame({...e,ensemble:{view:'spread',count:51}},'ifs_ens',run,0,-1));
});
test('ensemble mean and spread share the mean signed zonal wind, including the control',()=>{
 const stats=ensembleStatistics(2);
 for(const [member,value] of [[0,20],[1,-40]]){const f=frame(value);f.ensemble={view:'member',member,count:2};f.zonalWind60N=zonalMeanAt60(f.u,grid);stats.add(f);}
 const {mean,spread}=stats.finish();assert.equal(mean.zonalWind60N.value,-10);assert.equal(spread.zonalWind60N.value,-10);
 assert.equal(mean.zonalWind60N.samples,360);
});
test('mixed old/new cached ensemble members cannot claim a partial native-grid diagnostic',()=>{
 const stats=ensembleStatistics(2);
 for(const member of [0,1]){const f=frame(member?20:10);f.ensemble={view:'member',member,count:2};if(!member)f.zonalWind60N=zonalMeanAt60(f.u,grid);stats.add(f);}
 const {mean}=stats.finish();assert.equal(mean.zonalWind60N,undefined);assert.equal(frameZonalWind(mean).value,15);assert.equal(frameZonalWind(mean).basis,'display');
});
test('direction uses the unrounded sign and never prints a misleading signed zero',()=>{
 assert.equal(windDisplay(12.37).text,'+12.4');assert.equal(windDisplay(-2.2).direction,'Easterly');
 assert.equal(windDisplay(-.004).text,'−<0.1');assert.equal(windDisplay(.004).direction,'Westerly');assert.equal(windDisplay(0).direction,'Zero zonal wind');
});
