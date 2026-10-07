// NOAA NOMADS filtered GFS: GRIB2 grid 3.0 and simple packing 5.0.
export type Grid = {nx:number;ny:number;lat0:number;lon0:number;dx:number;dy:number};
export type Frame = {run:string;hour:number;level:number;valid:string;grid:Grid;temperature:number[];height:number[];u:number[];v:number[];source:string};
const signed=(v:number,bits:number)=>v&2**(bits-1)?-(v&(2**(bits-1)-1)):v;
export function decodeGrib(buffer:ArrayBuffer){
 const d=new DataView(buffer);let pos=0;const fields:Record<string,number[]>={};let grid:Grid|undefined,run='',hour=-1,level=-1;
 while(pos<buffer.byteLength){
  if(d.getUint32(pos)!==0x47524942||d.getUint8(pos+7)!==2)throw Error('Invalid GRIB2 response');
  const size=Number(d.getBigUint64(pos+8));if(size<20||pos+size>buffer.byteLength)throw Error('Truncated GRIB2 response');
  let p=pos+16,key='',reference=0,binary=0,decimal=0,bits=0,count=0,bitmap=255;let localGrid:Grid|undefined;
  while(p<pos+size-4){
   const len=d.getUint32(p),section=d.getUint8(p+4);if(len<5||p+len>pos+size-4)throw Error('Invalid GRIB section');
   if(section===1){const r=new Date(Date.UTC(d.getUint16(p+12),d.getUint8(p+14)-1,d.getUint8(p+15),d.getUint8(p+16))).toISOString();if(run&&run!==r)throw Error('Mixed forecast cycles');run=r;}
   if(section===3){
    if(d.getUint16(p+12)!==0||d.getUint32(p+38)!==0)throw Error('Unsupported latitude/longitude grid');
    const scan=d.getUint8(p+71);if(scan&0x30)throw Error('Unsupported grid scan');
    localGrid={nx:d.getUint32(p+30),ny:d.getUint32(p+34),lat0:signed(d.getUint32(p+46),32)/1e6,lon0:signed(d.getUint32(p+50),32)/1e6,dx:d.getUint32(p+63)/1e6*(scan&128?-1:1),dy:d.getUint32(p+67)/1e6*(scan&64?1:-1)};
    if(grid&&JSON.stringify(grid)!==JSON.stringify(localGrid))throw Error('Mismatched field grids');grid=localGrid;
   }
   if(section===4){
    if(d.getUint16(p+7)!==0||d.getUint8(p+17)!==1||d.getUint8(p+22)!==100)throw Error('Unsupported forecast product');
    const h=d.getUint32(p+18),l=d.getUint32(p+24)*10**(-signed(d.getUint8(p+23),8))/100;
    if(hour!==-1&&(hour!==h||level!==l))throw Error('Mixed forecast fields');hour=h;level=l;
    const names:Record<string,string>={'0:0':'temperature','3:5':'height','2:2':'u','2:3':'v'};key=names[d.getUint8(p+9)+':'+d.getUint8(p+10)];
   }
   if(section===5){if(d.getUint16(p+9)!==0)throw Error('Upstream GRIB packing changed; simple packing required');count=d.getUint32(p+5);reference=d.getFloat32(p+11);binary=signed(d.getUint16(p+15),16);decimal=signed(d.getUint16(p+17),16);bits=d.getUint8(p+19);if(bits>32||count>1000000)throw Error('Unsupported field size');}
   if(section===6)bitmap=d.getUint8(p+5);
   if(section===7&&key){
    if(bitmap!==255||!localGrid||count!==localGrid.nx*localGrid.ny||Math.ceil(count*bits/8)>len-5)throw Error('Missing or incomplete field');
    const values=new Array<number>(count),factor=2**binary,scale=10**(-decimal);let bit=0;
    for(let i=0;i<count;i++){let n=0,left=bits;while(left>0){const byte=d.getUint8(p+5+(bit>>3)),offset=bit&7,take=Math.min(8-offset,left);n=n*2**take+((byte>>(8-offset-take))&((1<<take)-1));bit+=take;left-=take;}values[i]=Math.round(((reference+n*factor)*scale-(key==='temperature'?273.15:0))*100)/100;}
    fields[key]=values;
   }
   p+=len;
  }
  if(d.getUint32(pos+size-4)!==0x37373737)throw Error('Missing GRIB terminator');pos+=size;
 }
 if(!grid||!run)throw Error('No grid in response');return {grid,run,hour,level,fields};
}
