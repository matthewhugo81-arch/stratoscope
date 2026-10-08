import {MODELS,memberCount,type EnsembleModel} from './models';
export type DiagnosticPoint={hour:number;wind:number[];temperature:number[]};
export type NorthernDiagnostics={version:1;model:EnsembleModel;run:string;level:10;count:number;maxHour:number;complete:true;inputSha256:string;preparedAt:string;windBasis:string;temperatureBasis:string;points:DiagnosticPoint[]};
export function validateDiagnostics(d:NorthernDiagnostics,model:EnsembleModel){
 const count=memberCount(model),max=MODELS[model].maxHour;
 if(d.version!==1||d.model!==model||d.level!==10||d.count!==count||d.maxHour!==max||d.complete!==true||!/^\d{4}-\d{2}-\d{2}T(00|06|12|18):00:00\.000Z$/.test(d.run)||!Number.isFinite(Date.parse(d.run))||!Number.isFinite(Date.parse(d.preparedAt))||!/^[a-f0-9]{64}$/.test(d.inputSha256)||d.windBasis!=='native 60N full longitude circle'||d.temperatureBasis!=='area-weighted 2 degree display grid, 60–90N'||!Array.isArray(d.points)||d.points.length!==max/6+1)throw Error('Incomplete northern diagnostic catalogue');
 for(let i=0;i<d.points.length;i++){
  const p=d.points[i];if(p.hour!==i*6||!Array.isArray(p.wind)||!Array.isArray(p.temperature)||p.wind.length!==count||p.temperature.length!==count||p.wind.some(v=>!Number.isFinite(v)||Math.abs(v)>200)||p.temperature.some(v=>!Number.isFinite(v)||v< -150||v>100))throw Error('Incomplete member diagnostic series');
 }
 return d;
}
const cache=new Map<EnsembleModel,NorthernDiagnostics>();
export async function fetchDiagnostics(model:EnsembleModel,signal:AbortSignal,refresh=false){
 if(!refresh&&cache.has(model))return cache.get(model)!;
 const r=await fetch(`https://raw.githubusercontent.com/matthewhugo81-arch/stratoscope/forecast-data-diagnostics/${model}.json`,{signal,cache:'no-cache'});
 if(!r.ok)throw Error('Complete diagnostics are not published yet');
 const d=validateDiagnostics(await r.json(),model);cache.set(model,d);return d;
}
export const diagnosticMean=(values:number[])=>values.reduce((a,b)=>a+b,0)/values.length;
