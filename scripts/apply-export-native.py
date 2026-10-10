"""One-off guarded source integration; removed after the tested build."""
from pathlib import Path
import subprocess

def change(path,sha,edits):
 p=Path(path)
 assert subprocess.check_output(['git','hash-object',str(p)],text=True).strip()==sha, 'Source changed: '+path
 source=p.read_text()
 for old,new in edits:
  assert source.count(old)==1, 'Patch not unique: '+path+' '+old[:80]
  source=source.replace(old,new)
 p.write_text(source)

imports="import {SaveImageButton} from './save-image-button';\nimport {imageFilename,utcStamp,type ChartImage} from '@/lib/chart-export';\n"
change('components/seasonal-chart.tsx','cad661fea73675afcd59a5c7d6b52227378b3f41',[
 ("import {useEffect,useState} from 'react';", "import {useEffect,useRef,useState} from 'react';\n"+imports),
 (' const [now,setNow]', ' const exportRoot=useRef<HTMLDivElement>(null);\n const [now,setNow]'),
 (' return <div className="native-seasonal-chart">', ''' const imageSpec=():ChartImage=>({
  title:data.name+' · zonal wind at 60°N, 10 hPa',filename:imageFilename(data.name,'seasonal-wind',data.nominal,'valid',data.dates[active]),
  subtitle:['Issue '+utcStamp(data.nominal),`${data.members.length} members · ${data.sampling} · signed u wind, m/s`],
  plots:[{element:exportRoot.current?.querySelector('.seasonal-plot svg'),caption:`${utcStamp(data.dates[active])} · Forecast mean ${signed(data.mean[active])} m/s · ${Math.round(data.easterlyFraction[active]*data.members.length)}/${data.members.length} members easterly`}],
  legend:[{label:'Forecast mean',colour:'#b5efdd'},...(members?[{label:'Ensemble members',colour:'#599aae'}]:[]),...(climate&&history?[{label:'Model climate mean and historical ranges · 1993–2016',colour:'#efb56e'}]:[]),...(era&&reference?[{label:'ERA5 daily climate mean · 1993–2016',colour:'#edf2f4',dashed:true}]:[])],
  notes:['Positive wind is westerly; negative is easterly. Raw ensemble scenarios, not a calibrated SSW probability.',...(!era?['ERA5 reference is not available in this saved view.']:[]),data.attribution]
 });
 return <div ref={exportRoot} className="native-seasonal-chart">'''),
 ('{data.sampling}</span></div>', '{data.sampling}</span><SaveImageButton label="seasonal wind outlook" getImage={imageSpec}/></div>')
])
change('components/heat-flux-chart.tsx','c5b05bb7fd7dc56e75deaa18ccf4988ed76434b7',[
 ("import {useEffect,useState} from 'react';", "import {useEffect,useRef,useState} from 'react';\n"+imports),
 (' const [data,setData]', ' const exportRoot=useRef<HTMLDivElement>(null);\n const [data,setData]'),
 (' return <div className="heat-flux-chart"', ''' const imageSpec=():ChartImage=>({
  title:'GEFS eddy heat flux · 100 hPa · 45–75°N',filename:imageFilename('GEFS-heat-flux',displayedRun,'f'+hour),
  subtitle:['Run '+utcStamp(displayedRun),'Selected valid time '+utcStamp(new Date(Date.parse(displayedRun)+hour*3600000).toISOString()),'31 members · 12-hourly forecast samples · K m/s'],
  plots:[{element:exportRoot.current?.querySelector('.heat-flux-plot svg'),caption:selected?`Mean ${signed(selected.mean)} K m/s · 10–90% range ${signed(selected.low)} to ${signed(selected.high)}`:''}],
  legend:[{label:'Ensemble mean',colour:'#a6e3d4'},{label:'Shading: 10–90% member range',colour:'#9edfcf'},...(members?[{label:'All 31 members',colour:'#78bec7'}]:[]),{label:'Selected vortex time',colour:'#f1c17b',dashed:true}],
  notes:['Poleward eddy heat transport: a proxy for upward wave activity, not an SSW probability or an anomaly.','Source: NOAA GEFS · Stratoscope member-by-member zonal eddy covariance, area weighted over 45–75°N.']
 });
 return <div ref={exportRoot} className="heat-flux-chart"'''),
 ('/>All 31 members</label></div>', '/>All 31 members</label><SaveImageButton label="heat flux" getImage={imageSpec} disabled={!series}/></div>')
])
change('components/ec46-chart.tsx','f4e50937caa89d583a85dedc22353be8c716e573',[
 ("import {useEffect,useState} from 'react';", "import {useEffect,useRef,useState} from 'react';\n"+imports),
 (" const [image,setImage]", " const exportRoot=useRef<HTMLDivElement>(null);\n const [image,setImage]"),
 (' return <div className="ec46-chart">', ''' const imageSpec=():ChartImage=>({title:'ECMWF EC46 · 60°N, 10 hPa zonal wind',filename:imageFilename('EC46',image.split('/').pop()),subtitle:['Official ECMWF graphic · issue and valid dates are printed on the original chart'],plots:[{element:exportRoot.current?.querySelector('img')}],notes:['Source: ECMWF · CC BY 4.0 · The original published graphic, not a locally recalculated ensemble.']});
 return <div ref={exportRoot} className="ec46-chart">'''),
 ('Daily runs · 101 members · up to 46 days</span></div>', 'Daily runs · 101 members · up to 46 days</span><SaveImageButton label="EC46 wind outlook" getImage={imageSpec} disabled={!image} originalUrl={image}/></div>')
])
