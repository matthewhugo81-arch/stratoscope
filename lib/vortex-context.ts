export const heightReferenceId='ncep-ncar-r1-1991-2020-daily';
export const heightReferenceSha='87136b82338667251e999fe37c575acefa7444ff6647a7921282fe5d92b14b1a';
export type VortexBaseMap={version:1;model:'gefs';run:string;hour:number;validTime:string;count:31;pressure:500;units:'m';method:string;source:string;reference:string;referenceSha256:string;calendarDay:string;grid:{nx:number;ny:number;lat0:number;lon0:number;dx:number;dy:number};values:number[]};
export function validateVortexBaseMap(d:VortexBaseMap,run:string,hour:number){
 const valid=new Date(Date.parse(run)+hour*3600000).toISOString();
 if(d.version!==1||d.model!=='gefs'||d.run!==run||d.hour!==hour||d.validTime!==valid||d.count!==31||d.pressure!==500||d.units!=='m'||d.method!=='ensemble-mean-height-minus-daily-climatology'||d.source!=='https://noaa-gefs-pds.s3.amazonaws.com'||d.reference!==heightReferenceId||d.referenceSha256!==heightReferenceSha||d.calendarDay!==valid.slice(5,10)||JSON.stringify(d.grid)!=='{"nx":360,"ny":61,"lat0":90,"lon0":0,"dx":1,"dy":-1}'||!Array.isArray(d.values)||d.values.length!==61*360||d.values.some(v=>!Number.isFinite(v)||Math.abs(v)>=1500))throw Error('Invalid or mismatched 500 hPa anomaly base map');
 return d;
}
// A stable symmetric scale makes successive forecast times comparable.
// Near-normal heights fade into the map so the vortex remains prominent.
export const heightAnomalyLimit=300;
const stops=[[-300,108,83,195],[-180,58,114,205],[-60,89,181,221],[0,154,183,195],[60,237,187,113],[180,235,113,55],[300,196,52,65]];
export function heightAnomalyColour(value:number):[number,number,number,number]{
 const v=Math.max(-300,Math.min(300,value));let i=1;while(i<stops.length-1&&v>stops[i][0])i++;
 const a=stops[i-1],b=stops[i],f=(v-a[0])/(b[0]-a[0]);
 return [Math.round(a[1]+f*(b[1]-a[1])),Math.round(a[2]+f*(b[2]-a[2])),Math.round(a[3]+f*(b[3]-a[3])),Math.round(255*Math.min(1,Math.abs(v)/75))];
}
export function sampleHeightAnomaly(d:VortexBaseMap,lon:number,lat:number){
 const x=((lon%360)+360)%360,y=Math.max(0,Math.min(60,90-lat)),x0=Math.floor(x),y0=Math.floor(y),x1=(x0+1)%360,y1=Math.min(60,y0+1),fx=x-x0,fy=y-y0;
 return (1-fy)*((1-fx)*d.values[y0*360+x0]+fx*d.values[y0*360+x1])+fy*((1-fx)*d.values[y1*360+x0]+fx*d.values[y1*360+x1]);
}
