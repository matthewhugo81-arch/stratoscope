"use client";
import {useEffect,useRef,useState} from 'react';
import {SaveImageButton} from './save-image-button';
import {imageFilename,utcStamp,type ChartImage} from '@/lib/chart-export';

const endpoint='https://charts.ecmwf.int/opencharts-api/v1/products/extended-zonal-mean-zonal-wind/?area=nh';
export function Ec46Chart({refresh}:{refresh:number}){
 const exportRoot=useRef<HTMLDivElement>(null);
 const [image,setImage]=useState(''),[error,setError]=useState('');
 useEffect(()=>{const c=new AbortController();setError('');
  void fetch(endpoint,{signal:AbortSignal.any([c.signal,AbortSignal.timeout(30000)]),cache:'no-cache'}).then(async r=>{if(!r.ok)throw Error('Chart temporarily unavailable');const j=await r.json() as {data?:{attributes?:{name?:string};link?:{href?:string;type?:string}}};const link=j.data?.link;const u=new URL(link?.href??'');if(j.data?.attributes?.name!=='extended-zonal-mean-zonal-wind'||link?.type!=='image/png'||u.origin!=='https://charts.ecmwf.int'||!u.pathname.startsWith('/content/'))throw Error('Unexpected chart response');if(!c.signal.aborted)setImage(u.href)}).catch(()=>{if(!c.signal.aborted)setError('ECMWF’s chart could not be refreshed. Use the official chart link below or try Refresh again.')});return()=>c.abort();
 },[refresh]);
 const imageSpec=():ChartImage=>({title:'ECMWF EC46 · 60°N, 10 hPa zonal wind',filename:imageFilename('EC46',image.split('/').pop()),subtitle:['Official ECMWF graphic · issue and valid dates are printed on the original chart'],plots:[{element:exportRoot.current?.querySelector('img')}],notes:['Source: ECMWF · CC BY 4.0 · The original published graphic, not a locally recalculated ensemble.']});
 return <div ref={exportRoot} className="ec46-chart"><div className="seasonal-issue"><strong>ECMWF EC46 · sub-seasonal outlook</strong><span>Daily runs · 101 members · up to 46 days</span><SaveImageButton label="EC46 wind outlook" getImage={imageSpec} disabled={!image} originalUrl={image}/></div>
 <p>Latest available official chart · 60°N, 10 hPa. The issue date is printed on the chart. Blue: members and ensemble mean. Red: model-climate mean and 10th/90th percentiles.</p>
 {error&&<p role="status">{error}{image?' The previously loaded chart remains displayed.':''}</p>}
 {image?<img src={image} alt="ECMWF EC46 60°N 10 hPa zonal-mean wind ensemble with model climatology and forecast issue date" onError={()=>setError('The chart image could not be loaded. Open the official chart below or refresh.')}/>:!error&&<div className="seasonal-empty" role="status">Loading the latest ECMWF EC46 chart…</div>}
 <p>Official ECMWF graphic · <a href="https://www.ecmwf.int/en/forecasts/datasets/open-data" target="_blank" rel="noreferrer">ECMWF, CC BY 4.0</a>. This is the published graphic, not a locally recalculated ensemble. No paid data service is used.</p></div>;
}

