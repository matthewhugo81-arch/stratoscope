import {getFrame,latestRun} from '@/lib/gfs';
import {ecmwfFrame,latestEcmwfRun} from '@/lib/ecmwf';
import {ensembleMember,latestEnsembleRun} from '@/lib/ensemble';
import {openMeteoFrame,OpenMeteoRateLimit} from '@/lib/open-meteo';
import {MODELS,isModel,isCycle,isEnsemble,memberCount,supports} from '@/lib/models';
export async function GET(request:Request){
 const q=new URL(request.url).searchParams,model=q.get('model')??'gfs';
 if(!isModel(model))return Response.json({error:'Unknown forecast model.'},{status:400});
 const config=MODELS[model];
 try{
  if(q.get('meta')==='1'){
   const run=isEnsemble(model)?await latestEnsembleRun(model):model==='gfs'?await latestRun():model==='ecmwf_direct'?await latestEcmwfRun():new Date(Math.floor(Date.now()/86400000)*86400000).toISOString();
   return Response.json({model,run,levels:config.levels,maxHour:config.maxHour,step:6,runKind:isCycle(model)?'cycle':'rolling',fetchedAt:new Date().toISOString()},{headers:{'Cache-Control':'public, max-age=300'}});
  }
  const hour=Number(q.get('hour')??0),level=Number(q.get('level')??10),run=q.get('run');
  if(!supports(model,level)||!Number.isInteger(hour)||hour<0||hour>config.maxHour||hour%6!==0||!run||!/^\d{4}-\d{2}-\d{2}T(00|06|12|18):00:00\.000Z$/.test(run)||!Number.isFinite(Date.parse(run))||Date.parse(run)>Date.now()||Date.parse(run)<Date.now()-9*86400000)return Response.json({error:'Choose a supported level and forecast time for this model.'},{status:400});
  if(!isCycle(model)&&(run.slice(11,13)!=='00'||Date.parse(run)<Math.floor(Date.now()/86400000)*86400000-86400000))return Response.json({error:'Refresh this rolling forecast to get the current dates.'},{status:400});
  if((model==='ecmwf_direct'||model==='ifs_ens')&&!['00','12'].includes(run.slice(11,13)))return Response.json({error:'Choose a complete ECMWF 00 or 12 UTC run.'},{status:400});
  const member=Number(q.get('member')??0);
  if(isEnsemble(model)&&(!Number.isInteger(member)||member<0||member>=memberCount(model)))return Response.json({error:'Choose a valid ensemble member.'},{status:400});
  const frame=isEnsemble(model)?await ensembleMember(model,run,hour,level,member):model==='gfs'?{...await getFrame(run,hour,level),model,runKind:'cycle'}:model==='ecmwf_direct'?await ecmwfFrame(run,hour,level):await openMeteoFrame(model,run,level,hour);
  return Response.json(frame,{headers:{'Cache-Control':isCycle(model)?'public, max-age=3600':'public, max-age=900'}});
 }catch(e){const retryAfter=e instanceof OpenMeteoRateLimit?e.retryAfter:undefined;return Response.json({error:e instanceof Error?e.message:'Forecast unavailable.',retryAfter},{status:retryAfter?429:502,headers:{'Cache-Control':'no-store',...(retryAfter?{'Retry-After':String(retryAfter)}:{})}});}
}
