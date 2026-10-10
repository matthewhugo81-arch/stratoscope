"""Retrieve native member-wise 300-hPa V and preserve wave-packet envelopes."""
import argparse
from datetime import datetime, timezone, timedelta
import json
from pathlib import Path
import numpy as np
from ssw_sources import MODELS, Store, retrieve, run_time, stamp, digest, require
from ssw_wavepacket import envelope

def prepare(model,run,hours,output,cache):
    require(hours==sorted(set(hours)) and all(h>=0 for h in hours), 'Ordered distinct leads required')
    count=MODELS[model]['count'];store=Store(cache);points=[];results=[]
    for hour in hours:
        fields,_,evidence=retrieve(store,model,run,hour,{(300,'v')})
        v=np.stack([fields[m,300,'v'] for m in range(count)])
        packet=envelope(v,np.arange(90,-1,-1),np.arange(360))
        results.append(packet['latitudeMeanEnvelope'])
        points.append(dict(leadHours=hour,validTime=stamp(run+timedelta(hours=hour)),evidence=evidence))
        print('VERIFIED',model,stamp(run),hour,'300-hPa V',count,'members',flush=True)
    output.mkdir(parents=True,exist_ok=True)
    path=output/'wavepacket.npz'
    np.savez_compressed(path,memberEnvelope=np.stack(results),longitude=np.arange(360),leadHours=hours)
    report=dict(version=1,model=model,run=stamp(run),memberIds=list(range(count)),count=count,
        sourceClass=MODELS[model]['kind'],levelHpa=300,units='m/s',wavenumbers=[4,9],latitudeBand=[35,65],
        points=points,arraySha256=digest(path.read_bytes()),preparedAt=stamp(datetime.now(timezone.utc)),
        status='research_diagnostic',validatedArrivalForecast=False,rwbClassification=False,
        limitation='Meridional-wind spectral envelope only. No group velocity, source attribution, arrival prediction or calibrated impact probability.')
    (output/'wavepacket.json').write_text(json.dumps(report,indent=2,allow_nan=False),encoding='utf-8')
    return report

if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--model',choices=MODELS,required=True)
    p.add_argument('--run',type=run_time,required=True);p.add_argument('--hours',type=int,nargs='+',required=True)
    p.add_argument('--output',type=Path,required=True);p.add_argument('--cache',type=Path,default=Path('work/ssw-cache'))
    a=p.parse_args();prepare(a.model,a.run,a.hours,a.output,a.cache)
