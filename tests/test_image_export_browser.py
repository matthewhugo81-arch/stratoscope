"""End-to-end PNG download tests against locally rendered real components.

No changes to model data: GEFS vortex fixture is SHA-256 verified from the
existing public publication; remaining charts use labelled synthetic fixtures.
"""
import base64
from datetime import datetime, timezone, timedelta
from hashlib import sha256
from io import BytesIO
import json
import os
from pathlib import Path
import re
import subprocess
import time
from urllib.parse import urlsplit
from urllib.request import urlopen

from PIL import Image
from playwright.sync_api import sync_playwright

REPO='matthewhugo81-arch/stratoscope'
ROOT='https://raw.githubusercontent.com/'+REPO+'/forecast-data-vortex/'
URL='http://127.0.0.1:5174/stratoscope/export-smoke.html'
BASE='2026-10-10T00:00:00.000Z'


def get(url):
    for attempt in range(3):
        try:
            with urlopen(url, timeout=35) as response:
                return response.read()
        except Exception:
            if attempt==2: raise
            time.sleep(2**attempt)


def vortex_fixture():
    manifest_bytes=get(ROOT+'latest.json')
    manifest=json.loads(manifest_bytes)
    assert manifest['complete'] and manifest['count']==31
    entry=manifest['files']['0']
    body=get(ROOT+entry['path'])
    assert len(body)==entry['bytes'] and sha256(body).hexdigest()==entry['sha256']
    assets={entry['path']:body}
    assert json.loads(body).get('baseMap'),'Need a complete 500hPa anomaly background'
    heat=manifest['heatFlux']
    flux=get(ROOT+heat['path'])
    assert len(flux)==heat['bytes'] and sha256(flux).hexdigest()==heat['sha256']
    assets[heat['path']]=flux
    return manifest_bytes,assets


def diagnostic_fixture(model):
    n=31 if model=='gefs' else 51
    end=384 if model=='gefs' else 360
    return dict(version=1,model=model,run=BASE,level=10,count=n,maxHour=end,
      complete=True,inputSha256='a'*64,preparedAt=BASE,
      windBasis='native 60N full longitude circle',
      temperatureBasis='area-weighted 2 degree display grid, 60–90N',
      points=[dict(hour=h,wind=[13+h/200-m/40 for m in range(n)],
                   temperature=[-68+h/110+m/35 for m in range(n)]) for h in range(0,end+1,6)])


def fixture_html():
    return '''<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"/></head>
    <body style="background:#0d202a;color:#c5d8e2"><div id="root"></div>
    <script type="module">
    import React from 'react';
    import {createRoot} from 'react-dom/client';
    import {PolarMap} from './components/polar-map.tsx';
    import {ZonalWindCard} from './components/zonal-wind-card.tsx';
    import {SeasonalChart} from './components/seasonal-chart.tsx';
    import {NorthernComparison} from './components/northern-diagnostics.tsx';
    import {VortexView} from './components/vortex-view.tsx';
    import {Ec46Chart} from './components/ec46-chart.tsx';
    import './app/globals.css';
    const date='2026-10-10T00:00:00.000Z';
    const grid={nx:360,ny:91,lat0:90,lon0:0,dx:1,dy:-1};
    const N=grid.nx*grid.ny;
    const frame={model:'gfs',run:date,valid:date,hour:0,level:10,grid,
     temperature:Array.from({length:N},(_,i)=>-75+(i%360)/18),
     height:Array.from({length:N},(_,i)=>29000+(i%360)*12),
     u:Array.from({length:N},()=>13),v:Array.from({length:N},()=>3),
     zonalWind60N:{value:13,samples:360,longitudeStep:1,basis:'native'}};
    const dates=Array.from({length:80},(_,i)=>new Date(Date.parse(date)+(i+1)*43200000).toISOString().replace('.000Z','.000Z'));
    const members=Array.from({length:8},(_,m)=>({id:'m'+m,values:dates.map((_,i)=>14-0.17*i+Math.sin((i+m)/7)*4+m*.2)}));
    const data={name:'Met Office · GloSea',nominal:date,dates,members,sampling:'12-hourly instantaneous',
     mean:dates.map((_,i)=>members.reduce((sum,m)=>sum+m.values[i],0)/members.length),
     easterlyFraction:dates.map((_,i)=>members.filter(m=>m.values[i]<0).length/members.length),
     attribution:'Contains modified Copernicus Climate Change Service information (2026).'};
    const h=React.createElement;
    const app=h('main',{},[
      h('section',{key:'globe',id:'test-globe',style:{width:'min(95vw,1100px)'}},
        h(PolarMap,{frame,field:'temperature',contours:true,graticule:true,windArrows:false})),
      h('section',{key:'zonal',id:'test-zonal'},
        h(ZonalWindCard,{model:'gfs',run:date,hour:0,member:-1,mapLevel:10,
            mapFrame:frame,mapBusy:false,mapError:'',mapProgress:1,refresh:0})),
      h('section',{key:'seasonal',id:'test-seasonal',style:{width:'min(95vw,1000px)'}},
        h(SeasonalChart,{data,climate:null,era:null,referenceError:false})),
      h('section',{key:'north',id:'test-north'},
        h(NorthernComparison)),
      h('section',{key:'vortex',id:'test-vortex'},
        h(VortexView)),
      h('section',{key:'ec46',id:'test-ec46'},
        h(Ec46Chart,{refresh:0}))
    ]);
    createRoot(document.getElementById('root')).render(app);
    </script></body></html>'''


def verify_png(download,prefix):
    assert download.suggested_filename.startswith(prefix),(download.suggested_filename,prefix)
    assert download.suggested_filename.endswith('.png')
    payload=Path(download.path()).read_bytes()
    assert payload[:8]==b'\x89PNG\r\n\x1a\n'
    image=Image.open(BytesIO(payload))
    assert image.width>=850 and image.height>=250,(image.width,image.height)
    assert len(image.getcolors(maxcolors=10000) or [])!=1,'PNG cannot be one flat colour'
    print('SAVED',download.suggested_filename,image.size,len(payload),'bytes',flush=True)


def click_save(page,name,prefix,timeout=60000):
    button=page.get_by_role('button',name=name,exact=True)
    button.wait_for(state='visible',timeout=timeout)
    page.wait_for_function("""name=>{const b=[...document.querySelectorAll('button')].find(b=>b.getAttribute('aria-label')===name);
        return b&&!b.disabled;}""",arg=name,timeout=timeout)
    with page.expect_download(timeout=timeout) as info:button.click()
    verify_png(info.value,prefix)
    assert page.locator('.image-save-error').count()==0,'Save produced UI error'


def main():
    manifest,assets=vortex_fixture()
    png=BytesIO()
    Image.new('RGB',(1100,620),(239,240,243)).save(png,format='PNG')
    official=png.getvalue()
    diagnostics={m:json.dumps(diagnostic_fixture(m)).encode() for m in ['gefs','ifs_ens','aifs_ens']}
    harness=Path('export-smoke.html')
    harness.write_text(fixture_html(),encoding='utf8')
    log=open('/tmp/stratoscope-save-browser.log','w')
    server=subprocess.Popen(['npm','run','dev:pages'],stdout=log,stderr=subprocess.STDOUT)
    try:
      for _ in range(90):
        try:
            with urlopen(URL,timeout=2):break
        except Exception:time.sleep(1)
      else:raise RuntimeError('Vite test server did not start')
      with sync_playwright() as pw:
        browser=pw.chromium.launch(args=['--enable-webgl','--use-gl=angle','--use-angle=swiftshader'])
        for width,height,mobile in [(1440,900,False),(390,844,True)]:
          context=browser.new_context(viewport={'width':width,'height':height},
             is_mobile=mobile,has_touch=mobile,accept_downloads=True,device_scale_factor=2 if mobile else 1)
          page=context.new_page();page.set_default_timeout(60000)
          errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
          def vortex_route(route):
              path=urlsplit(route.request.url).path.split('/forecast-data-vortex/',1)[1]
              if path=='latest.json':
                  route.fulfill(status=200,body=manifest,headers={'Access-Control-Allow-Origin':'*'},content_type='application/json')
              elif path in assets:
                  route.fulfill(status=200,body=assets[path],headers={'Access-Control-Allow-Origin':'*'},content_type='application/json')
              else:route.abort()
          page.route('**/forecast-data-vortex/**',vortex_route)
          def diag_route(route):
              model=urlsplit(route.request.url).path.rsplit('/',1)[-1].replace('.json','')
              if model in diagnostics:route.fulfill(status=200,body=diagnostics[model],headers={'Access-Control-Allow-Origin':'*'},content_type='application/json')
              else:route.abort()
          page.route('**/forecast-data-diagnostics/**',diag_route)
          def ec_route(route):
              url=route.request.url
              if '/opencharts-api/' in url:
                  body=json.dumps({'data':{'attributes':{'name':'extended-zonal-mean-zonal-wind'},'link':{'href':'https://charts.ecmwf.int/content/mock.png','type':'image/png'}}})
                  route.fulfill(status=200,body=body,content_type='application/json',headers={'Access-Control-Allow-Origin':'*'})
              else:
                  route.fulfill(status=200,body=official,content_type='image/png',headers={'Access-Control-Allow-Origin':'*'})
          page.route('**/charts.ecmwf.int/**',ec_route)
          page.goto(URL,wait_until='domcontentloaded')
          click_save(page,'Save current forecast globe as PNG','stratoscope-gfs-10hpa')
          click_save(page,'Save zonal wind reading as PNG','stratoscope-zonal-wind-')
          click_save(page,'Save Met Office · GloSea seasonal wind outlook as PNG','stratoscope-met-office-glosea')
          click_save(page,'Save ECMWF EC46 wind chart as PNG','stratoscope-ecmwf-ec46')
          page.get_by_role('button',name=re.compile('Show northern forecast diagnostics')).click()
          click_save(page,'Save 10 hPa · 60°N zonal-mean zonal wind comparison as PNG','stratoscope-northern-wind')
          click_save(page,'Save 10 hPa · 60–90°N area-mean temperature comparison as PNG','stratoscope-northern-temperature')
          page.get_by_role('button',name=re.compile('Show 3D vortex structure')).click()
          click_save(page,'Save 3D polar vortex image as PNG','stratoscope-gefs-3d-pv')
          page.get_by_text('Heat flux · 100 hPa',exact=True).click()
          click_save(page,'Save GEFS eddy heat-flux chart as PNG','stratoscope-gefs-heat-flux')
          if width>1000:
              page.get_by_role('button',name='Full screen',exact=True).click()
              click_save(page,'Save 3D polar vortex image as PNG','stratoscope-gefs-3d-pv')
              page.get_by_role('button',name='Exit full screen',exact=True).click()
          assert not errors,'Browser errors: '+repr(errors)
          print('ALL EXPORTS PASSED',width,height,'mobile',mobile,flush=True)
          context.close()
        browser.close()
    finally:
      server.terminate()
      try:server.wait(timeout=15)
      except subprocess.TimeoutExpired:server.kill()
      log.close()
      harness.unlink(missing_ok=True)


if __name__=='__main__':main()
