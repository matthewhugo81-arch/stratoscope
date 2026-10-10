"""Actual React/CSS layout regression for the oversized Save icon.

Uses synthetic diagnostic series only; no model downloads or publications.
Run --expect-bug before applying the repair to prove the regression is covered.
Chromium plus WebKit exercise desktop, phone portrait and phone landscape sizes.
"""
import argparse
import json
import math
from pathlib import Path
import re
import struct
import subprocess
import time
import urllib.request
from urllib.parse import urlsplit
from playwright.sync_api import sync_playwright

HERE = Path(__file__).resolve().parents[1]
RUN = '2026-10-10T00:00:00.000Z'
URL = 'http://127.0.0.1:5174/stratoscope/save-icon-layout-smoke.html'
HARNESS = r'''<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body>
<div id="root"></div><script type="module">
import React from 'react';
import {createRoot} from 'react-dom/client';
import {NorthernComparison} from './components/northern-diagnostics.tsx';
import {SeasonalChart} from './components/seasonal-chart.tsx';
import {SaveImageButton} from './components/save-image-button.tsx';
import './app/globals.css';
const nominal='2026-10-01T00:00:00.000Z';
const dates=Array.from({length:360},(_,i)=>new Date(Date.parse(nominal)+(i+1)*43200000).toISOString());
const mean=dates.map((_,i)=>18+6*Math.sin(i/25));
const data={name:'Synthetic seasonal layout fixture',nominal,dates,members:[{id:'layout-test',values:mean}],mean,easterlyFraction:mean.map(()=>0),sampling:'12-hourly instantaneous',attribution:'Synthetic regression data; not a real forecast.'};
const save=()=>new Promise(resolve=>setTimeout(resolve,900));
const button=()=>React.createElement(SaveImageButton,{onSave:save});
createRoot(document.getElementById('root')).render(React.createElement('main',{style:{maxWidth:1200,margin:'auto',padding:12}},
 React.createElement(NorthernComparison),
 React.createElement('section',{id:'layout-seasonal'},React.createElement(SeasonalChart,{data,climate:null,era:null})),
 React.createElement('div',{id:'layout-other'},
  React.createElement('div',{className:'heat-flux-heading'},React.createElement('h3',{},'Heat flux'),button()),
  React.createElement('div',{className:'zonal-card'},React.createElement('div',{className:'eyebrow'},'Zonal wind',button())),
  React.createElement('div',{className:'globe-tools',style:{position:'relative',inset:'auto',margin:'12px 0'}},button()),
  React.createElement('div',{className:'ec46-chart'},React.createElement('div',{className:'seasonal-issue'},'EC46',button())),
  React.createElement('div',{className:'vortex-stage',style:{height:90}},React.createElement('div',{className:'vortex-view-controls'},button()))
 )
));
</script></body></html>'''


def diagnostics(model):
    count, hours = (31, 384) if model == 'gefs' else (51, 360)
    return dict(version=1, model=model, run=RUN, level=10, count=count,
                maxHour=hours, complete=True, preparedAt=RUN, inputSha256='a'*64,
                windBasis='native 60N full longitude circle',
                temperatureBasis='area-weighted 2 degree display grid, 60–90N',
                points=[dict(hour=h, wind=[18+math.sin(h/24)+m/100 for m in range(count)],
                             temperature=[-60+math.sin(h/48)+m/50 for m in range(count)])
                        for h in range(0,hours+1,6)])


def dimensions(page):
    return page.locator('button.image-save').evaluate_all('''buttons=>buttons.map(button=>{
      const icon=button.querySelector('svg'),label=button.querySelector('span');
      const b=button.getBoundingClientRect(),i=icon.getBoundingClientRect();
      const style=getComputedStyle(icon),text=getComputedStyle(label);
      return {buttonWidth:b.width,buttonHeight:b.height,iconWidth:parseFloat(style.width),iconHeight:parseFloat(style.height),iconBounds:[i.width,i.height],
        iconMinWidth:style.minWidth,labelDisplay:text.display,labelFont:text.fontSize,
        label:label.textContent,visible:getComputedStyle(button.parentElement).display!=='none'};
    })''')


def assert_small(page):
    measured=dimensions(page)
    assert len(measured)==8, ('Missing Save control',measured)
    for m in measured:
        assert m['visible'], m
        assert 12.9<=m['iconWidth']<=13.1 and 12.9<=m['iconHeight']<=13.1, m
        assert 25<=m['buttonHeight']<=38 and 35<=m['buttonWidth']<=105, m
        assert m['labelDisplay']!='none', m
    # Actual plot SVGs still get full-width chart layout and mobile scroll width.
    for chart in page.locator('.nh-diagnostic-chart > svg').all():
        box=chart.bounding_box()
        assert box['width']>=300 and box['height']>100,box
    return measured


def save_png(page, selector):
    with page.expect_download(timeout=30000) as future:
        page.locator(selector).first.click()
    download=future.value
    assert download.suggested_filename.endswith('.png')
    raw=Path(download.path()).read_bytes()
    assert raw.startswith(b'\x89PNG\r\n\x1a\n') and len(raw)>3500,len(raw)
    w,h=struct.unpack('>II',raw[16:24])
    assert w>600 and h>250,(w,h)
    assert page.locator('.image-save-error:visible').count()==0
    return {'name':download.suggested_filename,'width':w,'height':h,'bytes':len(raw)}


def main():
    parser=argparse.ArgumentParser();parser.add_argument('--expect-bug',action='store_true');args=parser.parse_args()
    harness=HERE/'save-icon-layout-smoke.html';harness.write_text(HARNESS,encoding='utf-8')
    log=open('/tmp/stratoscope-icon-layout-vite.log','w')
    process=subprocess.Popen(['npm','run','dev:pages'],cwd=HERE,stdout=log,stderr=subprocess.STDOUT,start_new_session=True)
    try:
        for _ in range(90):
            try:
                with urllib.request.urlopen(URL,timeout=2):break
            except Exception:time.sleep(.5)
        else:raise RuntimeError('Layout test server unavailable')
        with sync_playwright() as pw:
            engines=['chromium'] if args.expect_bug else ['chromium','webkit']
            for engine in engines:
                browser=getattr(pw,engine).launch()
                sizes=[(390,844)] if args.expect_bug else [(375,812),(390,844),(430,932),(844,390),(1440,900)]
                for width,height in sizes:
                    context=browser.new_context(viewport={'width':width,'height':height},
                                                device_scale_factor=2,is_mobile=width<900,
                                                has_touch=width<900,accept_downloads=True)
                    page=context.new_page();page.set_default_timeout(30000);errors=[]
                    page.on('pageerror',lambda error:errors.append(str(error)))
                    def route(request):
                        model=urlsplit(request.request.url).path.rsplit('/',1)[-1].split('.')[0]
                        if model not in ['gefs','ifs_ens','aifs_ens']:return request.abort()
                        request.fulfill(status=200,json=diagnostics(model),headers={'Access-Control-Allow-Origin':'*'})
                    page.route('**/forecast-data-diagnostics/**',route)
                    page.goto(URL,wait_until='domcontentloaded')
                    page.get_by_role('button',name=re.compile('Show northern forecast diagnostics')).click()
                    page.locator('.nh-diagnostic-chart > svg').first.wait_for()
                    page.wait_for_timeout(200)
                    if args.expect_bug:
                        measurements=dimensions(page)
                        assert measurements[0]['iconWidth']>=580,('Original bug was not reproduced',measurements)
                        print('REPRODUCED original mobile icon',json.dumps(measurements[0]),flush=True)
                    else:
                        measured=assert_small(page)
                        assert not errors,errors
                        # Exercise genuine chart downloads on both browser engines.
                        exports=[]
                        if width in [390,1440]:
                            for selector in ['#northern-diagnostics .nh-diagnostic-chart h3 button.image-save', '#layout-seasonal button.image-save']:
                                exports.append(save_png(page,selector))
                            assert page.locator('.image-save-error:visible').count()==0
                        # Busy spinner must have exactly the same safe dimensions.
                        spinner=page.locator('#layout-other .heat-flux-heading button.image-save')
                        spinner.click();page.locator('#layout-other .heat-flux-heading .spin').wait_for()
                        assert_small(page)
                        page.wait_for_function("!document.querySelector('#layout-other .heat-flux-heading button.image-save').disabled")
                        print('LAYOUT_PASS',json.dumps({'browser':engine,'viewport':[width,height],
                              'saveControls':len(measured),'icon':'13x13 CSS pixels','exports':exports}),flush=True)
                    context.close()
                browser.close()
    finally:
        import os,signal
        try:os.killpg(process.pid,signal.SIGTERM)
        except ProcessLookupError:pass
        process.wait(timeout=15);log.close();harness.unlink(missing_ok=True)


if __name__=='__main__':main()
