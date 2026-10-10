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
imports="import {SaveImageButton} from './save-image-button';\nimport {imageFilename,utcStamp,type ChartImage} from '@/lib/chart-export';\nimport {mapGradient,mapTitle,mapSubtitle} from '@/lib/chart-export-map';\n"
change('components/polar-map.tsx','3ea5ff616ca189549a4e6b0c36ac6e59aedb1394',[
 ("import {Plus,Minus,Compass,RotateCcw} from 'lucide-react';","import {Plus,Minus,Compass,RotateCcw} from 'lucide-react';\n"+imports),
 (' return <div className="globe-wrap">', ''' const imageSpec=():ChartImage=>{
  if(!frame)throw Error('Wait for the model map to load.');
  return {title:mapTitle(frame,field),filename:imageFilename(frame.model,'map',field,frame.level+'hPa',frame.ensemble?.view,frame.ensemble?.member,frame.run,'f'+frame.hour),subtitle:mapSubtitle(frame),plots:[{layers:[base.current,overlay.current]}],gradients:[mapGradient(field,frame.ensemble?.view==='spread')],notes:[`Current rotation and zoom. ${contours?'Height contours every 400 m, labels in dam.':'Height contours hidden.'} ${graticule?'Latitude/longitude grid shown.':''}`,frame.ensemble?.view==='spread'?'Spread is member disagreement, not forecast error or a confidence interval.':'Northern Hemisphere forecast field; shaded lighting is decorative.', 'Source: '+(frame.source??'official model fields')+' · Stratoscope']};
 };
 return <div className="globe-wrap">'''),
 ('Fit globe</span></button></div></div><div ref={stage}', 'Fit globe</span></button></div><SaveImageButton label="model map" getImage={imageSpec} disabled={!frame} beforeSave={()=>paint.current()}/></div><div ref={stage}')
])
change('components/forecast-stamps.tsx','4dff252c6927cb75fa5dac58231238f0fd2b80c0',[
 ("import {memo,useEffect,useRef} from 'react';","import {memo,useEffect,useRef} from 'react';\n"+imports),
 (' return <section ref={section}', ''' const imageSpec=():ChartImage=>{
  const ready=times.filter(t=>t.frame),first=ready[0]?.frame;
  if(!first)throw Error('No downloaded frames are available.');
  return {title:mapTitle(first,field)+' · frame previews',filename:imageFilename(first.model,'previews',field,first.level+'hPa',run),subtitle:['Run '+utcStamp(run),`${ready.length}/${times.length} downloaded frames · only downloaded previews are included`],columns:8,plots:ready.map(t=>({element:track.current?.querySelector<HTMLCanvasElement>(`[data-export-hour="${t.hour}"] canvas`),title:t.hour===0?'Initial':`+${t.hour}h`,caption:utcStamp(t.frame!.valid)})),gradients:[mapGradient(field,first.ensemble?.view==='spread')],notes:['North-pole thumbnail overview; use Save on the main map for a detailed image.','Source: '+(first.source??'official model fields')+' · Stratoscope']};
 };
 return <section ref={section}'''),
 ('Downloaded frames · click a time to view</span></div>', 'Downloaded frames · click a time to view</span><SaveImageButton label="forecast frame previews" getImage={imageSpec} disabled={!times.some(t=>t.frame)}/></div>'),
 ('<button key={time.hour} className=', '<button key={time.hour} data-export-hour={time.hour} className=')
])
change('components/member-panels.tsx','4ea58afbd4fadc4d732e7767d4145ead9b996011',[
 ("import {memo,useEffect,useRef,useState} from 'react';","import {memo,useEffect,useRef,useState} from 'react';\n"+imports),
 (' return <dialog ref={dialog}', ''' const imageSpec=():ChartImage=>({title:MODELS[model].label+' · all members · 10 hPa · '+(variable==='wind'?'wind speed':'temperature'),filename:imageFilename(model,'all-members',variable,run,'f'+lead),subtitle:['Run '+utcStamp(run),`Forecast +${lead}h · Valid ${utcStamp(new Date(Date.parse(run)+lead*3600000).toISOString())}`,`${data?.length??0} members · E: easterly 60°N, 10 hPa signed u wind`],columns:model==='gefs'?7:9,plots:(data??[]).map((f,i)=>({element:grid.current?.querySelectorAll<HTMLCanvasElement>('.member-map-tile canvas')[i],title:f.ensemble!.member===0?'Control':`Member ${f.ensemble!.member}`,caption:grid.current?.querySelectorAll('.member-map-tile>span')[i]?.textContent??''})),gradients:[mapGradient(variable)],notes:['North-pole views on the stored 2° overview grid; identical scales. E denotes easterlies at this time, not a confirmed SSW event.','Source: '+MODELS[model].label+' · Stratoscope']});
 return <dialog ref={dialog}'''),
 ('</span></div><button onClick={onClose}', '</span></div><SaveImageButton label="all ensemble member maps" getImage={imageSpec} disabled={!data}/><button onClick={onClose}')
])
