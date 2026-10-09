"""Member-first diagnostics on complete, regular global longitude circles.

Temperatures are Kelvin; heights are metres. Raw fractions, geometric proxies,
and phase relationships are deliberately separate from calibrated predictions.
"""
from datetime import datetime, timedelta
import numpy as np
from ssw_sources import MODELS, require, stamp


def band_weights(latitudes, south, north):
    lat = np.asarray(latitudes, dtype=float)
    require(lat.ndim == 1 and len(lat) > 1 and np.isfinite(lat).all(), 'Invalid latitudes')
    delta = np.diff(lat)
    require(np.allclose(delta, delta[0]) and delta[0] != 0, 'Regular latitude centres required')
    step = abs(delta[0])
    require(lat.min()-step/2 <= south < north <= lat.max()+step/2, 'Latitude band not covered')
    low = np.clip(lat-step/2, south, north)
    high = np.clip(lat+step/2, south, north)
    return np.maximum(0, np.sin(np.deg2rad(high))-np.sin(np.deg2rad(low)))


def area_mean(field, south=60, north=90):
    lat = 90-np.arange(field.shape[-2])
    weights = band_weights(lat, south, north)
    return np.sum(np.mean(field,axis=-1)*weights,axis=-1)/weights.sum()


def heat_flux(v, temperature, expected_count):
    require(v.shape == temperature.shape == (expected_count,91,360), 'Incomplete member/grid coverage')
    require(np.isfinite(v).all() and np.isfinite(temperature).all(), 'Missing flux values')
    vp = v-v.mean(axis=-1,keepdims=True)
    tp = temperature-temperature.mean(axis=-1,keepdims=True)
    covariance = np.mean(vp*tp,axis=-1)
    vf, tf = np.fft.rfft(vp,axis=-1)/360, np.fft.rfft(tp,axis=-1)/360
    waves = [2*np.real(vf[...,k]*np.conj(tf[...,k])) for k in (1,2)]
    weights = band_weights(90-np.arange(91),45,75)
    def average(a): return np.sum(a*weights,axis=-1)/weights.sum()
    total, wave1, wave2 = map(average,[covariance,*waves])
    return dict(total=total.tolist(),wave1=wave1.tolist(),wave2=wave2.tolist(),
                residual=(total-wave1-wave2).tolist(), units='K m s-1', latitudeBand=[45,75],
                gridDegrees=1, method='member-zonal-covariance-before-ensemble-average')


def waves(height):
    require(height.ndim == 3 and height.shape[1:] == (91,360) and np.isfinite(height).all(), 'Incomplete height field')
    coefficients = np.fft.rfft(height,axis=-1)/360
    weights = band_weights(90-np.arange(91),45,75)
    output = {}
    for k in (1,2):
        # Average COMPLEX coefficients before reporting band phase. Store magnitude
        # and coherence to expose cancellation instead of averaging wrapped angles.
        c = np.sum(coefficients[...,k]*weights,axis=-1)/weights.sum()
        rms = np.sum(np.abs(coefficients[...,k])*weights,axis=-1)/weights.sum()
        output[str(k)] = dict(amplitudeM=(2*np.abs(c)).tolist(),
                             phaseRadians=np.angle(c).tolist(),
                             coherence=np.divide(np.abs(c),rms,out=np.zeros_like(rms),where=rms>1e-12).tolist())
    return output


def cross_level(wave_by_level):
    levels = sorted(wave_by_level,reverse=True)
    output = []
    for lower, upper in zip(levels,levels[1:]):
        for k in (1,2):
            lo, hi = wave_by_level[lower][str(k)],wave_by_level[upper][str(k)]
            phase = np.angle(np.exp(1j*(np.asarray(hi['phaseRadians'])-np.asarray(lo['phaseRadians']))))
            reliable = (np.asarray(lo['amplitudeM'])>1)&(np.asarray(hi['amplitudeM'])>1)&(np.asarray(lo['coherence'])>.2)&(np.asarray(hi['coherence'])>.2)
            output.append(dict(lowerHpa=lower,upperHpa=upper,wave=k,
                upperMinusLowerPhaseRadians=[float(p) if ok else None for p,ok in zip(phase,reliable)],
                interpretation='descriptive phase relationship; not proof of upward propagation or EP flux'))
    return output


def height_geometry(height):
    """Low-height fixed equivalent-area mask; NOT a PV vortex edge/split diagnosis."""
    require(height.shape[-2:] == (91,360) and np.isfinite(height).all(), 'Incomplete geometry field')
    lat = 90-np.arange(61)
    w = np.broadcast_to(band_weights(lat,30,90)[:,None]/360,(61,360))
    lon = np.deg2rad(np.arange(360))[None,:]
    phi = np.deg2rad(lat)[:,None]
    xyz = np.stack(np.broadcast_arrays(np.cos(phi)*np.cos(lon),np.cos(phi)*np.sin(lon),np.sin(phi)),axis=-1)
    result = []
    for member in height:
        h = member[:61]
        order = np.argsort(h,axis=None)
        target = 1-np.sin(np.deg2rad(70))
        cut = np.searchsorted(np.cumsum(w.ravel()[order]), target)
        threshold = h.ravel()[order[min(cut,len(order)-1)]]
        mask = h <= threshold
        actual_area = w[mask].sum()
        # Flat fields have no uniquely identifiable vortex geometry.
        if np.ptp(h)<1 or actual_area > target*1.25:
            result.append(None); continue
        weight = w*mask
        centroid = np.sum(xyz*weight[...,None],axis=(0,1))/weight.sum()
        norm = np.linalg.norm(centroid)
        latitude = np.rad2deg(np.arcsin(centroid[2]/norm))
        longitude = float(np.rad2deg(np.arctan2(centroid[1],centroid[0]))%360)
        # Orthographic projected second moments for shape; explicitly proxy units.
        xy = xyz[...,:2]; centre = np.sum(xy*weight[...,None],axis=(0,1))/weight.sum()
        delta = xy-centre
        covariance = np.einsum('yxi,yxj,yx->ij',delta,delta,weight)/weight.sum()
        eig = np.linalg.eigvalsh(covariance)
        result.append(dict(centroidLatitude=float(latitude),centroidLongitude=longitude,
            displacementDegrees=float(90-latitude),aspectRatio=float(np.sqrt(eig[-1]/max(eig[0],1e-12))),thresholdM=float(threshold)))
    return dict(method='low-height-equivalent-area-70N-proxy',members=result,
                caveat='Not a PV/Nash edge; no displacement-type or split-type SSW classification')


def summary(values):
    a = np.asarray(values,dtype=float)
    require(a.ndim == 1 and len(a)>0 and np.isfinite(a).all(), 'Incomplete member statistic')
    return dict(count=len(a),mean=float(a.mean()),minimum=float(a.min()),maximum=float(a.max()),
                p10=float(np.quantile(a,.1)),p90=float(np.quantile(a,.9)))


def reversal_fraction(values):
    require(len(values)>1, 'Fractions apply to ensembles only')
    s = summary(values)
    s.update(easterlyMembers=sum(v<0 for v in values),fraction=sum(v<0 for v in values)/len(values),
             interpretation='raw instantaneous member fraction; not calibrated SSW probability')
    return s


def diagnose(model, fields, native_winds):
    count = MODELS[model]['count']
    def stack(level,key):
        return np.stack([fields[m,level,key] for m in range(count)])
    levels = sorted({level for _,level,_ in fields if isinstance(level,int)})
    flux, wave, temperature, geometry = {}, {}, {}, {}
    for level in levels:
        if (0,level,'height') in fields: wave[level] = waves(stack(level,'height'))
        if (0,level,'temperature') in fields:
            temperature[str(level)] = area_mean(stack(level,'temperature')).tolist()
            flux[str(level)] = heat_flux(stack(level,'v'),stack(level,'temperature'),count)
            if (0,level,'height') in fields:
                geometry[str(level)] = height_geometry(stack(level,'height'))
    output = dict(heatFlux=flux,heightWaves=wave,crossLevelPhase=cross_level(wave),
                  polarCapTemperatureK=temperature,geometry=geometry,
                  geometryStatus='height-proxy-only; native/isentropic PV edge not inferred')
    if 10 in levels:
        require(set(native_winds)==set(range(count)), 'Missing native 10-hPa wind members')
        winds = [native_winds[m] for m in range(count)]
        output['wind10hpa60N'] = dict(members=winds,units='m s-1',basis='native full-longitude signed mean',
                                     statistics=reversal_fraction(winds) if count>1 else summary(winds))
    else:
        output['wind10hpa60N'] = dict(status='unavailable',reason='10 hPa outside verified adapter coverage; no vertical extrapolation')
    return output


def matched_changes(previous, current, variable='wind'):
    """Compare ensemble means at identical valid times; members are not run-paired."""
    require(previous['model']==current['model'] and previous['count']==current['count'], 'Cannot compare different model ensembles as successive cycles')
    pr, cr = (datetime.fromisoformat(x['run'].replace('Z','+00:00')) for x in (previous,current))
    require(pr < cr, 'Previous run must precede current run')
    old = {stamp(pr+timedelta(hours=p['hour'])):p for p in previous['points']}
    require(len(old)==len(previous['points']), 'Duplicate previous times')
    result = []
    for point in current['points']:
        valid = stamp(cr+timedelta(hours=point['hour']))
        if valid not in old: continue
        a,b = old[valid][variable],point[variable]
        require(len(a)==len(b)==current['count'], 'Partial member arrays')
        result.append(dict(validTime=valid,previousLead=old[valid]['hour'],currentLead=point['hour'],
                           meanChange=summary(b)['mean']-summary(a)['mean']))
    return result


def rolling_forcing(hours, members, days):
    """Trapezoidal integral of signed and positive flux; no seasonal calibration."""
    hours, members = np.asarray(hours),np.asarray(members,dtype=float)
    require(days in (3,5,7) and len(hours)>1 and members.ndim==2 and members.shape[0]==len(hours), 'Invalid forcing series')
    require(np.isfinite(members).all() and np.all(np.diff(hours)==6), 'Consecutive six-hour samples required')
    window = days*4+1
    return [dict(hour=int(hours[i]),days=days,units='K m s-1 day',
        signed=np.trapezoid(members[i-window+1:i+1],dx=.25,axis=0).tolist(),
        positive=np.trapezoid(np.maximum(0,members[i-window+1:i+1]),dx=.25,axis=0).tolist())
        for i in range(window-1,len(hours))]


STAGES = [
    ('background_monitoring', ['coverage_complete']),
    ('tropospheric_watch', ['coverage_complete','rwb_validated','tropospheric_persistence']),
    ('upward_forcing_watch', ['coverage_complete','rwb_validated','tropospheric_persistence','forcing_calibrated','propagation_supported']),
    ('vortex_response_watch', ['coverage_complete','forcing_calibrated','propagation_supported','multi_cycle_response','independent_model_support']),
    ('reversal_scenario', ['coverage_complete','daily_mean_reversal','season_and_event_criteria_checked']),
]


def precursor_watch(evidence):
    """Tri-state scientific evidence, not a sum of arbitrary uncalibrated scores.

Evidence records must include a source and explicitly verified true/false/null.
No absence of evidence is converted into a reassuring background state.
"""
    passed = lambda key: isinstance(evidence.get(key),dict) and evidence[key].get('verified') is True and bool(evidence[key].get('source'))
    eligible = [name for name,needs in STAGES if all(passed(k) for k in needs)]
    return dict(stage=eligible[-1] if eligible else 'insufficient_evidence',
        eligibleStages=eligible, unmet={name:[k for k in needs if not passed(k)] for name,needs in STAGES},
        evidence=evidence,sswDeclared=False,probability=None,
        uncertainty='Research indicators require independent case validation; no calibrated SSW probability')
