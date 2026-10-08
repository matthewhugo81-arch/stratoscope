// A short great-circle step along the actual east/north wind vector, used
// only to project its direction. This avoids longitude singularities near poles.
export function windArrowTarget(lat:number,lon:number,u:number,v:number){
 const speed=Math.hypot(u,v);if(!Number.isFinite(speed)||speed<2)return null;
 const rad=Math.PI/180,phi=lat*rad,lambda=lon*rad,bearing=Math.atan2(u,v),step=.5*rad;
 const phi2=Math.asin(Math.sin(phi)*Math.cos(step)+Math.cos(phi)*Math.sin(step)*Math.cos(bearing));
 const lambda2=lambda+Math.atan2(Math.sin(bearing)*Math.sin(step)*Math.cos(phi),Math.cos(step)-Math.sin(phi)*Math.sin(phi2));
 return {lat:phi2/rad,lon:lambda2/rad,speed,length:10+Math.min(speed,100)*.16};
}
