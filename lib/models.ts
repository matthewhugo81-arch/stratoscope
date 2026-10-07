export const MODELS = {
  gfs: {label:'NOAA GFS',provider:'NOAA / NCEP',levels:[10,20,30,50,70,100],maxHour:240,apiModel:null,resolution:'1° grid',note:'Direct GFS · fixed model run'},
  ecmwf_direct: {label:'ECMWF IFS · direct',provider:'ECMWF Open Data',levels:[10,50,100],maxHour:240,apiModel:null,resolution:'1° display grid',note:'IFS 0.25° · sampled every 1°'},
  gefs: {label:'GEFS · 31 members',provider:'NOAA / NCEP',levels:[10,20,30,50,70,100],maxHour:384,apiModel:null,resolution:'1° display grid',note:'GFS ensemble · 16 days · 0.5° source'},
  ifs_ens: {label:'ECMWF ENS · 51 members',provider:'ECMWF Open Data',levels:[10,50,100],maxHour:360,apiModel:null,resolution:'1° display grid',note:'IFS ensemble · 15 days · 0.25° source'},
  aifs_ens: {label:'AIFS ENS · 51 members',provider:'ECMWF Open Data',levels:[10,50,100],maxHour:360,apiModel:null,resolution:'1° display grid',note:'AI ensemble · 15 days · 0.25° source'},
  ecmwf: {label:'ECMWF · Open-Meteo',provider:'ECMWF via Open-Meteo',levels:[50,100],maxHour:240,apiModel:'ecmwf_ifs025',resolution:'10° overview',note:'IFS 0.25° · sampled every 10°'},
  icon: {label:'DWD ICON',provider:'DWD via Open-Meteo',levels:[30,50,70,100],maxHour:168,apiModel:'icon_global',resolution:'10° overview',note:'ICON Global · sampled every 10°'},
  gfs_om: {label:'GFS · Open-Meteo',provider:'NOAA via Open-Meteo',levels:[30,50,70,100],maxHour:240,apiModel:'gfs_global',resolution:'10° overview',note:'GFS Global · sampled every 10°'},
} as const;
export type ModelId=keyof typeof MODELS;
export type EnsembleModel='gefs'|'ifs_ens'|'aifs_ens';
export type EnsembleView='mean'|'spread'|'member';
export function isEnsemble(model:string):model is EnsembleModel{return model==='gefs'||model==='ifs_ens'||model==='aifs_ens'}
export function memberCount(model:EnsembleModel){return model==='gefs'?31:51}
export function isCycle(model:ModelId){return model==='gfs'||model==='ecmwf_direct'||isEnsemble(model)}
export function isModel(value:string):value is ModelId{return Object.hasOwn(MODELS,value)}
export function supports(model:ModelId,level:number){return (MODELS[model].levels as readonly number[]).includes(level)}
export type ForecastMeta={model:ModelId;run:string;maxHour:number;levels:readonly number[];step:number;runKind:'cycle'|'rolling';fetchedAt:string};
