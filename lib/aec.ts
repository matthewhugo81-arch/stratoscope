// CCSDS 121 / GRIB2 template 5.42, unsigned samples.
// Adapted from Pascal Spörri's MIT-licensed go-tiled-eccodes/aec decoder.
// See THIRD_PARTY_NOTICES.txt. Checked against ECMWF ecCodes on live IFS fields.
export function decodeAec(src:Uint8Array,count:number,bits:number,flags:number,block:number,rsi:number){
 if(bits<1||bits>32||count<1||count>2100000||block<2||block>256||block%2||rsi<1||rsi>4096||(flags&1)||(flags&~62))throw Error('Unsupported CCSDS configuration');
 if((flags&16)&&bits>4&&bits<=8)throw Error('Unsupported CCSDS restricted code');
 let bit=0;
 function read(n:number){
  if(bit+n>src.length*8)throw Error('Truncated CCSDS field');
  let v=0;while(n){const offset=bit%8,take=Math.min(8-offset,n);v=v*2**take+((src[Math.floor(bit/8)]>>(8-offset-take))&((1<<take)-1));bit+=take;n-=take;}return v;
 }
 function unary(){let n=0;while(read(1)===0){if(++n>2**bits)throw Error('Invalid CCSDS unary code');}return n;}
 const idBits=bits>16?5:bits>8?4:(flags&16)?(bits<=2?1:2):3,idMax=2**idBits-1,max=2**bits-1,pp=!!(flags&8),size=block*rsi;
 const output=new Uint32Array(count),buffer=new Uint32Array(size);let at=0,pos=0;
 function flush(){
  const n=Math.min(pos,count-at);let last=buffer[0];
  for(let i=0;i<n;i++){
   const v=buffer[i];
   if(pp&&i){const half=Math.ceil(v/2);last=half<=Math.min(last,max-last)?last+(v%2?-half:half):last>=2**(bits-1)?max-v:v;}else last=v;
   if(last<0||last>max)throw Error('Invalid CCSDS sample');output[at++]=last;
  }
  pos=0;
 }
 while(at+pos<count){
  const ref=pp&&pos===0?1:0,id=read(idBits);
  if(id===idMax){for(let i=0;i<block;i++)buffer[pos++]=read(bits);}
  else if(id){
   if(ref)buffer[pos++]=read(bits);
   const k=id-1,n=block-ref,start=pos;
   for(let i=0;i<n;i++)buffer[start+i]=unary()*2**k;
   if(k)for(let i=0;i<n;i++)buffer[start+i]+=read(k);
   pos+=n;
  }else{
   const sub=read(1);if(ref)buffer[pos++]=read(bits);
   if(sub){
    for(let i=ref;i<block;){const m=unary();if(m>90)throw Error('Invalid CCSDS second extension');const sum=Math.floor((Math.sqrt(8*m+1)-1)/2),second=m-sum*(sum+1)/2;if(i%2===0){buffer[pos++]=sum-second;i++;}buffer[pos++]=second;i++;}
   }else{
    let blocks=unary()+1;
    if(blocks===5){const done=Math.floor(pos/block);blocks=Math.min(rsi-done,64-done%64);}else if(blocks>5)blocks--;
    const n=blocks*block-ref;if(pos+n>size)throw Error('Invalid CCSDS zero run');buffer.fill(0,pos,pos+n);pos+=n;
   }
  }
  if(pos===size){flush();if(flags&32)bit=Math.ceil(bit/8)*8;}
  else if(pos>size)throw Error('Invalid CCSDS reference interval');
 }
 if(pos)flush();return output;
}
