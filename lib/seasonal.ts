export const SEASONAL_MODELS=[
 {id:'egrr',name:'Met Office · GloSea',system:'610',members:50,hindcast:28},
 {id:'ecmf',name:'ECMWF',system:'51',members:51,hindcast:25},
 {id:'lfpw',name:'Météo-France',system:'9',members:51,hindcast:31},
 {id:'edzw',name:'DWD',system:'22',members:50,hindcast:30},
 {id:'cmcc',name:'CMCC',system:'4',members:50,hindcast:30},
 {id:'rjtd',name:'JMA',system:'4',members:55,hindcast:10},
 {id:'ammc',name:'BOM',system:'2',members:55,hindcast:27},
] as const;
export type SeasonalId=typeof SEASONAL_MODELS[number]['id'];
export const SEASONAL_ROOT='https://raw.githubusercontent.com/matthewhugo81-arch/stratoscope/forecast-data-seasonal/';
const SOURCE='https://cds.climate.copernicus.eu/datasets/seasonal-original-pressure-levels';
const ERA_SOURCE='https://cds.climate.copernicus.eu/datasets/reanalysis-era5-pressure-levels';
export type SeasonalForecast={version:2;complete:true;model:SeasonalId;name:string;system:string;nominal:string;preparedAt:string;latitude:60;level:10;units:'m/s';sampling:string;dates:string[];members:{id:string;start:string;values:number[]}[];memberCount:number;mean:number[];easterlyFraction:number[];source:string;climateKey:string;attribution:string};
export type SeasonalClimate={version:2;complete:true;model:SeasonalId;system:string;month:number;period:[number,number];years:number[];sampleCount:number;steps:number;sampling:string;mean:number[];min:number[];p10:number[];p25:number[];p75:number[];p90:number[];max:number[];source:string;method:string};
export type EraClimate={version:2;complete:true;period:[number,number];latitude:60;level:10;units:'m/s';source:string;method:string;daily:Record<string,number>;counts:Record<string,number>};
export type EraProgress={checkedAt:string;completedYears:number[];nextYear:number|null;status:'updating'|'behind'|'complete'|'error'};
function check(v:unknown):asserts v{if(!v)throw Error('Seasonal data failed validation.');}
const stamp=(s:unknown):s is string=>typeof s==='string'&&/^\d{4}-\d{2}-\d{2}T(00|12):00:00\.000Z$/.test(s)&&Number.isFinite(Date.parse(s));
const finite=(a:unknown,n=360):a is number[]=>Array.isArray(a)&&a.length===n&&a.every(v=>typeof v==='number'&&Number.isFinite(v)&&Math.abs(v)<200);
export function validateForecast(input:unknown,id:SeasonalId):SeasonalForecast{
 const d=input as SeasonalForecast,cfg=SEASONAL_MODELS.find(m=>m.id===id)!;
 check(d&&d.version===2&&d.complete===true&&d.model===id&&d.system===cfg.system&&d.name===cfg.name&&d.latitude===60&&d.level===10&&d.units==='m/s'&&d.source===SOURCE);
 check(stamp(d.nominal)&&d.nominal.slice(8,10)==='01'&&d.nominal.slice(11,13)==='00'&&Number.isFinite(Date.parse(d.preparedAt))&&Date.parse(d.preparedAt)>=Date.parse(d.nominal));
 check(d.sampling==='12-hourly instantaneous'&&Array.isArray(d.dates)&&d.dates.length===360&&d.dates.every((v,i)=>stamp(v)&&Date.parse(v)===Date.parse(d.nominal)+(i+1)*43200000));
 check(d.memberCount===cfg.members&&Array.isArray(d.members)&&d.members.length===cfg.members&&finite(d.mean)&&finite(d.easterlyFraction));
 const ids=new Set<string>();
 for(const m of d.members){check(m&&typeof m.id==='string'&&!ids.has(m.id)&&stamp(m.start)&&Date.parse(m.start)<=Date.parse(d.nominal)&&Date.parse(m.start)>=Date.parse(d.nominal)-31*86400000&&finite(m.values));ids.add(m.id);}
 for(let i=0;i<360;i++){check(Math.abs(d.mean[i]-d.members.reduce((s,m)=>s+m.values[i],0)/cfg.members)<.00011);check(Math.abs(d.easterlyFraction[i]-d.members.filter(m=>m.values[i]<0).length/cfg.members)<.0000011);}
 check(d.climateKey===`${id}-${cfg.system}-${d.nominal.slice(5,7)}`&&typeof d.attribution==='string'&&d.attribution.length<1000);
 return d;
}
export function validateClimate(input:unknown,id:SeasonalId,month:number):SeasonalClimate{
 const d=input as SeasonalClimate,cfg=SEASONAL_MODELS.find(m=>m.id===id)!;
 check(d&&d.version===2&&d.complete===true&&d.model===id&&d.system===cfg.system&&d.month===month&&d.steps===360&&d.source===SOURCE&&d.sampling==='12-hourly instantaneous');
 check(Array.isArray(d.period)&&d.period.join(',')==='1993,2016'&&Array.isArray(d.years)&&d.years.length===24&&d.years.every((y,i)=>y===1993+i)&&d.sampleCount===cfg.hindcast*24);
 const ordered=[d.min,d.p10,d.p25,d.p75,d.p90,d.max];check(ordered.every(v=>finite(v))&&finite(d.mean)&&typeof d.method==='string'&&d.method.length<1500);
 for(let i=0;i<360;i++){check(ordered.every((v,j)=>j===0||v[i]>=ordered[j-1][i]));check(d.mean[i]>=d.min[i]&&d.mean[i]<=d.max[i]);}
 return d;
}
export function validateEra(input:unknown):EraClimate{
 const d=input as EraClimate;check(d&&d.version===2&&d.complete===true&&d.latitude===60&&d.level===10&&d.units==='m/s'&&d.source===ERA_SOURCE&&Array.isArray(d.period)&&d.period.join(',')==='1993,2016'&&d.daily&&d.counts&&typeof d.method==='string');
 check(Object.keys(d.daily).length===366&&Object.keys(d.counts).length===366);
 for(let i=0;i<366;i++){const day=new Date(Date.UTC(2000,0,1+i)).toISOString().slice(5,10),v=d.daily[day];check(typeof v==='number'&&Number.isFinite(v)&&Math.abs(v)<200&&d.counts[day]===(day==='02-29'?6:24));}
 return d;
}
async function json(path:string,signal:AbortSignal):Promise<unknown|null>{
 const r=await fetch(SEASONAL_ROOT+path,{signal,cache:'no-cache'});if(r.status===404)return null;if(!r.ok)throw Error('Seasonal download is temporarily unavailable.');
 const raw=await r.text();if(raw.length>2_000_000)throw Error('Unexpected seasonal file size.');return JSON.parse(raw);
}
export async function fetchSeasonal(id:SeasonalId,signal:AbortSignal){const d=await json(`forecast/${id}.json`,signal);return d===null?null:validateForecast(d,id);}
export async function fetchClimate(id:SeasonalId,nominal:string,signal:AbortSignal){const cfg=SEASONAL_MODELS.find(m=>m.id===id)!,m=Number(nominal.slice(5,7));const d=await json(`climate/${id}-${cfg.system}-${String(m).padStart(2,'0')}.json`,signal);return d===null?null:validateClimate(d,id,m);}
export async function fetchEra(signal:AbortSignal){const d=await json('climate/era5-1993-2016.json',signal);return d===null?null:validateEra(d);}
export function validateEraProgress(input:unknown):EraProgress|null{
 const report=input as {version:number;checkedAt:string;era5?:{period:number[];totalYears:number;completedYears:number[];nextYear?:number|null;status:EraProgress['status']}};
 check(report&&report.version===1&&Number.isFinite(Date.parse(report.checkedAt)));
 const d=report.era5;if(!d)return null;
 check(d.period?.join(',')==='1993,2016'&&d.totalYears===24&&['updating','behind','complete','error'].includes(d.status));
 if(!d.completedYears&&d.status==='error')return null;
 check(Array.isArray(d.completedYears)&&d.completedYears.length<=24&&d.completedYears.every((y,i)=>Number.isInteger(y)&&y>=1993&&y<=2016&&(i===0||y>d.completedYears[i-1])));
 const nextYear=Array.from({length:24},(_,i)=>1993+i).find(y=>!d.completedYears.includes(y))??null;
 if(d.status!=='complete'&&d.status!=='error')check(d.nextYear===nextYear);
 return {checkedAt:report.checkedAt,completedYears:d.completedYears,nextYear,status:d.status};
}
export async function fetchEraProgress(signal:AbortSignal){
 const r=await fetch('https://raw.githubusercontent.com/matthewhugo81-arch/stratoscope/forecast-status/latest.json',{signal,cache:'no-cache'});
 if(!r.ok)throw Error('ERA5 progress could not be checked.');return validateEraProgress(await r.json());
}
