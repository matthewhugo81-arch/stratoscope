import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import ts from 'typescript';
const source=await readFile(new URL('../lib/pipeline-status-message.ts',import.meta.url),'utf8');
const {pipelineNotice}=await import('data:text/javascript;base64,'+Buffer.from(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText).toString('base64'));
const checkedAt='2026-10-10T21:38:00Z',run='2026-10-10T00:00:00Z',now=Date.parse(checkedAt);
const report={version:1,checkedAt,models:[],scheduledIntervalHours:3};
const current={model:'ifs_ens',publishedRun:run,availableRun:run,status:'current'};
test('three-hour checks are not falsely overdue after ninety minutes',()=>{
 for(const minutes of [0,91,179,180,210])assert.equal(pipelineNotice(report,current,run,now+minutes*60000).kind,'current');
});
test('a check becomes overdue after the three-hour interval and grace',()=>{
 const n=pipelineNotice(report,current,run,now+211*60000);assert.equal(n.kind,'warning');assert.match(n.text,/overdue/);
});
test('legacy reports default to the configured three-hour schedule',()=>{
 assert.equal(pipelineNotice({...report,scheduledIntervalHours:undefined},current,run,now+180*60000).kind,'current');
});
test('a newly published complete run remains loadable',()=>{
 const n=pipelineNotice(report,{...current,publishedRun:'2026-10-10T12:00:00Z'},run,now);assert.equal(n.kind,'new-run');assert.match(n.text,/12:00/);
});
test('failed preparations take precedence over the generic awaiting state',()=>{
 const n=pipelineNotice(report,{...current,availableRun:'2026-10-10T12:00:00Z',status:'error',failureStage:'preparation',recoveryStatus:'updating'},run,now);
 assert.equal(n.kind,'warning');assert.match(n.text,/failed/);assert.match(n.text,/recovery running, not yet published/);assert.doesNotMatch(n.text,/awaiting preparation|Latest complete source/);
});
test('prolonged recovery is overdue rather than falsely current',()=>{
 const n=pipelineNotice(report,{...current,availableRun:'2026-10-10T12:00:00Z',status:'error',failureStage:'freshness',recoveryStatus:'updating'},run,now);assert.match(n.text,/update overdue/);
});
test('normal new run preparation stays distinct from a failed attempt',()=>{
 const n=pipelineNotice(report,{...current,availableRun:'2026-10-10T12:00:00Z',status:'updating'},run,now);assert.match(n.text,/is being prepared/);assert.doesNotMatch(n.text,/failed/);
});
test('unavailable checks and malformed timestamps cannot claim healthy publication',()=>{
 for(const change of [{status:'error',failureStage:'provider'},{status:'unknown'}])assert.equal(pipelineNotice(report,{...current,...change},run,now).kind,'warning');
 assert.equal(pipelineNotice({...report,checkedAt:'invalid'},current,run,now).kind,'warning');
 assert.equal(pipelineNotice(report,current,run,now-600000).kind,'warning');
});
test('status component retains existing classes and updated-run button without chart mutations',async()=>{
 const ui=await readFile(new URL('../components/pipeline-status.tsx',import.meta.url),'utf8');
 assert.match(ui,/pipelineNotice\(report,feed,run\)/);assert.match(ui,/pipeline-current/);assert.match(ui,/pipeline-note/);assert.match(ui,/Load updated run/);assert.doesNotMatch(ui,/5400000/);
});
