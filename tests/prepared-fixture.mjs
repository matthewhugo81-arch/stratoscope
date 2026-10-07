import {gzipSync} from 'node:zlib';
export const run='2026-10-07T00:00:00.000Z';
// Deliberately different mean scalar speed (20) and vector-mean speed (5).
export function preparedFixture(model='ifs_ens',hour=0,level=10,override={}){
 const header={version:1,model,run,hour,level,count:model==='gefs'?31:51,grid:{nx:360,ny:91,lat0:90,lon0:0,dx:1,dy:-1},scale:100,planes:7,source:model==='gefs'?'https://noaa-gefs-pds.s3.amazonaws.com':'https://data.ecmwf.int/forecasts',preparedAt:'2026-10-07T10:00:00Z',zonalWind60N:level===10?{value:-4.5678,samples:model==='gefs'?720:1440,longitudeStep:model==='gefs'?.5:.25,basis:'native'}:null,...override};
 const json=Buffer.from(JSON.stringify(header)),bytes=Buffer.alloc(12+json.length+360*91*7*4);
 bytes.write('STRAT001');bytes.writeUInt32LE(json.length,8);json.copy(bytes,12);
 const values=[-60,31000,3,4,20,2,6];let offset=12+json.length;
 for(let p=0;p<7;p++)for(let y=0;y<91;y++)for(let x=0;x<360;x++){
  // A 0.01-per-longitude ramp exercises row accumulation and row reset.
  bytes.writeInt32LE(x===0?values[p]*100+y:1,offset);offset+=4;
 }
 return {bytes,packed:gzipSync(bytes),header};
}
export function preparedResponse(url){
 const match=String(url).match(/forecast-data-(gefs|ifs-ens|aifs-ens)\/\d{10}\/(\d+)\/(\d+)\.bin\.gz/);
 if(!match)throw Error('Unexpected request: '+url);
 return new Response(preparedFixture(match[1].replaceAll('-','_'),Number(match[3]),Number(match[2])).packed);
}
