import {GET} from '../app/api/forecast/route';
// All upstream requests and GRIB decoding happen off the UI thread. No server,
// credentials or paid proxy are needed for individual forecasts.
self.onmessage=async(event:MessageEvent<string>)=>{
 try{const r=await GET(new Request('https://stratoscope.invalid/api/forecast?'+event.data));const data=await r.json();self.postMessage({ok:r.ok,data});}
 catch(e){self.postMessage({ok:false,data:{error:e instanceof Error?e.message:'Forecast unavailable'}});}
};
