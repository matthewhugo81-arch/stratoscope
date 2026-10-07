// WMO GRIB2 templates 5.2/5.3 and 7.2/7.3. Missing-value fields are rejected.
// https://codes.ecmwf.int/grib/format/grib2/templates/7/3/
export function decodeComplex(data:Uint8Array,template:DataView,count:number):Float64Array {
 const packing=template.getUint16(9),groups=template.getUint32(31),referenceBits=template.getUint8(19);
 if(template.getUint8(21)!==1||template.getUint8(22)!==0||groups>count||referenceBits>32)throw Error('Unsupported complex GRIB packing');
 let bit=0;
 function read(bits:number){
  if(bits>32||bit+bits>data.length*8)throw Error('Truncated complex GRIB field');
  let n=0,left=bits;
  while(left){const offset=bit%8,take=Math.min(8-offset,left);n=n*2**take+((data[bit>>3]>>(8-offset-take))&((1<<take)-1));bit+=take;left-=take;}
  return n;
 }
 const align=()=>{bit=Math.ceil(bit/8)*8;};
 const order=packing===3?template.getUint8(47):0,octets=packing===3?template.getUint8(48):0;
 if(packing===3&&(![1,2].includes(order)||octets<1||octets>4))throw Error('Unsupported spatial differencing');
 const initial=Array.from({length:order},()=>read(octets*8));
 let minimum=0;
 if(order){const sign=read(1),magnitude=read(octets*8-1);minimum=sign?-magnitude:magnitude;}
 const references=Array.from({length:groups},()=>read(referenceBits));align();
 const widths=Array.from({length:groups},()=>template.getUint8(35)+read(template.getUint8(36)));align();
 const lengths=Array.from({length:groups},()=>template.getUint32(37)+read(template.getUint8(46))*template.getUint8(41));align();
 if(groups)lengths[groups-1]=template.getUint32(42);
 if(lengths.reduce((a,b)=>a+b,0)!==count||widths.some(w=>w>32))throw Error('Invalid complex GRIB groups');
 const values=new Float64Array(count);let at=0;
 for(let g=0;g<groups;g++)for(let j=0;j<lengths[g];j++)values[at++]=references[g]+read(widths[g]);
 for(let i=0;i<order;i++)values[i]=initial[i];
 for(let i=order;order&&i<count;i++)values[i]+=minimum+(order===1?values[i-1]:2*values[i-1]-values[i-2]);
 return values;
}
