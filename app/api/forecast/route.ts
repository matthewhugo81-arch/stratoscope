import {getFrame,latestRun,LEVELS} from '@/lib/gfs';
export async function GET(request:Request){
 const q=new URL(request.url).searchParams;
 try{
  if(q.get('meta')==='1')return Response.json({run:await latestRun(),levels:LEVELS,maxHour:240,step:6},{headers:{'Cache-Control':'public, max-age=300'}});
  const hour=Number(q.get('hour')??0),level=Number(q.get('level')??10),run=q.get('run');
  if(!LEVELS.includes(level)||!Number.isInteger(hour)||hour<0||hour>240||hour%6!==0||!run||!/^\d{4}-\d{2}-\d{2}T(00|06|12|18):00:00\.000Z$/.test(run)||!Number.isFinite(Date.parse(run))||Date.parse(run)>Date.now()||Date.parse(run)<Date.now()-9*86400000)return Response.json({error:'Choose an available run, level and forecast hour.'},{status:400});
  return Response.json(await getFrame(run,hour,level),{headers:{'Cache-Control':'public, max-age=3600'}});
 }catch(e){return Response.json({error:e instanceof Error?e.message:'Forecast unavailable.'},{status:502,headers:{'Cache-Control':'no-store'}});}
}
