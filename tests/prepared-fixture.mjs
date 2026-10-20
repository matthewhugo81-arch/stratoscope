import {gzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
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
const catalogues=new Map(),packedFiles=new Map();
export function preparedCatalogue(model){
 if(catalogues.has(model))return catalogues.get(model);
 const levels=model==='gefs'?[10,20,30,50,70,100]:[10,50,100],maxHour=model==='gefs'?384:360,files={};
 for(const level of levels)for(let hour=0;hour<=maxHour;hour+=6){
  const packed=preparedFixture(model,hour,level).packed;packedFiles.set(`${model}/${level}/${hour}`,packed);
  files[`${level}/${hour}`]={path:`2026100700/${level}/${hour}.bin.gz`,bytes:packed.length,sha256:createHash('sha256').update(packed).digest('hex')};
 }
 const catalogue={version:1,model,run,maxHour,step:6,count:model==='gefs'?31:51,levels,complete:true,preparedAt:'2026-10-07T10:00:00Z',files};catalogues.set(model,catalogue);return catalogue;
}
export function preparedResponse(url){
 const latest=String(url).match(/forecast-data-(gefs|ifs-ens|aifs-ens)\/latest\.json/);
 if(latest)return Response.json(preparedCatalogue(latest[1].replaceAll('-','_')));
 const match=String(url).match(/forecast-data-(gefs|ifs-ens|aifs-ens)\/\d{10}\/(\d+)\/(\d+)\.bin\.gz/);
 if(!match)throw Error('Unexpected request: '+url);
 const model=match[1].replaceAll('-','_');return new Response(packedFiles.get(`${model}/${match[2]}/${match[3]}`)??preparedFixture(model,Number(match[3]),Number(match[2])).packed);
}
