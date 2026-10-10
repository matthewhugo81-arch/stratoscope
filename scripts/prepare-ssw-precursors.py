"""Prepare source-qualified research products locally. Never push or deploy."""
import argparse
from datetime import datetime, timedelta, timezone, date
import json
from pathlib import Path
import numpy as np
from ssw_sources import MODELS, Store, retrieve, inventory, run_time, stamp, require, digest, requested_fields
from ssw_diagnostics import diagnose, area_mean, precursor_watch, rolling_forcing, matched_changes
from vortex_context import load_reference, daily_reference, interpolate_reference
from ssw_pv import pressure_pv, on_isentrope


def write_json(path, value):
    path.parent.mkdir(parents=True,exist_ok=True)
    blob = (json.dumps(value,indent=2,allow_nan=False)+'\n').encode()
    temp = path.with_suffix(path.suffix+'.tmp')
    temp.write_bytes(blob); temp.replace(path)
    return dict(path=path.name,bytes=len(blob),sha256=digest(blob))


def sectors(field):
    result = {}
    for name,lo,hi in [('northAtlantic',300,360),('europe',0,60),('asia',60,150),('northPacific',150,240),('northAmerica',240,300)]:
        result[name] = float(area_mean(field[:,lo:hi],45,75))
    result['polarCap'] = float(area_mean(field,75,90))
    return result


def height_context(fields, count, valid, reference, meta):
    height = np.stack([fields[m,500,'height'][:61] for m in range(count)])
    require(np.isfinite(height).all() and height.min()>3500 and height.max()<6500, 'Implausible H500')
    anomaly = height-interpolate_reference(daily_reference(reference,valid))
    require(np.abs(anomaly).max()<2000, 'Implausible H500 anomaly')
    return dict(reference=meta['id'],referenceSha256=meta['sha256'],referenceSource=meta['source'],
                referencePeriod=meta['period'],units='m',gridDegrees=1,
                interpretation='instantaneous model height minus daily-mean reanalysis climatology; includes model and sampling biases',
                sectorMeansByMember=[sectors(a) for a in anomaly],ensembleMeanSectors=sectors(anomaly.mean(axis=0))), height, anomaly


def tropopause(fields):
    t,p = fields[0,'2pvu','temperature'],fields[0,'2pvu','pressure']
    require(t.shape==p.shape==(61,360) and (p>1000).all(), 'Incomplete +2-PVU surface')
    theta = t*(100000/p)**(287.05/1004.)
    require(np.isfinite(theta).all() and (theta>180).all() and (theta<800).all(), 'Implausible tropopause theta')
    return theta


def forecast(args, store):
    run = run_time(args.run)
    require(len(set(args.hours))==len(args.hours) and args.hours==sorted(args.hours), 'Ordered unique leads required')
    reference,meta = load_reference()
    points = []
    for hour in args.hours:
        fields = requested_fields(args.model)
        if args.pv_levels:
            require(len(args.pv_levels)>=4 and args.pv_levels==sorted(set(args.pv_levels)), 'PV needs at least four unique ascending native pressure levels')
            fields |= {(level,key) for level in args.pv_levels for key in ('temperature','u','v')}
        if args.tropopause:
            require(args.model=='gfs', 'Native +2-PVU forecast support verified for GFS only')
            fields |= {('2pvu',key) for key in ('temperature','pressure','u','v')}
        values,winds,evidence = retrieve(store,args.model,run,hour,fields)
        valid = run+timedelta(hours=hour)
        context,height,anomaly = height_context(values,MODELS[args.model]['count'],valid,reference,meta)
        point = dict(hour=hour,validTime=stamp(valid),diagnostics=diagnose(args.model,values,winds),h500=context,evidence=evidence)
        arrays = dict(h500=height,h500Anomaly=anomaly)
        if args.pv_levels:
            def stack(key):
                return np.stack([np.stack([values[m,level,key] for level in args.pv_levels]) for m in range(MODELS[args.model]['count'])])
            theta,pv = pressure_pv(stack('temperature'),stack('u'),stack('v'),args.pv_levels,np.arange(90,-1,-1),np.arange(360))
            arrays['pressureDerivedPVU'] = pv
            coverage = {}
            for target in args.isentropes:
                arrays[f'pv_{target}K'],coverage[str(target)] = on_isentrope(theta,pv,target)
            point['derivedPV'] = dict(pressureLevelsHpa=args.pv_levels,coverage=coverage,
                method='member-wise pressure-coordinate Ertel PV; research finite differences',
                nativeProviderPV=False,validatedForRwb=False,
                caveat='Vertical spacing, derivative boundaries, subsurface levels and multiple theta crossings limit interpretation; independent PV comparison pending')
        if args.tropopause:
            arrays['theta2pvu'] = tropopause(values)
            point['nativeTropopause'] = dict(status='decoded',field='theta on +2-PVU surface',units='K',rwb='not_classified')
        else:
            point['nativeTropopause'] = dict(status='not_retrieved',reason='No verified native PV/2-PVU adapter for this product in this invocation')
        target = args.output/f'{args.model}-{run:%Y%m%d%H}-{hour}.npz'
        target.parent.mkdir(parents=True,exist_ok=True)
        np.savez_compressed(target,**arrays)
        point['maps'] = dict(path=target.name,sha256=digest(target.read_bytes()),grid=dict(nx=360,ny=61,lat0=90,lon0=0,dx=1,dy=-1))
        points.append(point)
        print(f'VERIFIED {args.model} {stamp(run)} +{hour}h {MODELS[args.model]["count"]} members',flush=True)
    forcing = {}
    if len(args.hours)>1 and np.all(np.diff(args.hours)==6):
        flux = [p['diagnostics']['heatFlux']['100']['total'] for p in points]
        forcing = {str(days):rolling_forcing(args.hours,flux,days) for days in (3,5,7)}
    result = dict(version=1,product='ssw_precursors_research',model=args.model,run=stamp(run),
        sourceClass=MODELS[args.model]['kind'],count=MODELS[args.model]['count'],memberIds=list(range(MODELS[args.model]['count'])),
        completeRequestedLeads=True,fullOperationalTimeline=False,requestedHours=args.hours,points=points,rollingForcing=forcing,
        preparedAt=stamp(datetime.now(timezone.utc)),watch=precursor_watch({}),
        limitations=['Research output; no publication or automatic alert','IFS deterministic/control is shared with IFS ENS member 0, not independent evidence',
                     'IFS and AIFS share ECMWF initial-state information; do not pool into 133 independent trials'])
    if args.previous_run:
        require(args.model!='icon', 'ICON cannot support a native 10-hPa wind comparison')
        previous=run_time(args.previous_run)
        offset=(run-previous).total_seconds()/3600
        require(offset>0 and offset==int(offset), 'Previous cycle must precede current cycle')
        old=[];receipts=[]
        for hour in args.hours:
            _,winds,evidence=retrieve(store,args.model,previous,hour+int(offset),{(10,'u')})
            require(set(winds)==set(range(MODELS[args.model]['count'])), 'Incomplete previous native winds')
            old.append(dict(hour=hour+int(offset),wind=[winds[m] for m in range(MODELS[args.model]['count'])]));receipts.append(evidence)
        old_series=dict(model=args.model,count=MODELS[args.model]['count'],run=stamp(previous),points=old)
        new_series=dict(model=args.model,count=MODELS[args.model]['count'],run=stamp(run),
            points=[dict(hour=p['hour'],wind=p['diagnostics']['wind10hpa60N']['members']) for p in points])
        result['runChanges']=dict(previousRun=stamp(previous),variable='10-hPa 60N wind ensemble mean',units='m s-1',
            points=matched_changes(old_series,new_series),evidence=receipts,
            interpretation='Matched valid times; member IDs are not paired trajectories across cycles')
    write_json(args.output/f'{args.model}.json',result)


def history(args, store):
    reference,meta = load_reference()
    result=[]
    # Every day must succeed. No f000 fallback and no partial seven-day manifest.
    for back in reversed(range(7)):
        day=args.end_date-timedelta(days=back)
        run=datetime(day.year,day.month,day.day,tzinfo=timezone.utc)
        fields={(500,'height')}|{('2pvu',key) for key in ('temperature','pressure','u','v')}
        values,_,evidence=retrieve(store,'gfs',run,0,fields,analysis=True)
        context,height,anomaly=height_context(values,1,run,reference,meta)
        theta=tropopause(values)
        path=args.output/f'analysis-{day}.npz';path.parent.mkdir(parents=True,exist_ok=True)
        np.savez_compressed(path,h500=height[0],h500Anomaly=anomaly[0],theta2pvu=theta,
                            u2pvu=values[0,'2pvu','u'],v2pvu=values[0,'2pvu','v'])
        result.append(dict(validTime=stamp(run),sourceClass='operational_analysis',model='gfs',
                           h500=context,theta2pvuRangeK=[float(theta.min()),float(theta.max())],
                           maps=dict(path=path.name,sha256=digest(path.read_bytes())),evidence=evidence))
        print(f'VERIFIED ANALYSIS {day} H500 and +2-PVU theta/flow',flush=True)
    write_json(args.output/'history.json',dict(version=1,complete=True,days=7,analyses=result,
        grid=dict(nx=360,ny=61,lat0=90,lon0=0,dx=1,dy=-1),sampling='00 UTC snapshots, not daily means',
        sourceClass='operational_analysis',notObservations=True,reanalysisVerification='pending independent ERA5/ERA5T retrieval',
        tropopauseDefinition='theta=T*(100000/p)^(287.05/1004) on native +2 PVU; not PV on an isentrope',
        rwb='not_classified; daily cadence cannot verify persistence',preparedAt=stamp(datetime.now(timezone.utc))))


def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--output',type=Path,required=True);p.add_argument('--cache',type=Path,default=Path('work/ssw-cache'))
    sub=p.add_subparsers(dest='command',required=True)
    f=sub.add_parser('forecast');f.add_argument('--model',choices=MODELS,required=True);f.add_argument('--run',required=True)
    f.add_argument('--hours',type=int,nargs='+',default=[0]);f.add_argument('--tropopause',action='store_true')
    f.add_argument('--pv-levels',type=int,nargs='+',help='Explicit native pressure levels; every member/variable must pass inventory and decode checks')
    f.add_argument('--isentropes',type=int,nargs='+',default=[315,330,350,450,850])
    f.add_argument('--previous-run',help='Independently retrieve every previous-cycle 10-hPa wind member at matching valid times')
    h=sub.add_parser('history');h.add_argument('--end-date',type=date.fromisoformat,required=True)
    a=p.parse_args();store=Store(a.cache)
    (forecast if a.command=='forecast' else history)(a,store)


if __name__=='__main__': main()
