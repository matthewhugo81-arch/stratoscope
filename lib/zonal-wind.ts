import type {Frame,Grid} from './grib';
import {isEnsemble,memberCount,type ModelId} from './models';

export type ZonalWind={value:number;samples:number;longitudeStep:number;basis:'native'|'display'};

// A single regular latitude circle has equal longitude weights. Retain the sign
// of u (eastward positive); scalar speed and |u| cannot diagnose a reversal.
export function zonalMeanAt60(u:number[],g:Grid):ZonalWind{
 const spacing=Math.abs(g.dx),row=(60-g.lat0)/g.dy;
 if(!Number.isInteger(g.nx)||!Number.isInteger(g.ny)||g.nx<2||g.ny<1||!Number.isFinite(g.lon0)||!Number.isFinite(g.dy)||g.dy===0||!Number.isFinite(spacing)||spacing===0||!Number.isFinite(row)||Math.abs(row-Math.round(row))>1e-7||row<0||row>=g.ny||u.length!==g.nx*g.ny)throw Error('A complete 60°N wind row is unavailable.');
 // Some grids repeat the first meridian at 360°. Count it only once.
 const samples=Math.abs(g.nx*spacing-360)<1e-6?g.nx:Math.abs((g.nx-1)*spacing-360)<1e-6?g.nx-1:0;
 if(!samples)throw Error('The wind grid does not cover the full latitude circle.');
 let sum=0;const start=Math.round(row)*g.nx;
 for(let x=0;x<samples;x++){const value=u[start+x];if(!Number.isFinite(value))throw Error('Missing wind data on the 60°N latitude circle.');sum+=value;}
 return {value:sum/samples,samples,longitudeStep:spacing,basis:'native'};
}

export function frameZonalWind(frame:Frame):ZonalWind{
 if(frame.level!==10)throw Error('The polar-vortex indicator requires 10 hPa data.');
 if(frame.zonalWind60N){const z=frame.zonalWind60N;if(!Number.isFinite(z.value)||!Number.isInteger(z.samples)||z.samples<2||!Number.isFinite(z.longitudeStep)||z.longitudeStep<=0||Math.abs(z.samples*z.longitudeStep-360)>1e-6||!['native','display'].includes(z.basis))throw Error('Invalid zonal-wind diagnostic.');return z;}
 // Older HTTP-cached frames still work, with the coarser sampling labelled.
 return {...zonalMeanAt60(frame.u,frame.grid),basis:'display'};
}

export function matchesZonalFrame(frame:Frame|null|undefined,model:ModelId,run:string,hour:number,member:number):frame is Frame{
 return !!frame&&frame.level===10&&(frame.model??'gfs')===model&&frame.run===run&&frame.hour===hour&&(!isEnsemble(model)||frame.ensemble?.count===memberCount(model)&&(member<0?['mean','spread'].includes(frame.ensemble.view):frame.ensemble.view==='member'&&frame.ensemble.member===member));
}

export function windDisplay(value:number){
 // Preserve tiny signed values without displaying a misleading signed zero.
 const text=value===0?'0.0':Math.abs(value)<.05?(value<0?'−<0.1':'+<0.1'):(value<0?'−':'+')+Math.abs(value).toFixed(1);
 return {text,direction:value>0?'Westerly':value<0?'Easterly':'Zero zonal wind',tone:value>0?'westerly':value<0?'easterly':'neutral'};
}
