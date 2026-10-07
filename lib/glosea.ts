export const GLOSEA_URL='https://raw.githubusercontent.com/matthewhugo81-arch/stratoscope/forecast-data-glosea/latest.json';
export const GLOSEA_SOURCE='https://cds.climate.copernicus.eu/datasets/seasonal-original-pressure-levels';
export type GloSea={version:1;model:'glosea';system:'610';complete:true;nominal:string;preparedAt:string;source:string;latitude:60;level:10;units:'m/s';sampling:string;memberCount:50;dates:string[];members:{id:string;start:string;values:number[]}[];mean:number[];easterlyFraction:number[];attribution:string;method:string};
const DAY=86400000;
function requireValue(condition:unknown):asserts condition{if(!condition)throw Error('The seasonal wind dataset is incomplete or invalid.');}
function stamp(value:unknown):value is string{return typeof value==='string'&&/^\d{4}-\d{2}-\d{2}T00:00:00\.000Z$/.test(value)&&Number.isFinite(Date.parse(value));}
export function validateGloSea(input:unknown):GloSea{
 const d=input as GloSea;requireValue(d&&typeof d==='object');
 requireValue(d.version===1&&d.model==='glosea'&&d.system==='610'&&d.complete===true&&d.latitude===60&&d.level===10&&d.units==='m/s'&&d.source===GLOSEA_SOURCE);
 requireValue(stamp(d.nominal)&&d.nominal.slice(8,10)==='01'&&Date.parse(d.nominal)>=Date.parse('2026-04-01'));
 requireValue(typeof d.preparedAt==='string'&&Number.isFinite(Date.parse(d.preparedAt))&&Date.parse(d.preparedAt)>=Date.parse(d.nominal));
 requireValue(d.sampling==='00 UTC daily samples'&&d.memberCount===50&&Array.isArray(d.members)&&d.members.length===50);
 requireValue(Array.isArray(d.dates)&&d.dates.length===180&&d.dates.every((v,i)=>stamp(v)&&Date.parse(v)===Date.parse(d.nominal)+(i+1)*DAY));
 const finite=(a:unknown):a is number[]=>Array.isArray(a)&&a.length===180&&a.every(v=>typeof v==='number'&&Number.isFinite(v)&&Math.abs(v)<200);
 const ids=new Set<string>(),starts=new Map<string,number>();
 for(const m of d.members){
  requireValue(m&&stamp(m.start)&&typeof m.id==='string'&&/^\d{8}-\d+$/.test(m.id)&&m.id.startsWith(m.start.slice(0,10).replaceAll('-','')+'-')&&!ids.has(m.id)&&finite(m.values));
  const lag=(Date.parse(d.nominal)-Date.parse(m.start))/DAY;requireValue(Number.isInteger(lag)&&lag>=0&&lag<25);
  ids.add(m.id);starts.set(m.start,(starts.get(m.start)??0)+1);
 }
 requireValue(starts.size===25&&[...starts.values()].every(n=>n===2)&&finite(d.mean)&&finite(d.easterlyFraction));
 for(let i=0;i<180;i++){
  requireValue(Math.abs(d.mean[i]-d.members.reduce((s,m)=>s+m.values[i],0)/50)<.0011);
  requireValue(Math.abs(d.easterlyFraction[i]-d.members.filter(m=>m.values[i]<0).length/50)<.00011);
 }
 requireValue(typeof d.attribution==='string'&&d.attribution.length<600&&typeof d.method==='string'&&d.method.length<1500);
 return d;
}
export async function fetchGloSea(signal:AbortSignal):Promise<GloSea|null>{
 const response=await fetch(GLOSEA_URL,{signal,cache:'no-cache'});
 if(response.status===404)return null;
 if(!response.ok)throw Error('The seasonal outlook could not be downloaded.');
 const raw=await response.text();if(raw.length>2_000_000)throw Error('Unexpected seasonal data size.');
 return validateGloSea(JSON.parse(raw));
}
