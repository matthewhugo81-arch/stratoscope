"""One-off source integration; removed after verification."""
from pathlib import Path
import subprocess

def change(path,sha,edits):
 p=Path(path);assert subprocess.check_output(['git','hash-object',str(p)],text=True).strip()==sha,path
 s=p.read_text()
 for old,new in edits:
  assert s.count(old)==1, path+' '+old[:100]
  s=s.replace(old,new)
 p.write_text(s)
imports="import {SaveImageButton} from './save-image-button';\nimport {imageFilename,utcStamp,type ChartImage} from '@/lib/chart-export';\n"
change('components/northern-diagnostics.tsx','0ddcc18ef8925db287617b4e5f0a619345daa29a',[
 ("import {useEffect,useState} from 'react';","import {useEffect,useRef,useState} from 'react';\n"+imports),
 (' const [open,setOpen]', ' const exportRoot=useRef<HTMLElement>(null);\n const [open,setOpen]'),
 (" function chart(key:'wind'|'temperature'", ''' function imageSpec(only?:'wind'|'temperature'):ChartImage{
  const keys=only?[only]:['wind','temperature'] as const;
  return {title:'Northern forecast diagnostics'+(only?' · '+only:''),filename:imageFilename('northern',only??'comparison',...series.map(d=>d.model+'-'+d.run),'valid',new Date(t).toISOString()),
   subtitle:['Selected comparison time '+utcStamp(new Date(t).toISOString())],
   legend:series.map(d=>({label:`${names[d.model]} · Init ${utcStamp(d.run)} · ${d.count} members${members.includes(d.model)?' · member curves shown':' · mean only'}`,colour:colours[d.model]})),
   plots:keys.map(key=>({element:exportRoot.current?.querySelector<SVGSVGElement>(`[data-export-plot="${key}"] svg`),title:key==='wind'?'10 hPa · 60°N zonal-mean zonal wind · m/s':'10 hPa · 60–90°N area-mean temperature · °C',caption:series.map(d=>{const p=d.points[Math.round((t-Date.parse(d.run))/21600000)];return names[d.model]+': '+(p?diagnosticMean(p[key]).toFixed(1)+(key==='wind'?' m/s':' °C'):'outside this model timeline')}).join(' · ')})),
   notes:['Solid lines: ensemble means. Each model retains its own initialization. Wind below zero indicates easterlies, not a confirmed SSW.','Source: NOAA GEFS and ECMWF IFS ENS/AIFS ENS. Stratoscope native-longitude wind means; polar temperature area-weighted on the 2° overview grid.']};
 }
 function chart(key:'wind'|'temperature\''''),
 ('<div className="nh-diagnostic-chart"><h3>{title} <span>{unit}</span></h3>', '<div className="nh-diagnostic-chart" data-export-plot={key}><div className="chart-export-heading"><h3>{title} <span>{unit}</span></h3><SaveImageButton label={title} getImage={()=>imageSpec(key)} disabled={loading||!series.length}/></div>'),
 ('<section id="northern-diagnostics"','<section ref={exportRoot} id="northern-diagnostics"'),
 ('</h2></div><button className="seasonal-refresh"','</h2></div><SaveImageButton label="northern diagnostic comparison" getImage={()=>imageSpec()} disabled={loading||!series.length}/><button className="seasonal-refresh"')
])
change('components/vortex-view.tsx','0ae9e79ac089eb539225c1b57e156a22a78f2fb1',[
 ("import {HeatFluxChart} from './heat-flux-chart';","import {HeatFluxChart} from './heat-flux-chart';\n"+imports),
 (' return <><div className="vortex-view-controls">', ''' const imageSpec=():ChartImage=>({
  title:'GEFS 3D PV structure',filename:imageFilename('GEFS-3D-PV',data.run,'f'+data.hour),
  subtitle:['Run '+utcStamp(data.run),`Forecast +${data.hour}h · Valid ${utcStamp(new Date(Date.parse(data.run)+data.hour*3600000).toISOString())}`,`31-member mean-field PV · current rotation and tilt · zoom ${view.current.zoom.toFixed(2)}×`],
  plots:[{element:canvas.current,backdrop:'vortex'}],
  legend:[400,600,800,1000,1200].map(n=>({label:n+' K potential temperature',colour:`hsl(${185-(n-400)/800*150} 80% ${58+(n-400)/800*8}%)`})),
  gradients:showBase&&data.baseMap?[{title:`500 hPa height anomaly · m · opacity ${Math.round(opacity*100)}%`,stops:Array.from({length:61},(_,i)=>({at:i/60,colour:'rgba('+heightAnomalyColour(-300+i*10).slice(0,3).join(',')+',1)'})),ticks:[-300,-150,0,150,300].map(v=>({at:(v+300)/600,label:(v>0?'+':'')+v}))}]:[],
  notes:['Source: NOAA GEFS · 31-member mean. Fixed-area PV structure diagnostic, not a formally diagnosed vortex edge. Vertical spacing represents potential temperature, not physical altitude.',...(showBase&&data.baseMap?['Base: GEFS mean 500 hPa height minus NCEP/NCAR Reanalysis 1 daily mean, 1991–2020. Same run and valid time as the PV structure.']:['500 hPa anomaly overlay not shown.'])]
 });
 return <><div className="vortex-view-controls">'''),
 ('Zoom −</button><span>Drag','Zoom −</button><SaveImageButton label="3D PV view" getImage={imageSpec} beforeSave={()=>paint.current()}/><span>Drag')
])
change('components/zonal-wind-card.tsx','741bc3cbc437daff87a0b02eaba47697101ff539',[
 ("import {RefreshCw} from 'lucide-react';","import {RefreshCw} from 'lucide-react';\n"+imports),
 ("import {isEnsemble,memberCount,supports,type ModelId}","import {MODELS,isEnsemble,memberCount,supports,type ModelId}"),
 (' return <section className="zonal-card"', ''' const imageSpec=():ChartImage=>({title:MODELS[model].label+' · 60°N, 10 hPa zonal wind',filename:imageFilename(model,'zonal-wind',run,'f'+hour,member<0?'mean':'member-'+member),subtitle:['Run '+utcStamp(run),`Forecast +${hour}h · Valid ${utcStamp(valid)}`,description],plots:[],readout:{value:(presentation?.text??'—')+' m/s',label:presentation?.direction??'Unavailable'},notes:[`${diagnostic?.longitudeStep}° ${diagnostic?.basis==='native'?'source':'display'} grid · all longitudes`,'Positive is westerly; negative is easterly. An instantaneous signed u-wind diagnostic, not a daily mean or a confirmed SSW.','Source: '+MODELS[model].label+' · Stratoscope']});
 return <section className="zonal-card"'''),
 ('<div className="eyebrow">POLAR VORTEX WIND</div>', '<div className="chart-export-heading"><div className="eyebrow">POLAR VORTEX WIND</div><SaveImageButton label="zonal wind readout" getImage={imageSpec} disabled={!diagnostic||!presentation||mapBusy}/></div>')
])
# Add explicit SVG types to scoped selectors in the first integration step.
for file,selector in [('seasonal-chart.tsx','.seasonal-plot svg'),('heat-flux-chart.tsx','.heat-flux-plot svg')]:
 p=Path('components')/file;s=p.read_text();s=s.replace("querySelector('"+selector+"')","querySelector<SVGSVGElement>('"+selector+"')");p.write_text(s)
