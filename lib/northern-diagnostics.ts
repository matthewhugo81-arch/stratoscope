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
const cache=new Map<EnsembleModel,{at:number;data:NorthernDiagnostics}>();
export async function fetchDiagnostics(model:EnsembleModel,signal:AbortSignal,refresh=false){
 const hit=cache.get(model);if(!refresh&&hit&&Date.now()-hit.at<300000)return hit.data;
 const r=await fetch(`https://raw.githubusercontent.com/matthewhugo81-arch/stratoscope/forecast-data-diagnostics/${model}.json?check=${Date.now()}`,{signal,cache:'no-cache'});
 if(!r.ok)throw Error('Complete diagnostics are not published yet');
 const d=validateDiagnostics(await r.json(),model);cache.set(model,{at:Date.now(),data:d});return d;
}
export const diagnosticMean=(values:number[])=>values.reduce((a,b)=>a+b,0)/values.length;

/** Check the parent independently of the slower provider-health report. */
export async function fetchDiagnosticParent(model:EnsembleModel,signal:AbortSignal):Promise<string>{
 const r=await fetch(`https://raw.githubusercontent.com/matthewhugo81-arch/stratoscope/forecast-data-${model.replaceAll('_','-')}/latest.json?check=${Date.now()}`,{signal,cache:'no-cache'});
 if(!r.ok)throw Error('Map publication could not be checked');
 const m=await r.json() as {version:number;model:string;complete:boolean;count:number;maxHour:number;step:number;levels:number[];run:string;files:Record<string,{path:string;bytes:number;sha256:string}>};
 if(m.version!==1||m.model!==model||m.complete!==true||m.count!==memberCount(model)||m.maxHour!==MODELS[model].maxHour||m.step!==6||JSON.stringify(m.levels)!==JSON.stringify(MODELS[model].levels)||!/^\d{4}-\d{2}-\d{2}T(00|06|12|18):00:00\.000Z$/.test(m.run)||!Number.isFinite(Date.parse(m.run)))throw Error('Invalid map publication');
 const key=m.run.slice(0,10).replaceAll('-','')+m.run.slice(11,13);
 for(const level of MODELS[model].levels)for(let hour=0;hour<=m.maxHour;hour+=6){const e=m.files?.[`${level}/${hour}`];if(e?.path!==`${key}/${level}/${hour}.bin.gz`||!Number.isInteger(e.bytes)||e.bytes<=0||!/^[a-f0-9]{64}$/.test(e.sha256))throw Error('Incomplete map publication');}
 return m.run;
}

export function diagnosticFreshness(run:string,parentRun?:string,checkFailed=false):string|null{
 if(checkFailed)return 'Latest map run could not be checked. The diagnostic run shown above is retained.';
 if(!parentRun)return 'Checking the latest published map run…';
 const parent=Date.parse(parentRun),diagnostic=Date.parse(run);
 if(!Number.isFinite(parent)||!Number.isFinite(diagnostic))return 'Diagnostic freshness could not be verified.';
 if(parent>diagnostic){const stamp=new Date(parent).toLocaleString('en-GB',{timeZone:'UTC',day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit',hour12:false});return `Diagnostics are behind the maps (${stamp} UTC). Showing the previous complete diagnostic run while updates are checked.`;}
 if(parent<diagnostic)return 'Map publication check is older than these diagnostics; freshness is not yet verified.';
 return null;
}
