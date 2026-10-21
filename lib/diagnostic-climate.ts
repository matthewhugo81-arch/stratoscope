import climate from './diagnostic-climate.json';

export const climateLabel='Long-term mean · 1978/79–2025/26';
export const climateSource=climate.sources;
const dayMs=86400000;
type Metric='wind'|'temperature';

/** Calendar-day normals, interpolated between UTC midnights; no seasonal shift in leap years. */
export function diagnosticClimate(time:number,key:Metric):number {
 if(!Number.isFinite(time))throw Error('Invalid climate comparison time');
 const daily=(date:Date):number=>{
  const month=date.getUTCMonth(),day=date.getUTCDate(),values=climate[key];
  if(month===1&&day===29)return (values[58]+values[59])/2;
  const index=(Date.UTC(2001,month,day)-Date.UTC(2001,0,1))/dayMs;
  return values[index];
 };
 const midnight=Math.floor(time/dayMs)*dayMs,fraction=(time-midnight)/dayMs;
 return daily(new Date(midnight))*(1-fraction)+daily(new Date(midnight+dayMs))*fraction;
}

export function diagnosticClimateSeries(start:number,end:number,key:Metric){
 if(!Number.isFinite(start)||!Number.isFinite(end)||end<start)throw Error('Invalid climate chart range');
 const times=[start];
 for(let time=(Math.floor(start/dayMs)+1)*dayMs;time<end;time+=dayMs)times.push(time);
 if(end>start)times.push(end);
 return times.map(time=>({time,value:diagnosticClimate(time,key)}));
}
