// Viewed from above the North Pole, eastward longitude runs counterclockwise.
// Canvas y increases downwards, so longitude 0 is down and 90E is right.
// Use the same transform for coastlines and every PV contour.
export function projectVortexPoint(lon:number,lat:number,z:number,yaw:number,tilt:number){
 const a=lon*Math.PI/180,r=(90-lat)/60;
 const east=r*Math.sin(a),south=r*Math.cos(a);
 return {x:east*Math.cos(yaw)+south*Math.sin(yaw),y:(-east*Math.sin(yaw)+south*Math.cos(yaw))*Math.sin(tilt)-(z-.65)*Math.cos(tilt)};
}
