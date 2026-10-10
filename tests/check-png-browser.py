"""Browser integration smoke tests with the actual React components and synthetic data.

Run after installing playwright, pillow and Chromium on the CI runner.
No live forecast data are modified and no real model APIs are requested.
"""
from hashlib import sha256
from io import BytesIO
from pathlib import Path
from urllib.parse import urlparse
import json, math, re, subprocess, time
from PIL import Image
from playwright.sync_api import sync_playwright

ROOT=Path(__file__).resolve().parents[1]
RUN='2026-10-10T00:00:00.000Z'
KEY='2026101000'
SOURCE='https://noaa-gefs-pds.s3.amazonaws.com'
def encoded(v):return json.dumps(v,separators=(',',':'),ensure_ascii=False).encode()
heat={'version':1,'model':'gefs','run':RUN,'complete':True,'count':31,'pressure':100,'latitudeBand':[45,75],
      'units':'K m/s','gridDegrees':1,'method':'member-zonal-eddy-heat-flux-area-45-75N',
      'source':SOURCE,'step':12,'maxHour':384,
      'points':[{'hour':i*12,'members':[round(20*math.cos(i/5)+j/3,3) for j in range(31)]} for i in range(33)]}
hb=encoded(heat);hs=sha256(hb).hexdigest();heatpath=f'{KEY}/gefs/heat-flux-{hs}.json'
geo={
 'version':1,'model':'gefs','run':RUN,'hour':0,'count':31,
 'method':'mean-field-pv-equivalent-area-70N','source':SOURCE,
 'pressureLevels':[1,2,3,5,7,10,20,30,50,70,100,150,200],'gridDegrees':1,
 'layers':[{'theta':400+i*25,'pv':round(.15+i*.02,4),
            'segments':[[j,56+i%8,j+5,56+i%8] for j in range(0,360,5)]} for i in range(33)],
 'baseMap':{'version':1,'model':'gefs','run':RUN,'hour':0,'validTime':RUN,'count':31,'pressure':500,'units':'m',
           'method':'ensemble-mean-height-minus-daily-climatology','source':SOURCE,
           'reference':'ncep-ncar-r1-1991-2020-daily',
           'referenceSha256':'87136b82338667251e999fe37c575acefa7444ff6647a7921282fe5d92b14b1a',
           'calendarDay':'10-10','grid':{'nx':360,'ny':61,'lat0':90,'lon0':0,'dx':1,'dy':-1},
           'values':[round(100*math.sin(x/40)*math.cos(y/15),2) for y in range(61) for x in range(360)]}
}
gb=encoded(geo);gs=sha256(gb).hexdigest();geopath=f'{KEY}/gefs/0-{gs}.json'
catalogue={'version':1,'model':'vortex','run':RUN,'count':31,'complete':True,
           'timelineComplete':False,'contextComplete':False,'contextHours':[],
           'targetHour':384,'step':12,'method':'mean-field-pv-equivalent-area-70N',
           'files':{'0':{'path':geopath,'bytes':len(gb),'sha256':gs}}}
body={'latest.json':encoded(catalogue),geopath:gb,heatpath:hb}
fixture=ROOT/'tests/png-smoke.tsx'
source=fixture.read_text()
old="heatFlux:{path:'pending',sha256:'0'.repeat(64),bytes:1}"
new=f"heatFlux:{{path:'{heatpath}',sha256:'{hs}',bytes:{len(hb)}}}"
assert source.count(old)==1
fixture.write_text(source.replace(old,new))
log=open('/tmp/stratoscope-png-vite.log','w')
server=subprocess.Popen(['npm','run','dev:pages'],cwd=ROOT,stdout=log,stderr=subprocess.STDOUT)
try:
    site='http://127.0.0.1:5174/stratoscope/tests/png-smoke.html'
    for _ in range(90):
        try:
            import urllib.request
            with urllib.request.urlopen(site,timeout=2) as resp:
                if resp.status==200:break
        except Exception:time.sleep(1)
    else:raise RuntimeError('Vite did not start')
    with sync_playwright() as p:
        browser=p.chromium.launch(headless=True,args=['--enable-webgl','--use-gl=angle','--use-angle=swiftshader'])
        for width,height,items in [(1366,900,['globe','zonal','seasonal','heat','vortex']), (390,844,['zonal','seasonal','vortex'])]:
            context=browser.new_context(viewport={'width':width,'height':height},device_scale_factor=1,
                                        accept_downloads=True,is_mobile=width<500,has_touch=width<500)
            page=context.new_page()
            errors=[]
            page.on('pageerror',lambda error:errors.append(str(error)))
            def route(request):
                uri=request.request.url
                if '/forecast-data-vortex/' not in uri:
                    return request.continue_()
                path=urlparse(uri).path.split('/forecast-data-vortex/',1)[1]
                if path in body:
                    return request.fulfill(status=200,body=body[path],content_type='application/json',
                                           headers={'Access-Control-Allow-Origin':'*'})
                return request.fulfill(status=404,body='missing')
            page.route('**/forecast-data-vortex/**',route)
            page.goto(site,wait_until='domcontentloaded')
            selectors={
                'globe':'#smoke-globe .image-save-button',
                'zonal':'#smoke-zonal .image-save-button',
                'seasonal':'#smoke-seasonal .image-save-button',
                'heat':'#smoke-heat .image-save-button',
                'vortex':'#smoke-vortex .vortex-heading .image-save-button'
            }
            page.locator(selectors['heat']).wait_for(timeout=60000)
            page.wait_for_function("""() => {
              const btn=document.querySelector('#smoke-heat .image-save-button');
              return btn && !btn.disabled;
            }""", timeout=60000)
            page.get_by_role('button',name=re.compile('Show 3D vortex structure')).click()
            page.wait_for_function("""() => {
               const btn=document.querySelector('#smoke-vortex .vortex-heading .image-save-button');
               return btn && !btn.disabled;
            }""",timeout=60000)
            page.wait_for_timeout(1000)
            for item in items:
                loc=page.locator(selectors[item])
                assert loc.is_visible(),(item,width)
                assert loc.is_enabled(),(item,width)
                with page.expect_download(timeout=90000) as event:
                    loc.click(timeout=15000)
                dl=event.value
                path=dl.path()
                assert dl.suggested_filename.endswith('.png'),dl.suggested_filename
                png=Path(path).read_bytes()
                assert png.startswith(b'\x89PNG\r\n\x1a\n') and len(png)>700,(item,len(png))
                image=Image.open(BytesIO(png)).convert('RGB')
                assert image.width>=680 and image.height>=170,(item,image.size)
                colours=image.resize((80,80)).getcolors(6400)
                assert colours is not None and len(colours)>8,(item,len(colours or []))
                print('PNG OK',width,item,dl.suggested_filename,image.size,len(png),'bytes','colours:',len(colours),flush=True)
            assert not errors,(width,errors)
            context.close()
        browser.close()
finally:
    server.terminate()
    try:server.wait(timeout=15)
    except subprocess.TimeoutExpired:server.kill()
    log.close()
    fixture.write_text(source)
