import type {Frame} from './grib';
import {frameZonalWind,type ZonalWind} from './zonal-wind';

// Welford accumulation keeps only running statistics, not all member grids.
// Wind means/spreads refer to scalar speed, calculated before averaging.
export function ensembleStatistics(expected:number){
 let template:Frame|undefined,count=0;const seen=new Set<number>();
 let zonalTemplate:ZonalWind|undefined,zonalTotal=0,zonalCount=0;
 const means:Record<string,Float64Array>={},m2:Record<string,Float64Array>={};
 return {
  add(frame:Frame){
   const member=frame.ensemble?.member,n=frame.temperature.length;
   if(frame.ensemble?.view!=='member'||frame.ensemble.count!==expected||member===undefined||!Number.isInteger(member)||member<0||member>=expected||seen.has(member))throw Error('Duplicate or invalid ensemble member');
   if(template&&(frame.model!==template.model||frame.run!==template.run||frame.hour!==template.hour||frame.level!==template.level||JSON.stringify(frame.grid)!==JSON.stringify(template.grid)))throw Error('Mismatched ensemble forecasts');
   for(const key of ['temperature','height','u','v'] as const)if(frame[key].length!==n||!frame[key].every(Number.isFinite))throw Error('Incomplete ensemble grid');
   if(n!==frame.grid.nx*frame.grid.ny)throw Error('Invalid ensemble grid size');
   if(frame.level===10&&frame.zonalWind60N){const z=frameZonalWind(frame);if(zonalTemplate&&(z.samples!==zonalTemplate.samples||z.basis!==zonalTemplate.basis||z.longitudeStep!==zonalTemplate.longitudeStep))throw Error('Mismatched zonal-wind sampling');zonalTemplate=z;zonalTotal+=z.value;zonalCount++;}
   if(!template){template=frame;for(const key of ['temperature','height','u','v','wind']){means[key]=new Float64Array(n);m2[key]=new Float64Array(n);}}
   seen.add(member);count++;
   for(let i=0;i<n;i++)for(const key of ['temperature','height','u','v','wind'] as const){const x=key==='wind'?Math.hypot(frame.u[i],frame.v[i]):frame[key][i],delta=x-means[key][i];means[key][i]+=delta/count;m2[key][i]+=delta*(x-means[key][i]);}
  },
  finish(){
   if(!template||count!==expected)throw Error('Every ensemble member is required to calculate mean and spread');
   const base={...template,fetchedAt:new Date().toISOString()};delete base.zonalWind60N;
   const mean:Frame={...base,ensemble:{view:'mean',count}},spread:Frame={...base,ensemble:{view:'spread',count}};
   if(zonalTemplate&&zonalCount===expected){mean.zonalWind60N={...zonalTemplate,value:zonalTotal/expected};spread.zonalWind60N=mean.zonalWind60N;}
   for(const key of ['temperature','height','u','v','wind'] as const){mean[key]=Array.from(means[key],x=>Math.round(x*100)/100);spread[key]=key==='temperature'||key==='wind'?Array.from(m2[key],x=>Math.round(Math.sqrt(Math.max(0,x/count))*100)/100):mean[key];}
   // On spread maps the contours remain ensemble-mean geopotential height.
   return {mean,spread};
  }
 };
}
