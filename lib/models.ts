export const MODELS = {
  gfs: {label:'NOAA GFS',provider:'NOAA / NCEP',levels:[10,20,30,50,70,100],maxHour:240,apiModel:null,resolution:'1° grid',note:'Direct GFS · fixed model run'},
  ecmwf: {label:'ECMWF IFS',provider:'ECMWF via Open-Meteo',levels:[50,100],maxHour:240,apiModel:'ecmwf_ifs025',resolution:'10° overview',note:'IFS 0.25° · sampled every 10°'},
  icon: {label:'DWD ICON',provider:'DWD via Open-Meteo',levels:[30,50,70,100],maxHour:168,apiModel:'icon_global',resolution:'10° overview',note:'ICON Global · sampled every 10°'},
  gfs_om: {label:'GFS · Open-Meteo',provider:'NOAA via Open-Meteo',levels:[30,50,70,100],maxHour:240,apiModel:'gfs_global',resolution:'10° overview',note:'GFS Global · sampled every 10°'},
} as const;
export type ModelId=keyof typeof MODELS;
export function isModel(value:string):value is ModelId{return Object.hasOwn(MODELS,value)}
export function supports(model:ModelId,level:number){return (MODELS[model].levels as readonly number[]).includes(level)}
export type ForecastMeta={model:ModelId;run:string;maxHour:number;levels:readonly number[];step:number;runKind:'cycle'|'rolling';fetchedAt:string};
