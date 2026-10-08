import type {VortexCatalogue} from './vortex';
export type HeatFluxSeries={version:1;model:'gefs';run:string;complete:true;count:31;pressure:100;latitudeBand:[45,75];units:'K m/s';gridDegrees:1;method:string;source:string;step:12;maxHour:384;points:{hour:number;members:number[]}[]};
export function validateHeatFlux(d:HeatFluxSeries,run:string){
 if(d.version!==1||d.model!=='gefs'||d.run!==run||d.complete!==true||d.count!==31||d.pressure!==100||JSON.stringify(d.latitudeBand)!=='[45,75]'||d.units!=='K m/s'||d.gridDegrees!==1||d.method!=='member-zonal-eddy-heat-flux-area-45-75N'||d.source!=='https://noaa-gefs-pds.s3.amazonaws.com'||d.step!==12||d.maxHour!==384||!Array.isArray(d.points)||d.points.length!==33)throw Error('Incomplete or mismatched heat-flux series');
 for(let i=0;i<33;i++){const p=d.points[i];if(p.hour!==i*12||!Array.isArray(p.members)||p.members.length!==31||p.members.some(v=>!Number.isFinite(v)||Math.abs(v)>=10000))throw Error('Invalid heat-flux member coverage');}
 return d;
}
export function heatFluxSummary(values:number[]){
 const sorted=[...values].sort((a,b)=>a-b);
 // For 31 members, the linear 10th/90th percentiles fall on ranks 4 and 28.
 return {mean:values.reduce((s,v)=>s+v,0)/values.length,low:sorted[3],high:sorted[27]};
}
export async function loadHeatFlux(c:VortexCatalogue,signal:AbortSignal){
 const e=c.heatFlux;if(!e)throw Error('Heat flux is preparing for this run');
 const key=c.run.slice(0,10).replaceAll('-','')+c.run.slice(11,13);
 if(e.path!==`${key}/gefs/heat-flux-${e.sha256}.json`||!/^[a-f0-9]{64}$/.test(e.sha256)||e.bytes<=0||e.bytes>100000)throw Error('Invalid heat-flux asset');
 const r=await fetch('https://raw.githubusercontent.com/matthewhugo81-arch/stratoscope/forecast-data-vortex/'+e.path,{signal,cache:'force-cache'});
 if(!r.ok)throw Error('Heat-flux download unavailable');const b=await r.arrayBuffer();
 const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',b)),v=>v.toString(16).padStart(2,'0')).join('');
 if(b.byteLength!==e.bytes||hash!==e.sha256)throw Error('Heat-flux integrity check failed');
 return validateHeatFlux(JSON.parse(new TextDecoder().decode(b)),c.run);
}
