// Regular latitude/longitude GRIB2, simple packing 5.0 and CCSDS 5.42.
import {decodeComplex} from './complex-packing';
import {decodeAec} from './aec';
import type {ZonalWind} from './zonal-wind';
export type Grid = {nx:number;ny:number;lat0:number;lon0:number;dx:number;dy:number};
export type Frame = {run:string;hour:number;level:number;valid:string;grid:Grid;temperature:number[];height:number[];u:number[];v:number[];wind?:number[];zonalWind60N?:ZonalWind;source:string;model?:string;runKind?:'cycle'|'rolling';fetchedAt?:string;preparedAt?:string;ensemble?:{view:'mean'|'spread'|'member';member?:number;count:number}};
const signed=(v:number,bits:number)=>v&2**(bits-1)?-(v&(2**(bits-1)-1)):v;
export function decodeGrib(buffer:ArrayBuffer){
 const d=new DataView(buffer);let pos=0;const fields:Record<string,number[]>={};let grid:Grid|undefined,run='',hour=-1,level=-1,member:number|undefined,product:number|undefined;
 while(pos<buffer.byteLength){
  if(d.getUint32(pos)!==0x47524942||d.getUint8(pos+7)!==2)throw Error('Invalid GRIB2 response');
  const size=Number(d.getBigUint64(pos+8));if(size<20||pos+size>buffer.byteLength)throw Error('Truncated GRIB2 response');
  let p=pos+16,key='',geopotential=false,reference=0,binary=0,decimal=0,bits=0,count=0,bitmap=255,packing=0,flags=0,block=0,rsi=0;let localGrid:Grid|undefined,complex:DataView|undefined;
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
    const template=d.getUint16(p+7);
    if(![0,1].includes(template)||d.getUint8(p+17)!==1||d.getUint8(p+22)!==100||(template===1&&len<37))throw Error('Unsupported forecast product');
    const m=template===1?d.getUint8(p+35):undefined;
    if(product!==undefined&&(product!==template||member!==m))throw Error('Mixed ensemble members');product=template;member=m;
    const h=d.getUint32(p+18),l=d.getUint32(p+24)*10**(-signed(d.getUint8(p+23),8))/100;
    if(hour!==-1&&(hour!==h||level!==l))throw Error('Mixed forecast fields');hour=h;level=l;
    const names:Record<string,string>={'0:0':'temperature','3:5':'height','3:4':'height','2:2':'u','2:3':'v'},parameter=d.getUint8(p+9)+':'+d.getUint8(p+10);key=names[parameter];geopotential=parameter==='3:4';
   }
   if(section===5){packing=d.getUint16(p+9);if(![0,2,3,42].includes(packing))throw Error('Unsupported GRIB packing');count=d.getUint32(p+5);reference=d.getFloat32(p+11);binary=signed(d.getUint16(p+15),16);decimal=signed(d.getUint16(p+17),16);bits=d.getUint8(p+19);if(bits>32||count>2100000)throw Error('Unsupported field size');if(packing===42){if(len<25)throw Error('Truncated CCSDS metadata');flags=d.getUint8(p+21);block=d.getUint8(p+22);rsi=d.getUint16(p+23);}}
   if(section===5&&(packing===2||packing===3)){if(len<(packing===3?49:47))throw Error('Truncated complex metadata');complex=new DataView(buffer,p,len);}
   if(section===6)bitmap=d.getUint8(p+5);
   if(section===7&&key){
    if(bitmap!==255||!localGrid||count!==localGrid.nx*localGrid.ny||(packing===0&&Math.ceil(count*bits/8)>len-5))throw Error('Missing or incomplete field');
    const values=new Array<number>(count),factor=2**binary,scale=10**(-decimal);let bit=0;
    const packed=complex?decodeComplex(new Uint8Array(buffer,p+5,len-5),complex,count):packing===42&&bits?decodeAec(new Uint8Array(buffer,p+5,len-5),count,bits,flags,block,rsi):null;
    for(let i=0;i<count;i++){let n=packed?packed[i]:0,left=packed?0:bits;while(left>0){const byte=d.getUint8(p+5+(bit>>3)),offset=bit&7,take=Math.min(8-offset,left);n=n*2**take+((byte>>(8-offset-take))&((1<<take)-1));bit+=take;left-=take;}values[i]=Math.round((((reference+n*factor)*scale-(key==='temperature'?273.15:0))/(geopotential?9.80665:1))*100)/100;}
    if(fields[key])throw Error('Duplicate forecast field');
    fields[key]=values;
   }
   p+=len;
  }
  if(d.getUint32(pos+size-4)!==0x37373737)throw Error('Missing GRIB terminator');pos+=size;
 }
 if(!grid||!run)throw Error('No grid in response');return {grid,run,hour,level,member,product,fields};
}
