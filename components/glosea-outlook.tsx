'use client';
import {useEffect,useState} from 'react';
import {fetchGloSea,type GloSea} from '@/lib/glosea';
import {SEASONAL_MODELS,fetchSeasonal,fetchClimate,fetchEra,type SeasonalId,type SeasonalForecast,type SeasonalClimate,type EraClimate} from '@/lib/seasonal';
import {SeasonalChart} from '@/components/seasonal-chart';
export function GloSeaOutlook(){
 const [data,setData]=useState<GloSea|null>(null),[open,setOpen]=useState(false),[model,setModel]=useState<SeasonalId>('egrr');
 const [forecast,setForecast]=useState<SeasonalForecast|null>(null),[climate,setClimate]=useState<SeasonalClimate|null>(null),[era,setEra]=useState<EraClimate|null>(null),[loading,setLoading]=useState(false),[error,setError]=useState(''),[referenceError,setReferenceError]=useState(false),[refresh,setRefresh]=useState(0);
 useEffect(()=>{const c=new AbortController();void fetchGloSea(AbortSignal.any([c.signal,AbortSignal.timeout(15000)])).then(d=>{if(!c.signal.aborted)setData(d)}).catch(()=>{});return()=>c.abort()},[]);
 useEffect(()=>{
  if(!open)return;
  const c=new AbortController(),signal=AbortSignal.any([c.signal,AbortSignal.timeout(25000)]);
  setForecast(null);setClimate(null);setEra(null);setError('');setReferenceError(false);setLoading(true);
  void fetchEra(signal).then(d=>{if(!c.signal.aborted)setEra(d)}).catch(()=>{if(!c.signal.aborted)setReferenceError(true)});
  void (async()=>{
   let f:SeasonalForecast|null=null;
   try{f=await fetchSeasonal(model,signal);if(!c.signal.aborted)setForecast(f)}catch{if(!c.signal.aborted)setError('The selected forecast could not be loaded. Please retry.')}
   finally{if(!c.signal.aborted)setLoading(false)}
   const nominal=f?.nominal??(model==='egrr'?data?.nominal:undefined);
   if(nominal)try{const h=await fetchClimate(model,nominal,signal);if(!c.signal.aborted)setClimate(h)}catch{if(!c.signal.aborted)setReferenceError(true)}
  })();
  return()=>c.abort();
 },[open,model,refresh,data?.nominal]);
 const selected=SEASONAL_MODELS.find(m=>m.id===model)!;
 const source='https://climate.copernicus.eu/charts/packages/c3s_seasonal/products/c3s_seasonal_stratots_'+model+'?area=60N&type=plumemembers';
 const plot=(forecast?.model===model?forecast:null)??(model==='egrr'&&data?{...data,name:selected.name}:null);
 const matchingClimate=climate?.model===model&&climate.month===Number(plot?.nominal.slice(5,7))?climate:null;
 return <div className="glosea-section"><button className="glosea-toggle" onClick={()=>setOpen(v=>!v)} aria-expanded={open} aria-controls="seasonal-wind-charts">{open?'Hide':'Show'} seasonal wind outlooks <span>7 models · 60°N · 10 hPa</span></button>{open&&<section id="seasonal-wind-charts" className="glosea-outlook" aria-label="Seasonal wind model comparison">
  <div className="glosea-heading"><div><span className="eyebrow">STRATOSCOPE · SEASONAL OUTLOOKS</span><h2>Polar vortex wind <span>/ 60°N · 10 hPa</span></h2></div><label className="seasonal-model-label">Seasonal model<select value={model} onChange={e=>setModel(e.target.value as SeasonalId)} aria-label="Seasonal wind model">{SEASONAL_MODELS.map(m=><option value={m.id} key={m.id}>{m.name}</option>)}</select></label></div>
  {plot?<SeasonalChart key={model+plot.nominal+plot.sampling} data={plot} climate={matchingClimate} era={era} referenceError={referenceError}/>:<>
   <p className="seasonal-pending" role="status">{loading?'Checking prepared '+selected.name+' data…':error||selected.name+' native data are still being prepared.'} The official Copernicus chart remains available below until the complete native ensemble is ready.</p>
   {!loading&&<iframe key={model} className="seasonal-embed" title={selected.name+' official seasonal wind chart while native data are pending'} src={'https://climate.copernicus.eu/charts/embed/c3s_seasonal/c3s_seasonal_stratots_'+model+'?area=60N&controls_overlay=1&player_dimension=base_time&type=plumemembers'} allowFullScreen referrerPolicy="strict-origin-when-cross-origin"/>}
  </>}
  {error&&plot&&<p role="status">{error} Showing the previously prepared GloSea issue.</p>}
  <div className="seasonal-source"><button className="seasonal-refresh" onClick={()=>setRefresh(n=>n+1)} disabled={loading}>Refresh seasonal data</button><a href={source} target="_blank" rel="noreferrer">Compare with the official {selected.name} chart ↗</a></div>
  <p>Seasonal outlooks are independent of the globe’s model and timeline. Forecasts update monthly; verified historical references are reused for the matching model version and start month.</p>
 </section>}</div>;
}
