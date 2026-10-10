import {temperatureBands,temperatureTicks} from './temperature-scale';
import {windStops,windMax} from './globe';
import {MODELS,isModel} from './models';
import type {Frame} from './grib';
import {utcStamp,type ExportGradient} from './chart-export-meta';
export function mapGradient(field:string,spread=false):ExportGradient{
 const wind=field==='wind',limit=spread?(wind?30:15):windMax;
 if(!wind&&!spread)return {title:'Temperature · °C',stops:temperatureBands.flatMap(b=>[{at:(b.lower+90)/110,colour:`rgb(${b.rgb.join(',')})`},{at:(b.upper+90)/110,colour:`rgb(${b.rgb.join(',')})`}]),ticks:temperatureTicks.map(v=>({at:(v+90)/110,label:(v>0?'+':'')+v}))};
 return {title:(spread?'Population standard deviation · ':'Wind speed · ')+(wind?'m/s':'°C'),stops:windStops.map((rgb,i)=>({at:i/(windStops.length-1),colour:`rgb(${rgb.join(',')})`})),ticks:Array.from({length:5},(_,i)=>({at:i/4,label:String(limit*i/4)}))};
}
export function mapTitle(frame:Frame,field:string){
 const model=frame.model??'gfs';if(!isModel(model))throw Error('The displayed model identity could not be verified.');
 return MODELS[model].label+` · ${frame.level} hPa · ${field==='wind'?'wind speed':'temperature'}`+(frame.ensemble?` · ${frame.ensemble.view}${frame.ensemble.view==='member'?' '+frame.ensemble.member:''}`:'');
}
export function mapSubtitle(frame:Frame){return ['Run '+utcStamp(frame.run),`Forecast +${frame.hour}h · Valid ${utcStamp(frame.valid)}`];}
