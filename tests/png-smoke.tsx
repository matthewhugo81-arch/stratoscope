import React from 'react';
import {createRoot} from 'react-dom/client';
import {PolarMap} from '../components/polar-map';
import {ZonalWindCard} from '../components/zonal-wind-card';
import {HeatFluxChart} from '../components/heat-flux-chart';
import {SeasonalChart} from '../components/seasonal-chart';
import {VortexView} from '../components/vortex-view';
import {SaveImageButton} from '../components/save-image-button';
import '../app/globals.css';
import type {Frame} from '../lib/grib';
import type {VortexCatalogue} from '../lib/vortex';
export const run='2026-10-10T00:00:00.000Z';
const nx=360,ny=91,n=nx*ny;
const temperature=Array.from({length:n},(_,i)=>188+13*Math.cos(i/nx*.14)+8*Math.sin(i%nx*.08));
const height=Array.from({length:n},(_,i)=>28900+850*Math.sin(i%nx*.04)+220*Math.cos(i/nx*.17));
const u=Array.from({length:n},(_,i)=>-6+2*Math.sin(i%nx*.02));
const v=Array.from({length:n},(_,i)=>3+Math.cos(i%nx*.02));
const frame:Frame={model:'gfs',run,hour:0,valid:run,level:10,grid:{nx,ny,lat0:90,lon0:0,dx:1,dy:-1},temperature,height,u,v,zonalWind60N:{value:-7,samples:360,longitudeStep:1,basis:'native'}};
const dates=Array.from({length:360},(_,i)=>new Date(Date.parse(run)+(i+1)*43200000).toISOString());
const members=Array.from({length:4},(_,m)=>({id:'demo-'+m,values:dates.map((_,i)=>10*Math.sin(i/17)-m*2)}));
const mean=dates.map((_,i)=>10*Math.sin(i/17)-3);
const data={name:'GloSea demonstration',nominal:run,dates,members,mean,easterlyFraction:mean.map(v=>v<0?1:0),sampling:'12-hourly instantaneous',attribution:'Demonstration only'};
const catalogue:VortexCatalogue={version:1,model:'vortex',run,count:31,complete:true,timelineComplete:false,contextComplete:false,contextHours:[],targetHour:384,step:12,method:'mean-field-pv-equivalent-area-70N',files:{'0':{path:'pending',sha256:'0'.repeat(64),bytes:1}}};
const fluxCatalogue:VortexCatalogue={...catalogue,heatFlux:{path:'pending',sha256:'0'.repeat(64),bytes:1}};
function Main(){return <main style={{maxWidth:1250,margin:'auto',padding:20}}>
 <h1>Local PNG smoke-test · no live forecast data</h1>
 <section id="smoke-globe" style={{maxWidth:720}}><PolarMap frame={frame} field="temperature" contours={true} graticule={true} windArrows={false}/></section>
 <section id="smoke-zonal"><ZonalWindCard model="gfs" run={run} hour={0} member={-1} mapLevel={10} mapFrame={frame} mapBusy={false} mapError="" mapProgress={0} refresh={0}/></section>
 <section id="smoke-seasonal"><SeasonalChart data={data} climate={null} era={null}/></section>
 <section id="smoke-heat"><HeatFluxChart catalogue={fluxCatalogue} hour={0} displayedRun={run} onSelect={()=>{}}/></section>
 <section id="smoke-canvas"><SaveImageButton title="2D canvas test" filename="stratoscope-2d-test" target={()=>document.querySelector<HTMLCanvasElement>('#smoke-globe canvas.globe-overlay')}/></section>
 <section id="smoke-vortex"><VortexView/></section>
 </main>}
createRoot(document.getElementById('root')!).render(<Main/>);
