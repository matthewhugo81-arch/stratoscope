// Viewed from above the North Pole, eastward longitude runs counterclockwise.
// Canvas y increases downwards, so longitude 0 is down and 90E is right.
// Use the same transform for coastlines and every PV contour.
export function projectVortexPoint(lon:number,lat:number,z:number,yaw:number,tilt:number){
 const a=lon*Math.PI/180,r=(90-lat)/60;
 const east=r*Math.sin(a),south=r*Math.cos(a);
 return {x:east*Math.cos(yaw)+south*Math.sin(yaw),y:(-east*Math.sin(yaw)+south*Math.cos(yaw))*Math.sin(tilt)-(z-.65)*Math.cos(tilt)};
}

// Lift the entire fullscreen scene, not its canvas or overlaid controls.
// Limit the lift on short screens. Inline framing and all zoom/rotation maths
// remain unchanged; the origin is independent of the forecast frame.
export function vortexScreenOrigin(width:number,height:number,expanded:boolean){
 const lift=expanded?Math.min(75,Math.max(0,height)*.1):0;
 return {x:width/2,y:height*.42-lift};
}
