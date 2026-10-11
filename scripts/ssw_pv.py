"""Research pressure-coordinate Ertel PV; explicit masks and vertical resolution.

Not native provider PV, not a dynamical-tropopause observation. Retain vertical
levels and interpolation ambiguity; do not use sparse levels to certify RWB.
"""
import numpy as np
from ssw_sources import require


def pressure_pv(temperature_k, u, v, pressures_hpa, latitudes, longitudes):
    """Input (member, pressure, latitude, longitude); output theta and PVU."""
    t=np.asarray(temperature_k,dtype=float);u=np.asarray(u);v=np.asarray(v)
    p=np.asarray(pressures_hpa,dtype=float)*100
    lat=np.asarray(latitudes,dtype=float);lon=np.asarray(longitudes,dtype=float)
    require(t.shape==u.shape==v.shape and t.ndim==4 and t.shape[1:]==(len(p),len(lat),len(lon)), 'PV array dimensions differ')
    require(len(p)>=4 and np.all(np.diff(p)>0) and p.min()>0, 'At least four ascending pressure levels required')
    require(np.isfinite(t).all() and np.isfinite(u).all() and np.isfinite(v).all() and (t>100).all() and (t<350).all(), 'Missing or non-Kelvin PV input')
    require(len(lat)>2 and np.allclose(np.diff(lat),np.diff(lat)[0]) and np.diff(lat)[0]!=0 and np.max(np.abs(lat))<=90, 'Regular latitudes required')
    require(len(lon)>=144 and np.allclose(lon,np.arange(len(lon))*360/len(lon)), 'Complete global longitude circle required')
    phi=np.deg2rad(lat);a=6371000.;omega=7.292115e-5
    cos=np.cos(phi)[None,None,:,None];safe=np.where(np.abs(cos)<1e-8,np.nan,cos)
    theta=t*(100000/p[None,:,None,None])**(287.05/1004.)
    dl=lambda x:(np.roll(x,-1,axis=-1)-np.roll(x,1,axis=-1))/(2*np.deg2rad(360/len(lon)))
    dy=lambda x:np.gradient(x,phi,axis=2,edge_order=2)/a
    dp=lambda x:np.gradient(x,p,axis=1,edge_order=2)
    relative=(dl(v)/a-dy(u*cos))/safe
    pv=-9.80665*((relative+2*omega*np.sin(phi)[None,None,:,None])*dp(theta)+dp(u)*dy(theta)-dp(v)*dl(theta)/(a*safe))*1e6
    # Derivative boundaries and the exact poles have no centred estimate.
    pv[:,[0,-1],:,:]=np.nan;pv[:,:,[0,-1],:]=np.nan
    return theta,pv


def on_isentrope(theta,pv,target):
    """Interpolate only unique crossings; multiple/no crossings remain masked."""
    require(theta.shape==pv.shape and theta.ndim==4 and np.isfinite(theta).all(), 'Invalid PV/theta profiles')
    require(250<=target<=2000, 'Invalid isentrope')
    out=np.full(theta.shape[:1]+theta.shape[2:],np.nan);crossings=np.zeros_like(out,dtype=int)
    for i in range(theta.shape[1]-1):
        upper,lower=theta[:,i],theta[:,i+1]
        # Half-open intervals avoid counting an exact-level crossing twice.
        cross=((lower<=target)&(target<upper))|((upper<=target)&(target<lower))
        valid=cross&np.isfinite(pv[:,i])&np.isfinite(pv[:,i+1])
        fraction=np.divide(target-lower,upper-lower,out=np.zeros_like(lower),where=upper!=lower)
        estimate=pv[:,i+1]+fraction*(pv[:,i]-pv[:,i+1])
        out[valid]=estimate[valid];crossings+=cross
    out[crossings!=1]=np.nan
    return out,dict(uniqueFraction=float(np.isfinite(out).mean()),multipleCrossingCells=int((crossings>1).sum()),
                    noCrossingCells=int((crossings==0).sum()),targetK=target,method='linear pressure-derived PV at unique theta crossing')
