"""Run after npm ci with playwright and pillow installed. No files are uploaded."""
import json,re,subprocess,tempfile,time,urllib.request
from pathlib import Path
from playwright.sync_api import sync_playwright,expect
from export_browser_support import compact_route,ec_route,INSTRUMENT,verify_png
URL='http://127.0.0.1:5174/stratoscope/tests/chart-export-harness.html'
results=[]

def new_page(browser,mode,width=1600,height=955,cors=True):
 context=browser.new_context(viewport={'width':width,'height':height},device_scale_factor=2 if width<600 else 1,has_touch=width<600,accept_downloads=True)
 page=context.new_page();page.set_default_timeout(90000);page.add_init_script(INSTRUMENT)
 page.route('https://raw.githubusercontent.com/matthewhugo81-arch/stratoscope/**',compact_route)
 page.route('https://charts.ecmwf.int/**',lambda r:ec_route(r,cors))
 errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
 page.goto(URL+'?mode='+mode,wait_until='domcontentloaded')
 return context,page,errors

def save(page,label,folder,required=()):
 button=page.get_by_role('button',name='Save '+label+' as PNG',exact=True)
 expect(button).to_be_visible();expect(button).to_be_enabled()
 page.wait_for_timeout(300)
 with page.expect_download(timeout=60000) as pending:button.click()
 download=pending.value
 assert not download.failure(),download.failure()
 assert download.suggested_filename.startswith('stratoscope-') and download.suggested_filename.endswith('.png')
 path=folder/(str(len(results))+'-'+download.suggested_filename);download.save_as(path)
 details=page.evaluate('window.__png');size=verify_png(path,details)
 if label.startswith('10 hPa') or label=='northern diagnostic comparison':
  assert all(abs(b['h']/b['w']-.28)<.001 for b in details['images']), 'Selected an icon rather than the forecast SVG'
 text=' '.join(t['s'] for t in details['texts'])
 for part in required:assert part in text,(part,text)
 expect(button).to_be_enabled()
 results.append({'chart':label,'viewport':page.viewport_size,'png':list(size),'bytes':path.stat().st_size,'plots':len(details['images'])})
 print('PNG_PASS',json.dumps(results[-1]),flush=True)
 return text

def run():
 log=open('/tmp/stratoscope-export-vite.log','w')
 server=subprocess.Popen(['npm','run','dev:pages'],stdout=log,stderr=subprocess.STDOUT)
 try:
  for _ in range(60):
   try:urllib.request.urlopen(URL,timeout=2).close();break
   except Exception:time.sleep(1)
  else:raise RuntimeError('Vite test server did not start')
  with tempfile.TemporaryDirectory() as temporary,sync_playwright() as pw:
   folder=Path(temporary);browser=pw.chromium.launch()
   for model in ['egrr','ecmf','lfpw','edzw','cmcc','rjtd','ammc']:
    c,p,errors=new_page(browser,'seasonal&id='+model)
    p.locator('.seasonal-plot svg').wait_for();issue=p.evaluate('window.testIssue')[:10]
    save(p,'seasonal wind outlook',folder,[issue,'60°N, 10 hPa','Forecast mean'])
    if model=='egrr':
     p.get_by_label('Members',exact=True).uncheck()
     text=save(p,'seasonal wind outlook',folder,[issue]);assert 'Ensemble members' not in text
    assert not errors,errors;c.close()
   c,p,errors=new_page(browser,'northern')
   p.get_by_role('button',name=re.compile('Show northern forecast diagnostics')).click()
   expect(p.get_by_role('button',name='Save northern diagnostic comparison as PNG')).to_be_enabled(timeout=90000)
   save(p,'northern diagnostic comparison',folder,['GEFS','ECMWF ENS','AIFS ENS','Init','m/s','°C'])
   save(p,'10 hPa · 60°N zonal-mean zonal wind',folder,['zonal-mean zonal wind'])
   save(p,'10 hPa · 60–90°N area-mean temperature',folder,['area-mean temperature'])
   assert not errors,errors;c.close()
   for kind,width,height in [('chromium',1600,955),('chromium',390,844),('chromium',844,390),('webkit',390,844)]:
    b=browser if kind=='chromium' else pw.webkit.launch()
    c,p,errors=new_page(b,'vortex',width,height)
    p.get_by_role('button',name=re.compile('Show 3D vortex structure')).click();p.locator('.vortex-canvas').wait_for()
    p.get_by_label('3D forecast time').select_option('84')
    expect(p.locator('.vortex-stamp')).to_contain_text('forecast +84h')
    p.get_by_role('button',name='Full screen',exact=True).click();p.wait_for_timeout(500)
    p.get_by_role('button',name='Zoom +',exact=True).click();p.locator('.vortex-canvas').focus();p.locator('.vortex-canvas').press('ArrowUp');p.wait_for_timeout(500)
    before=p.locator('.vortex-canvas').evaluate('(c)=>c.toDataURL()')
    save(p,'3D PV view',folder,['Forecast +84h','500 hPa height anomaly','1200 K','zoom 1.15'])
    after=p.locator('.vortex-canvas').evaluate('(c)=>c.toDataURL()');assert before==after,'Saving changed the selected view'
    p.get_by_role('button',name='Exit full screen',exact=True).click()
    p.locator('.vortex-heat>summary').click();p.locator('.heat-flux-plot svg').wait_for()
    save(p,'heat flux',folder,['GEFS eddy heat flux','31 members','K m/s','Selected valid time'])
    assert not errors,errors;c.close()
    if b is not browser:b.close()
   for mode,label in [('map','model map'),('zonal','zonal wind readout'),('stamps','forecast frame previews'),('members','all ensemble member maps')]:
    c,p,errors=new_page(browser,mode)
    expect(p.get_by_role('button',name='Save '+label+' as PNG')).to_be_enabled(timeout=90000)
    p.wait_for_timeout(1500)
    save(p,label,folder,['GEFS','Run '])
    assert not errors,errors;c.close()
   for kind in ['chromium','webkit']:
    b=browser if kind=='chromium' else pw.webkit.launch()
    c,p,errors=new_page(b,'ec46',390 if kind=='webkit' else 1600)
    p.locator('.ec46-chart img').wait_for();p.wait_for_function("document.querySelector('.ec46-chart img').complete")
    save(p,'EC46 wind outlook',folder,['ECMWF EC46','original chart'])
    assert not errors,errors;c.close()
    if b is not browser:b.close()
   c,p,errors=new_page(browser,'ec46',cors=False)
   p.locator('.ec46-chart img').wait_for();p.wait_for_function("document.querySelector('.ec46-chart img').complete")
   p.get_by_role('button',name='Save EC46 wind outlook as PNG').click()
   expect(p.get_by_role('alert')).to_contain_text('source did not permit')
   expect(p.get_by_role('link',name='Open original chart ↗')).to_be_visible();assert not errors,errors;c.close()
   c,p,errors=new_page(browser,'empty');expect(p.get_by_role('button',name='Save model map as PNG')).to_be_disabled();c.close()
   c,p,errors=new_page(browser,'seasonal');p.locator('.seasonal-plot svg').wait_for()
   p.evaluate('()=>{window.originalToBlob=HTMLCanvasElement.prototype.toBlob;HTMLCanvasElement.prototype.toBlob=function(callback){callback(null)}}')
   p.get_by_role('button',name='Save seasonal wind outlook as PNG').click();expect(p.get_by_role('alert')).to_contain_text('could not create the PNG')
   p.evaluate('()=>{HTMLCanvasElement.prototype.toBlob=window.originalToBlob}')
   save(p,'seasonal wind outlook',folder,['Forecast mean'])
   # The export must not read a different frame or metadata after async decoding.
   race=p.evaluate('''async()=>{
    const {chartPng}=await import('/stratoscope/lib/chart-export.ts');
    const c=document.createElement('canvas');c.width=c.height=20;const ctx=c.getContext('2d');ctx.fillStyle='red';ctx.fillRect(0,0,20,20);
    const spec={title:'FROZEN EXPORT',filename:'test.png',plots:[{element:c}],subtitle:['Run 2026-10-10 00 UTC']};
    const task=chartPng(spec);ctx.fillStyle='green';ctx.fillRect(0,0,20,20);spec.title='WRONG FRAME';
    const blob=await task,info=window.__png,bitmap=await createImageBitmap(blob),test=document.createElement('canvas');test.width=bitmap.width;test.height=bitmap.height;const target=test.getContext('2d');target.drawImage(bitmap,0,0);
    const box=info.images[0],pixel=[...target.getImageData(Math.floor(box.x+box.w/2),Math.floor(box.y+box.h/2),1,1).data];bitmap.close();
    return {pixel,text:info.texts.map(t=>t.s).join(' ')};
   }''')
   assert race['pixel']==[255,0,0,255] and 'FROZEN EXPORT' in race['text'] and 'WRONG FRAME' not in race['text'],race
   assert not errors,errors;c.close();browser.close()
   print('EXPORT_BROWSER_RESULT',json.dumps({'downloads':len(results),'engines':['Chromium','WebKit'],'failureRecovery':'passed','missingDataGuard':'passed','crossOriginFallback':'passed','frozenFrame':'passed'}),flush=True)
 finally:
  server.terminate();server.wait(timeout=15);log.close()

if __name__=='__main__':run()
