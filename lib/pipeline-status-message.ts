export type PipelineFeed={model:string;availableRun?:string;publishedRun?:string;status:string;failureStage?:string;recoveryStatus?:string};
export type PipelineReport={version:number;checkedAt:string;models:PipelineFeed[];scheduledIntervalHours?:number};
export type PipelineNotice={kind:'current'|'warning'|'new-run';text:string};
const stamp=(s:string)=>new Date(s).toLocaleString('en-GB',{timeZone:'UTC',day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit',hour12:false});

/** Status wording only; does not fetch, schedule, alter forecasts or change layout. */
export function pipelineNotice(report:PipelineReport,feed:PipelineFeed,run:string,now=Date.now()):PipelineNotice{
 const checked=Date.parse(report.checkedAt);
 // The scheduled audit is every three hours. A 30-minute scheduling grace is
 // separate from model-publication health, which the backend reports itself.
 const interval=report.scheduledIntervalHours===3?report.scheduledIntervalHours:3;
 if(!Number.isFinite(checked)||now-checked>(interval*60+30)*60000||checked-now>300000){
  return {kind:'warning',text:`Freshness check overdue · last checked ${Number.isFinite(checked)?stamp(report.checkedAt)+' UTC':'unknown'}`};
 }
 const displayed=Date.parse(run),published=feed.status==='direct'?feed.availableRun:feed.publishedRun;
 if(published&&Date.parse(published)>displayed)return {kind:'new-run',text:`New run ready: ${stamp(published)} UTC`};
 if(feed.status==='error'){
  const target=feed.availableRun&&Date.parse(feed.availableRun)>displayed?`${stamp(feed.availableRun)} UTC update`:'Model update';
  if(feed.failureStage==='preparation'||feed.failureStage==='freshness'||feed.failureStage==='recovery'){
   const problem=feed.failureStage==='freshness'?'overdue':'failed';
   return {kind:'warning',text:`${target} ${problem}${feed.recoveryStatus==='updating'?' · recovery running, not yet published':''} · showing the last complete run.`};
  }
  if(feed.failureStage==='catalogue')return {kind:'warning',text:'Latest publication failed validation · showing the last complete run.'};
  return {kind:'warning',text:'Source or recovery check unavailable · showing the last complete run.'};
 }
 if(feed.availableRun&&Date.parse(feed.availableRun)>displayed){
  return {kind:'warning',text:`${stamp(feed.availableRun)} UTC ${feed.status==='updating'?'is being prepared':'awaiting preparation'} · showing the complete previous run.`};
 }
 if(feed.status!=='current'&&feed.status!=='direct')return {kind:'warning',text:'Model update not yet verified · showing the last complete run.'};
 return {kind:'current',text:`Latest complete source run · checked ${stamp(report.checkedAt)} UTC`};
}
