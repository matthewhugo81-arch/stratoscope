"""Publication health, independent of whether a recovery process has started.

A queued/running job is not evidence of a successful update. Keep the last valid
publication available, while reporting failed attempts and a persistent backlog.
No source credentials are read, and this module never dispatches workflows.
"""
from datetime import datetime, timezone, timedelta
import importlib.util
from pathlib import Path

FAILURES = {'failure', 'timed_out', 'action_required'}
MAX_BACKLOG = timedelta(hours=3)


def parsed(value):
    try:
        result = datetime.fromisoformat(value.replace('Z', '+00:00'))
        return result if result.tzinfo is not None else None
    except (AttributeError, TypeError, ValueError):
        return None


def iso(value):
    return value.isoformat(timespec='milliseconds').replace('+00:00', 'Z')


def record_health(results, previous, now, github=None, workflows=None):
    previous = previous if isinstance(previous, dict) else {}
    old = {(r.get('model'), r.get('sourceModel')): r for r in previous.get('models', []) if isinstance(r, dict)}
    workflow_runs = {}
    jobs = {}
    for result in results:
        published, available = parsed(result.get('publishedRun')), parsed(result.get('availableRun'))
        if published is None or available is None or published >= available:
            continue
        key = (result['model'], result.get('sourceModel'))
        earlier = old.get(key, {})
        earlier_published, earlier_available = parsed(earlier.get('publishedRun')), parsed(earlier.get('availableRun'))
        was_behind = earlier_published is not None and earlier_available is not None and earlier_published < earlier_available
        since = (parsed(earlier.get('behindSince')) or parsed(previous.get('checkedAt'))) if was_behind else None
        since = min(since or now, now)
        result['behindSince'] = iso(since)
        result['backlogMinutes'] = round((now-since).total_seconds()/60, 1)
        recovery_status = result['status']
        if recovery_status == 'updating':
            result['recoveryStatus'] = 'updating'
        if now-since >= MAX_BACKLOG:
            result.update(status='error', failureStage='freshness',
                          message='A newer complete run has remained unpublished for at least three hours; recovery is not yet verified.')
        model = result['model']
        # Diagnostics are handled against both parent publication and upstream
        # freshness below. Native model attempts are inspected separately.
        if github is None or workflows is None or model not in {'gefs','ifs_ens','aifs_ens','icon'}:
            continue
        workflow = workflows[model]
        try:
            if workflow not in workflow_runs:
                workflow_runs[workflow] = github('/actions/workflows/'+workflow+'/runs?per_page=12&branch=main')['workflow_runs']
            last = None
            for run in workflow_runs[workflow]:
                if run.get('conclusion') not in FAILURES and run.get('status') == 'completed':
                    continue
                if run['id'] not in jobs:
                    jobs[run['id']] = github('/actions/runs/'+str(run['id'])+'/jobs')['jobs']
                relevant = jobs[run['id']]
                if model in {'ifs_ens','aifs_ens'}:
                    relevant = [j for j in relevant if j.get('name') == f'prepare ({model})']
                for job in relevant:
                    ended = parsed(job.get('completed_at'))
                    if job.get('conclusion') in FAILURES and ended is not None and ended > (parsed(result.get('preparedAt')) or published):
                        if last is None or ended > last[0]:
                            last = (ended, run['html_url'], job['conclusion'])
            if last:
                result.update(status='error', failureStage='preparation', lastFailedAt=iso(last[0]),
                              lastFailedWorkflow=last[1], lastFailure=last[2],
                              message='A preparation attempt failed after the last publication. '+
                                      ('Another attempt is active, but the new run is not published yet.' if recovery_status == 'updating' else 'The replacement run has not been published.'))
        except Exception as error:
            result.update(status='error', failureStage='workflow-check',
                          message='Could not verify recovery outcome: '+type(error).__name__)
    parents = {r['model']:r for r in results if r['model'] in {'gefs','ifs_ens','aifs_ens'}}
    for result in results:
        if result['model'] != 'diagnostics':
            continue
        parent = parents.get(result.get('sourceModel'), {})
        result['upstreamAvailableRun'] = parent.get('availableRun')
        if parent.get('status') == 'error':
            result['alignedWithPublishedInputs'] = result['status'] == 'current'
            result.update(status='error', failureStage='upstream',
                          message='Diagnostic inputs are stale or their source cannot be verified; awaiting the parent model recovery.')
        elif parent.get('status') == 'updating' and result['status'] == 'current':
            result.update(status='updating', alignedWithPublishedInputs=True,
                          message='Aligned with the last published model; a newer upstream run is still being prepared.')


def seasonal_health(public, now):
    spec = importlib.util.spec_from_file_location('seasonal_release_config', Path(__file__).with_name('seasonal_config.py'))
    config = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(config)
    result = []
    for model in config.MODELS:
        target = config.latest(model, now)
        item = {'model':model, 'expectedIssue':config.iso(target)}
        try:
            data = public('forecast-data-seasonal', 'forecast/'+model+'.json')
            current = config.current_forecast(data, model, target)
            item.update(publishedIssue=data.get('nominal'), memberCount=data.get('memberCount'),
                        status='current' if current else 'behind')
            if not current:
                due = target.replace(day=6 if model == 'ecmf' else 10, hour=12)
                if now >= due+MAX_BACKLOG:
                    item.update(status='error', message='Expected seasonal issue is not yet published as a complete validated ensemble. This is not proof of complete upstream availability.')
        except Exception as error:
            item.update(status='error', message=type(error).__name__+': seasonal publication could not be validated')
        result.append(item)
    return result
