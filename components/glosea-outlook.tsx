'use client';
import {useEffect,useLayoutEffect,useRef,useState} from 'react';
import {fetchGloSea,type GloSea} from '@/lib/glosea';
import {SEASONAL_MODELS,fetchSeasonal,fetchClimate,fetchEra,type SeasonalId,type SeasonalForecast,type SeasonalClimate,type EraClimate} from '@/lib/seasonal';
import {Ec46Chart} from '@/components/ec46-chart';
import {SeasonalChart} from '@/components/seasonal-chart';
export function GloSeaOutlook(){
 const chartContent=useRef<HTMLDivElement>(null),[chartHeight,setChartHeight]=useState(0);
 // Keep the chart slot tall while a different model loads; otherwise the browser
 // clamps the document scroll position when the previous chart disappears.

 const [data,setData]=useState<GloSea|null>(null),[open,setOpen]=useState(false),[model,setModel]=useState<SeasonalId|'ec46'>('egrr');
 useLayoutEffect(()=>{if(!chartContent.current)return;const content=chartContent.current;const measure=()=>setChartHeight(h=>Math.max(h,Math.ceil(content.getBoundingClientRect().height)));measure();const observer=new ResizeObserver(measure);observer.observe(content);return()=>observer.disconnect()},[open]);
 const [forecast,setForecast]=useState<SeasonalForecast|null>(null),[climate,setClimate]=useState<SeasonalClimate|null>(null),[era,setEra]=useState<EraClimate|null>(null),[loading,setLoading]=useState(false),[error,setError]=useState(''),[referenceError,setReferenceError]=useState(false),[refresh,setRefresh]=useState(0);
 useEffect(()=>{const c=new AbortController();void fetchGloSea(AbortSignal.any([c.signal,AbortSignal.timeout(15000)])).then(d=>{if(!c.signal.aborted)setData(d)}).catch(()=>{});return()=>c.abort()},[]);
 // ERA5 is shared by every model and can arrive before the model hindcasts.
 useEffect(()=>{
  if(!open)return;const c=new AbortController();let timer:ReturnType<typeof setTimeout>|undefined;
  const check=async()=>{
   try{const d=await fetchEra(AbortSignal.any([c.signal,AbortSignal.timeout(25000)]));if(c.signal.aborted)return;if(d){setEra(d);return}}
   catch{if(c.signal.aborted)return}
   timer=setTimeout(check,60000);
  };
  void check();return()=>{c.abort();clearTimeout(timer)};
 },[open,refresh]);
 useEffect(()=>{
  if(!open||model==='ec46')return;
  const c=new AbortController(),signal=AbortSignal.any([c.signal,AbortSignal.timeout(25000)]);
  setForecast(null);setClimate(null);setError('');setReferenceError(false);setLoading(true);
  void (async()=>{
   let f:SeasonalForecast|null=null;
   try{f=await fetchSeasonal(model,signal);if(!c.signal.aborted)setForecast(f)}catch{if(!c.signal.aborted)setError('The selected forecast could not be loaded. Please retry.')}
   finally{if(!c.signal.aborted)setLoading(false)}
   const nominal=f?.nominal??(model==='egrr'?data?.nominal:undefined);
   if(nominal)try{const h=await fetchClimate(model,nominal,signal);if(!c.signal.aborted)setClimate(h)}catch{if(!c.signal.aborted)setReferenceError(true)}
  })();
  return()=>c.abort();
 },[open,model,refresh,data?.nominal]);
 const selected=model==='ec46'?{name:'ECMWF EC46'}:SEASONAL_MODELS.find(m=>m.id===model)!;
 const source=model==='ec46'?'https://charts.ecmwf.int/products/extended-zonal-mean-zonal-wind?area=nh':'https://climate.copernicus.eu/charts/packages/c3s_seasonal/products/c3s_seasonal_stratots_'+model+'?area=60N&type=plumemembers';
 const plot=(forecast?.model===model?forecast:null)??(model==='egrr'&&data?{...data,name:selected.name}:null);
 const matchingClimate=climate?.model===model&&climate.month===Number(plot?.nominal.slice(5,7))?climate:null;
 return <div className="glosea-section"><button className="glosea-toggle" onClick={()=>setOpen(v=>!v)} aria-expanded={open} aria-controls="seasonal-wind-charts">{open?'Hide':'Show'} wind outlooks <span>EC46 + 7 seasonal models · 60°N · 10 hPa</span></button>{open&&<section id="seasonal-wind-charts" className="glosea-outlook" aria-label="Seasonal wind model comparison">
  <div className="glosea-heading"><div><span className="eyebrow">STRATOSCOPE · WIND OUTLOOKS</span><h2>Polar vortex wind <span>/ 60°N · 10 hPa</span></h2></div><label className="seasonal-model-label">Forecast source<select value={model} onChange={e=>setModel(e.target.value as SeasonalId|'ec46')} aria-label="Seasonal wind model"><option value="ec46">ECMWF EC46 · daily</option>{SEASONAL_MODELS.map(m=><option value={m.id} key={m.id}>{m.name}</option>)}</select></label></div>
  <div className="seasonal-chart-slot" style={{minHeight:chartHeight||undefined}}><div ref={chartContent} className="seasonal-chart-content">
  {model==='ec46'?<Ec46Chart refresh={refresh}/>:plot?<SeasonalChart key={model+plot.nominal+plot.sampling} data={plot} climate={matchingClimate} era={era} referenceError={referenceError}/>:<>
   <p className="seasonal-pending" role="status">{loading?'Checking prepared '+selected.name+' data…':error||selected.name+' native data are still being prepared.'} The official Copernicus chart remains available below until the complete native ensemble is ready.</p>
   {!loading&&<iframe key={model} className="seasonal-embed" title={selected.name+' official seasonal wind chart while native data are pending'} src={'https://climate.copernicus.eu/charts/embed/c3s_seasonal/c3s_seasonal_stratots_'+model+'?area=60N&controls_overlay=1&player_dimension=base_time&type=plumemembers'} allowFullScreen referrerPolicy="strict-origin-when-cross-origin"/>}
  </>}
  </div></div>
  {error&&plot&&<p role="status">{error} Showing the previously prepared GloSea issue.</p>}
  <div className="seasonal-source"><button className="seasonal-refresh" onClick={()=>setRefresh(n=>n+1)} disabled={model!=='ec46'&&loading}>Refresh outlook</button><a href={source} target="_blank" rel="noreferrer">Compare with the official {selected.name} chart ↗</a></div>
  <p>Wind outlooks are independent of the globe’s model and timeline. EC46 runs daily; seasonal forecasts update monthly; verified historical references are reused for the matching model version and start month.</p>
 </section>}</div>;
}
