"""Experimental NH PV-contour overturning candidates, never operational alerts.

Geometry follows the first/last intersection orientation in Strong &
Magnusdottir (2008), doi:10.1175/2008JAS2632.1, Appendix. Additional flow and
scale screens below are explicit research choices, not a validated replication.
No H500, pressure-level PV, or theta-on-PV input can enter this interface.
"""
import numpy as np
from ssw_sources import require


def intersections(vertices, meridian):
    """Half-open segment convention avoids counting a shared vertex twice."""
    a,b = vertices[:-1],vertices[1:]
    use = ((a[:,0] <= meridian)&(b[:,0] > meridian))|((b[:,0] <= meridian)&(a[:,0] > meridian))
    indices = np.flatnonzero(use)
    return [(int(i),float(a[i,1]+(meridian-a[i,0])/(b[i,0]-a[i,0])*(b[i,1]-a[i,1]))) for i in indices]


def tongue_at_meridian(vertices, meridian):
    vertices = np.asarray(vertices,dtype=float)
    require(vertices.ndim==2 and vertices.shape[1]==2 and np.isfinite(vertices).all(), 'Invalid contour')
    if vertices[-1,0] < vertices[0,0]: vertices=vertices[::-1]
    hits = intersections(vertices,meridian)
    if len(hits)<3 or len(hits)%2==0:return None
    # NH PV increases poleward outside the tongue. Intervals 1..2, 3..4
    # enclose poleward low-PV air, rather than the unbounded subtropical region.
    by_lat=sorted(hits,key=lambda p:p[1])
    pairs=[(by_lat[i],by_lat[i+1]) for i in range(1,len(by_lat)-1,2)]
    south,north=max(pairs,key=lambda p:p[1][1]-p[0][1])
    if north[1]-south[1]<5:return None
    first,last=sorted([south,north],key=lambda p:p[0])
    return dict(south=south[1],north=north[1],orientation='anticyclonic' if first[1]>last[1] else 'cyclonic')


def detect_candidates(pv, u, v, latitudes, longitudes, metadata, contour_pvu=2.):
    """Return screened candidates on a single isentrope at one valid time.

Persistence is deliberately not inferred from one image. A candidate has no
right to set rwb_validated in the precursor state machine.
"""
    require(metadata.get('field')=='pv_on_isentrope' and metadata.get('units')=='PVU' and
            isinstance(metadata.get('thetaK'),(int,float)) and 300<=metadata['thetaK']<=400 and
            metadata.get('sourceClass') in ['operational_analysis','reanalysis','deterministic_forecast','ensemble_forecast'] and
            bool(metadata.get('source')) and bool(metadata.get('validTime')), 'Source-qualified isentropic PV required')
    lat,lon=np.asarray(latitudes),np.asarray(longitudes)
    require(pv.shape==u.shape==v.shape==(len(lat),len(lon)) and np.isfinite(pv).all() and np.isfinite(u).all() and np.isfinite(v).all(), 'Complete PV and collocated flow required')
    require(len(lon)>=144 and np.allclose(lon,np.arange(len(lon))*360/len(lon)), 'Complete periodic longitude grid required')
    require(np.all(np.diff(lat)>0) and lat[0]<=20 and lat[-1]>=80, 'Ascending 20..80N coverage required')
    if not (np.all(pv[0]<contour_pvu) and np.all(pv[-1]>contour_pvu)):
        return dict(status='unverified_poleward_pv_orientation',candidates=[],validated=False)
    import contourpy
    tiled=np.tile(pv,(1,3));x=np.concatenate([lon-360,lon,lon+360])
    lines=contourpy.contour_generator(x=x,y=lat,z=tiled,line_type='Separate').lines(contour_pvu)
    # Closed isolated cutoffs cannot span two full periods. An open contour
    # must connect the tiled zonal boundaries instead of a latitude boundary.
    circumpolar=[line for line in lines if abs(line[-1,0]-line[0,0])>=719 and
                 abs(line[-1,1]-line[0,1])<2 and line[:,1].min()>lat[0] and line[:,1].max()<lat[-1]]
    if not circumpolar:return dict(status='no_eligible_circumpolar_contour',candidates=[],validated=False)
    line=max(circumpolar,key=len)
    meridians=[]
    for longitude in range(360):
        tongue=tongue_at_meridian(line,longitude)
        if tongue is None:continue
        column=int(round(longitude/(360/len(lon))))%len(lon)
        low,high=tongue['south'],tongue['north']
        rows=(lat>=low)&(lat<=high)
        if rows.sum()<2:continue
        shear=(np.interp(high,lat,u[:,column])-np.interp(low,lat,u[:,column]))/(high-low)
        poleward=float(v[rows,column].mean())
        consistent=(shear>0 if tongue['orientation']=='anticyclonic' else shear<0) and poleward>.5
        if consistent:meridians.append(dict(longitude=longitude,**tongue,shearMpsPerDegree=float(shear),polewardWindMps=poleward))
    # Group contiguous same-orientation columns, including the dateline seam.
    groups=[]
    for item in meridians:
        if groups and item['longitude']==groups[-1][-1]['longitude']+1 and item['orientation']==groups[-1][-1]['orientation']:groups[-1].append(item)
        else:groups.append([item])
    if len(groups)>1 and groups[0][0]['longitude']==0 and groups[-1][-1]['longitude']==359 and groups[0][0]['orientation']==groups[-1][-1]['orientation']:
        groups[0]=groups.pop()+groups[0]
    candidates=[dict(orientation=g[0]['orientation'],columns=g,zonalExtentDegrees=len(g),
                      flowCriteria='poleward low-PV tongue v > 0.5 m/s and matching sign of du/dlatitude',
                      persistence='unverified',classification='research_candidate') for g in groups if len(g)>=5]
    return dict(status='research_only',candidates=candidates,validated=False,contourPVU=contour_pvu,
                scientificLimits=['Scale and flow screens require independent case validation',
                    'No tracking/persistence or irreversibility established','No operational AWB/CWB event count'],source=metadata)
