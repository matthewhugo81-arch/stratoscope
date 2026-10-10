"""Isolated main-globe browser checks; synthetic data, no upstream forecast requests."""
from io import BytesIO
from pathlib import Path
import hashlib,json,subprocess,time,urllib.request
from PIL import Image,ImageChops
from playwright.sync_api import sync_playwright

BASE='http://127.0.0.1:5174/stratoscope/globe-mobile-save-test.html'
harness=Path('globe-mobile-save-test.html')
harness.write_text(r'''<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body>
<div id="root" style="max-width:720px;margin:auto"></div>
<script type="module">
import React from 'react';import {createRoot} from 'react-dom/client';
import {PolarMap} from './components/polar-map.tsx';import './app/globals.css';
const grid={nx:360,ny:91,lat0:90,lon0:0,dx:1,dy:-1};
const run='2026-10-10T00:00:00.000Z',count=360*91;
const frame={model:'gfs',source:'synthetic-regression-fixture',run,valid:'2026-10-12T06:00:00.000Z',hour:54,level:10,grid,
 temperature:Array.from({length:count},(_,i)=>-60+20*Math.sin(i/100)),
 height:Array.from({length:count},(_,i)=>31000+300*Math.sin(i/250)),u:Array(count).fill(12),v:Array(count).fill(4)};
createRoot(document.getElementById('root')).render(React.createElement(PolarMap,{frame,field:'temperature',contours:true,graticule:true,windArrows:false}));
</script></body></html>''',encoding='utf8')

log=open('/tmp/globe-mobile-save-test.log','w')
server=subprocess.Popen(['npm','run','dev:pages'],stdout=log,stderr=subprocess.STDOUT)
INIT=r'''
window.__shared=[];window.__created=[];window.__revoked=[];
const create=URL.createObjectURL.bind(URL),revoke=URL.revokeObjectURL.bind(URL);
URL.createObjectURL=b=>{const u=create(b);window.__created.push(u);return u;};
URL.revokeObjectURL=u=>{window.__revoked.push(u);revoke(u);};
const draw=CanvasRenderingContext2D.prototype.drawImage;
CanvasRenderingContext2D.prototype.drawImage=function(source,...args){
 if(source instanceof HTMLCanvasElement&&source.matches('.globe>canvas:not(.globe-overlay)'))throw Error('Export read from the LIVE WebGL canvas');
 return draw.call(this,source,...args);
};
Object.defineProperty(navigator,'canShare',{configurable:true,value:data=>Boolean(data.files?.[0]?.type==='image/png')});
Object.defineProperty(navigator,'share',{configurable:true,value:data=>{
 window.__shared.push({name:data.files[0].name,type:data.files[0].type,size:data.files[0].size,active:navigator.userActivation?.isActive});
 return Promise.resolve();
}});
'''

def checked_png(content):
    assert content.startswith(b'\x89PNG\r\n\x1a\n') and len(content)>10000
    image=Image.open(BytesIO(content)).convert('RGB')
    assert image.width>=550 and image.height>=300
    # Body must contain colours and a dark exterior, not an empty/solid image.
    thumb=image.resize((80,80));colours=thumb.getcolors(6400)
    assert colours and len(colours)>80
    assert max(image.getpixel((2,2)))<65, 'Outside globe background must be dark'
    return image.size

def capture_download(page,selector):
    with page.expect_download(timeout=30000) as future:page.locator(selector).click()
    item=future.value
    assert item.suggested_filename.endswith('.png') and 'plus054' in item.suggested_filename,item.suggested_filename
    content=Path(item.path()).read_bytes();size=checked_png(content)
    return content,size

try:
    for _ in range(90):
        try:
            with urllib.request.urlopen(BASE,timeout=2) as r:
                if r.status==200:break
        except Exception:time.sleep(.5)
    else:raise AssertionError('Test server failed')
    with sync_playwright() as p:
        for engine in ['chromium','webkit']:
            browser=getattr(p,engine).launch()
            for width,height,mobile in [(390,844,True),(844,390,True),(1440,900,False)]:
                context=browser.new_context(viewport={'width':width,'height':height},is_mobile=mobile,has_touch=mobile,device_scale_factor=2 if mobile else 1,accept_downloads=True)
                page=context.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
                page.add_init_script(INIT)
                page.route('**/coastline.json',lambda r:r.fulfill(status=200,json={'features':[]}))
                page.goto(BASE,wait_until='domcontentloaded')
                save=page.locator('.globe-save-row .image-save');save.wait_for()
                page.wait_for_timeout(250)
                stage=page.locator('.polar-map');before=stage.screenshot()
                box=stage.bounding_box();control=save.bounding_box()
                assert box and control and control['y']>=box['y']+box['height']-1,(box,control)
                assert control['height']<=36 and control['width']<100,control
                assert page.locator('.globe-tools .image-save').count()==0
                assert page.locator('.globe-tools button').count()==4
                if mobile:
                    save.click();dialog=page.locator('.globe-save-dialog');dialog.wait_for(state='visible')
                    image=dialog.locator('img')
                    page.wait_for_function("document.querySelector('.globe-save-preview')?.naturalWidth>100")
                    assert page.get_by_role('dialog',name='Save globe image').count()==1
                    rect=dialog.bounding_box();assert rect and rect['width']<=width and rect['height']<=height
                    assert page.locator('.image-save-status').count()==0
                    # Stub verifies the PNG File and fresh user activation, not the OS UI.
                    dialog.get_by_role('button',name='Share / Save').click()
                    shared=page.evaluate('window.__shared');assert len(shared)==1 and shared[0]['active'] and shared[0]['size']>10000,shared
                    assert shared[0]['type']=='image/png'
                    content,size=capture_download(page,'.globe-save-actions a[download]')
                    dialog.get_by_role('button',name='Close image preview').click()
                    assert not dialog.count()
                    assert page.evaluate('window.__created.every(u=>window.__revoked.includes(u))')
                    # Unsupported share still provides a visible preview and download.
                    page.evaluate("Object.defineProperty(navigator,'canShare',{configurable:true,value:()=>false})")
                    save.click();page.locator('.globe-save-dialog').wait_for(state='visible')
                    assert not page.get_by_role('button',name='Share / Save').count()
                    assert page.locator('.globe-save-actions a[download]').is_visible()
                    page.keyboard.press('Escape');page.locator('.globe-save-dialog').wait_for(state='detached')
                else:
                    content,size=capture_download(page,'.globe-save-row .image-save')
                    assert page.locator('.globe-save-dialog').count()==0
                page.mouse.move(0,0);page.wait_for_timeout(150)
                after=stage.screenshot()
                a,b=Image.open(BytesIO(before)).convert('RGB'),Image.open(BytesIO(after)).convert('RGB')
                assert a.size==b.size
                assert ImageChops.difference(a,b).getbbox() is None,'Saving altered live globe pixels'
                # Repeated save must preserve image content and view, not shift/mirror it.
                if mobile:
                    save.click();page.locator('.globe-save-dialog').wait_for(state='visible')
                    again,_=capture_download(page,'.globe-save-actions a[download]')
                    page.get_by_role('button',name='Close image preview').click()
                else:again,_=capture_download(page,'.globe-save-row .image-save')
                assert hashlib.sha256(content).digest()==hashlib.sha256(again).digest()
                assert not errors,errors
                print('GLOBE_SAVE_PASS',json.dumps({'engine':engine,'viewport':[width,height],'mobile':mobile,'png':size,'livePixelsUnchanged':True,'liveWebGLNeverCopied':True}),flush=True)
                context.close()
            browser.close()
finally:
    server.terminate()
    try:server.wait(timeout=15)
    except Exception:server.kill()
    log.close();harness.unlink(missing_ok=True)
