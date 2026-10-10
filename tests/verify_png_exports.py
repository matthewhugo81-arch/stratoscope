"""End-to-end browser tests for downloadable PNG images, no forecast mutations."""
import hashlib
import json
import os
from pathlib import Path
import subprocess
import struct
import time
import urllib.request
from urllib.parse import urlsplit
from playwright.sync_api import sync_playwright

ROOT="https://raw.githubusercontent.com/matthewhugo81-arch/stratoscope/forecast-data-vortex/"
BASE="http://127.0.0.1:5174/stratoscope/save-export-smoke.html"

def read(url):
    for attempt in range(3):
        try:
            with urllib.request.urlopen(url,timeout=45) as r:return r.read()
        except Exception:
            if attempt==2:raise
            time.sleep(2**attempt)

def checked(path,entry):
    content=read(ROOT+path)
    assert len(content)==entry["bytes"] and hashlib.sha256(content).hexdigest()==entry["sha256"],"Source data checksum failed"
    return content

catalogue=read(ROOT+"latest.json")
manifest=json.loads(catalogue)
assert manifest["complete"] and manifest["timelineComplete"] and manifest["count"]==31
frame=manifest["files"]["0"]
frame_data=checked(frame["path"],frame)
heat=manifest["heatFlux"]
heat_data=checked(heat["path"],heat)

# Exercise real React components with a validated complete NOAA GEFS snapshot,
# plus local synthetic plots for deterministic graphic checks.
harness=Path("save-export-smoke.html")
harness.write_text(r"""<!doctype html>
<html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body>
<div id="root"></div><div id="mosaic" class="member-maps-grid"><div class="member-map-tile"><strong>Control</strong><canvas width="128" height="128"></canvas><span>+6.0 m/s</span></div></div>
<button id="save-mosaic">Save mosaic</button><button id="save-readout">Save readout</button>
<script type="module">
import React from 'react';
import {createRoot} from 'react-dom/client';
import {SeasonalChart} from './components/seasonal-chart.tsx';
import {VortexView} from './components/vortex-view.tsx';
import {PolarMap} from './components/polar-map.tsx';
import {saveReadoutCard,saveMemberMosaic} from './lib/image-export.ts';
import './app/globals.css';
const n=360;
const nominal='2026-10-01T00:00:00.000Z';
const dates=Array.from({length:n},(_,i)=>new Date(Date.parse(nominal)+(i+1)*43200000).toISOString());
const vals=Array.from({length:n},(_,i)=>6*Math.sin(i/13)-8);
const d={name:'October GloSea test',nominal,dates,members:[{id:'m0',values:vals}],mean:vals,easterlyFraction:vals.map(v=>v<0?1:0),sampling:'12-hourly instantaneous',attribution:'Test fixture based on synthetic values; not an official forecast'};
const grid={nx:360,ny:91,lat0:90,lon0:0,dx:1,dy:-1};
const count=360*91,run='2026-10-10T00:00:00.000Z';
const frame={model:'gfs',run,valid:run,hour:0,level:10,grid,temperature:Array.from({length:count},(_,i)=>-60+20*Math.sin(i/100)),height:Array.from({length:count},(_,i)=>31000+300*Math.sin(i/250)),u:Array(count).fill(12),v:Array(count).fill(4)};
createRoot(document.getElementById('root')).render(React.createElement('div',{},
 React.createElement('div', {id:'sample-seasonal'},React.createElement(SeasonalChart,{data:d,climate:null,era:null})),
 React.createElement('div', {id:'sample-globe'},React.createElement(PolarMap,{frame,field:'temperature',contours:true,graticule:true,windArrows:false})),
 React.createElement(VortexView)
));
const canvas=document.querySelector('#mosaic canvas'),ctx=canvas.getContext('2d');
ctx.fillStyle='#315da8';ctx.fillRect(0,0,128,128);
ctx.fillStyle='#e9b879';ctx.fillRect(15,20,90,65);
document.getElementById('save-mosaic').onclick=()=>saveMemberMosaic(document.getElementById('mosaic'),{filename:'test-mosaic',title:'GEFS member mosaic',subtitle:'test frame',notes:['Synthetic test tiles']});
document.getElementById('save-readout').onclick=()=>saveReadoutCard({filename:'test-zonal-wind',title:'GEFS 60N 10hPa wind',subtitle:'Run 00Z +84h',notes:['Signed u']},'-12.4 m/s','Easterly');
</script></body></html>""",encoding="utf8")

log=open("/tmp/stratoscope-save-vite.log","w")
server=subprocess.Popen(["npm","run","dev:pages"],stdout=log,stderr=subprocess.STDOUT)
def verify(file,min_width=100,min_height=150):
    b=Path(file).read_bytes()
    assert b.startswith(b"\x89PNG\r\n\x1a\n") and len(b)>3500, ("Invalid/empty PNG",len(b))
    w,h=struct.unpack(">II",b[16:24]);assert w>=min_width and h>=min_height,(w,h)
    print("DOWNLOAD_OK",Path(file).name,w,h,len(b),flush=True)
    return hashlib.sha256(b).hexdigest()

def download(page,selector,filename):
    with page.expect_download(timeout=90000) as future:page.locator(selector).click()
    item=future.value
    assert item.suggested_filename.endswith(".png"), item.suggested_filename
    path="/tmp/"+filename
    item.save_as(path)
    verify(path)
    assert not page.locator(".image-save-error:visible").count(),page.locator(".image-save-error:visible").all_text_contents()
    return path

try:
    for _ in range(60):
        try:
            urllib.request.urlopen(BASE,timeout=2).close();break
        except Exception:time.sleep(.5)
    else:raise RuntimeError("Vite did not start")

    with sync_playwright() as p:
        browser=p.chromium.launch()
        for width,height,mobile in [(1440,900,False),(390,844,True)]:
            context=browser.new_context(viewport={"width":width,"height":height},is_mobile=mobile,has_touch=mobile,device_scale_factor=2 if mobile else 1,accept_downloads=True)
            page=context.new_page()
            page.set_default_timeout(65000)
            errors=[]
            page.on("pageerror",lambda e:errors.append(str(e)))
            def route(r):
                path=urlsplit(r.request.url).path.split("/forecast-data-vortex/",1)[1]
                payload=catalogue if path=="latest.json" else frame_data if path==frame["path"] else heat_data if path==heat["path"] else None
                if payload is None:r.continue_()
                else:r.fulfill(status=200,body=payload,content_type="application/json",headers={"Access-Control-Allow-Origin":"*"})
            page.route("**/forecast-data-vortex/**",route)
            page.goto(BASE,wait_until="domcontentloaded")
            page.locator("#sample-seasonal svg").wait_for()
            page.locator("#sample-globe .globe-overlay").wait_for()
            page.locator("#sample-globe .globe-tools .image-save").wait_for()
            page.wait_for_timeout(450)
            id=f"{width}x{height}"
            first=download(page,"#sample-seasonal .image-save",f"{id}-seasonal.png")
            page.locator("#sample-seasonal .glosea-slider").fill("190")
            changed=download(page,"#sample-seasonal .image-save",f"{id}-seasonal-changed.png")
            assert verify(first)!=verify(changed),"Selected chart time must change exported pixels"
            download(page,"#sample-globe .image-save",f"{id}-globe.png")
            download(page,"#save-readout",f"{id}-zonal.png")
            download(page,"#save-mosaic",f"{id}-mosaic.png")
            page.get_by_role("button",name="Show 3D vortex structure").click()
            page.locator(".vortex-canvas").wait_for()
            page.wait_for_function("document.querySelector('.vortex-canvas')?.__vortexReady===true" if False else "document.querySelector('.vortex-stamp')?.textContent.includes('Run')")
            page.wait_for_timeout(900)
            download(page,".vortex-view-controls .image-save",f"{id}-vortex.png")
            page.get_by_role("button",name="Full screen",exact=True).click()
            page.wait_for_timeout(550)
            download(page,".vortex-view-controls .image-save",f"{id}-vortex-full.png")
            page.locator(".vortex-heat summary").click()
            page.locator(".heat-flux-plot svg").wait_for()
            page.wait_for_timeout(350)
            download(page,".heat-flux-heading .image-save",f"{id}-heatflux.png")
            assert not errors,errors
            print("VIEWPORT_PASS",id,"mobile",mobile,flush=True)
            context.close()
        browser.close()
finally:
    server.terminate()
    try:server.wait(timeout=15)
    except Exception:server.kill()
    log.close()
    harness.unlink(missing_ok=True)
