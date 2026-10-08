// A short great-circle step along the actual east/north wind vector, used
// only to project its direction. This avoids longitude singularities near poles.
export function windArrowTarget(lat:number,lon:number,u:number,v:number,shadedSpeed?:number){
 const speed=Math.hypot(u,v);if(!Number.isFinite(speed)||speed<2)return null;
 const rad=Math.PI/180,phi=lat*rad,lambda=lon*rad,bearing=Math.atan2(u,v),step=.5*rad;
 const phi2=Math.asin(Math.sin(phi)*Math.cos(step)+Math.cos(phi)*Math.sin(step)*Math.cos(bearing));
 const lambda2=lambda+Math.atan2(Math.sin(bearing)*Math.sin(step)*Math.cos(phi),Math.cos(step)-Math.sin(phi)*Math.sin(phi2));
 // Size follows the displayed speed shading; ensemble mean speed can differ
 // from the magnitude of its mean vector. Direction still uses actual u/v.
 const strength=shadedSpeed!==undefined&&Number.isFinite(shadedSpeed)&&shadedSpeed>=0?shadedSpeed:speed;
 const length=3+Math.min(strength,120)*.13;
 return {lat:phi2/rad,lon:lambda2/rad,speed,length,head:Math.max(1.2,Math.min(4.5,length*.27))};
}
