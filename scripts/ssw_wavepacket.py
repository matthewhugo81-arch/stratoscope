"""Research Rossby-wave-packet envelope, not wave-breaking or arrival diagnosis."""
import numpy as np
from ssw_sources import require

def envelope(v, latitudes, longitudes, wavenumbers=(4,9), band=(35,65)):
    """Member-first band-pass meridional wind and analytic-signal amplitude.

    Last dimensions must be latitude/longitude. Values are m/s. This spatial
    diagnostic is not Takaya-Nakamura flux, group velocity or an RWB classifier.
    """
    v=np.asarray(v,dtype=float); lat=np.asarray(latitudes); lon=np.asarray(longitudes)
    require(v.shape[-2:]==(len(lat),len(lon)) and np.isfinite(v).all(), 'Complete wind grid required')
    require(len(lon)>=72 and np.allclose(lon,np.arange(len(lon))*360/len(lon)), 'Periodic full-longitude grid required')
    require(len(lat)>1 and (np.all(np.diff(lat)>0) or np.all(np.diff(lat)<0)), 'Monotonic latitudes required')
    lo,hi=wavenumbers
    require(isinstance(lo,int) and isinstance(hi,int) and 1<=lo<=hi<len(lon)/2, 'Invalid wave-number band')
    require(lat.min()<=band[0]<band[1]<=lat.max(), 'Missing latitude band')
    rows=(lat>=band[0])&(lat<=band[1]); weights=np.cos(np.deg2rad(lat[rows]))
    coefficients=np.fft.fft(v,axis=-1)
    filt=np.zeros(len(lon));filt[lo:hi+1]=2
    analytic=np.fft.ifft(coefficients*filt,axis=-1)
    amplitude=np.abs(analytic)
    return dict(bandPassedWind=analytic.real,amplitude=amplitude,
        latitudeMeanEnvelope=np.average(amplitude[...,rows,:],weights=weights,axis=-2),
        units='m/s',wavenumbers=list(wavenumbers),latitudeBand=list(band),
        interpretation='Spatial wave-packet envelope; no inferred propagation direction, arrival time or AWB/CWB type')

def lagged_predictor(index, issue_time, valid_time, lag_days):
    """Select only a known-at-issue MJO record; future/revised histories leak skill."""
    from datetime import timedelta
    import re
    from ssw_research_archive import utc
    issue,valid=utc(issue_time),utc(valid_time)
    require(isinstance(lag_days,int) and lag_days>=0 and valid>=issue, 'Invalid lead/lag')
    target=(valid-timedelta(days=lag_days)).date().isoformat()
    require(index.get('definition') in ('BOM_RMM','CPC_WH'), 'Named index definition required')
    require(re.fullmatch('[a-f0-9]{64}',index.get('inputSha256','')) and index.get('sourceUrl','').startswith('https://'), 'MJO source receipt required')
    if utc(index['retrievedAt'])>issue:
        return dict(status='unavailable_at_issue',causalAttribution=False)
    rows=[r for r in index['records'] if r['date']==target]
    require(len(rows)<=1, 'Duplicate MJO date')
    if not rows or target>issue.date().isoformat():
        return dict(status='missing_or_future_index',causalAttribution=False)
    row=rows[0]; rmm=np.array([row['rmm1'],row['rmm2']],float)
    require(np.isfinite(rmm).all() and (abs(rmm)<20).all(), 'Invalid MJO components')
    require(isinstance(row['phase'],int) and row['phase'] in range(1,9), 'Invalid source phase')
    amplitude=float(np.hypot(*rmm))
    return dict(status='available',definition=index['definition'],date=target,
        phase=row['phase'],amplitude=amplitude,active=amplitude>=1,lagDays=lag_days,
        causalAttribution=False,forecastImpact='not calibrated')
