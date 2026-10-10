import io,json,time,urllib.request,urllib.error
from urllib.parse import urlsplit,urlunsplit
from PIL import Image,ImageDraw
CACHE={}
ROOT='https://raw.githubusercontent.com/matthewhugo81-arch/stratoscope/'

def get(url):
 u=urlsplit(url);key=urlunsplit((u.scheme,u.netloc,u.path,'',''))
 if key in CACHE:return CACHE[key]
 for attempt in range(3):
  try:
   with urllib.request.urlopen(urllib.request.Request(url,headers={'User-Agent':'Stratoscope-export-regression'}),timeout=40) as r:body=r.read()
   CACHE[key]=body;return body
  except urllib.error.HTTPError as e:
   if e.code not in [429,500,502,503,504] or attempt==2:raise
   time.sleep(30 if e.code in [429,503] else 2**attempt)
  except (TimeoutError,urllib.error.URLError):
   if attempt==2:raise
   time.sleep(2**attempt)

def compact_route(route):
 try:
  body=get(route.request.url)
  route.fulfill(status=200,body=body,content_type='application/json' if '.json' in route.request.url else 'application/octet-stream',headers={'Access-Control-Allow-Origin':'*'})
 except Exception:route.fulfill(status=503,body='Compact test source unavailable',headers={'Access-Control-Allow-Origin':'*'})

EC_IMAGE='https://charts.ecmwf.int/content/stratoscope-export-test.png'
im=Image.new('RGB',(960,350),'white');d=ImageDraw.Draw(im)
d.text((30,20),'EC46 EXPORT TEST FIXTURE - NOT A FORECAST',fill='black')
for y in range(60,300,40):d.line((40,y,920,y),fill='grey')
for i in range(15):d.line([(40+j*22,180+((j*19+i*7)%100)-50) for j in range(40)],fill=(20,70+i*10,210),width=1)
stream=io.BytesIO();im.save(stream,format='PNG');EC_BYTES=stream.getvalue()
def ec_route(route,cors=True):
 if not cors and route.request.resource_type in ['fetch','xhr'] and '/opencharts-api/' not in route.request.url:
  route.abort('accessdenied');return
 if '/opencharts-api/' in route.request.url:
  route.fulfill(status=200,body=json.dumps({'data':{'attributes':{'name':'extended-zonal-mean-zonal-wind'},'link':{'href':EC_IMAGE,'type':'image/png'}}}),content_type='application/json',headers={'Access-Control-Allow-Origin':'*'})
 else:route.fulfill(status=200,body=EC_BYTES,content_type='image/png',headers={'Access-Control-Allow-Origin':'*'} if cors else {})

# Observe the real output canvas; do not replace export or drawing behaviour.
INSTRUMENT=r'''(()=>{
 const p=CanvasRenderingContext2D.prototype,draw=p.drawImage,fill=p.fillText;
 p.drawImage=function(...a){const t=this.getTransform();if(a.length===5)(this.canvas.__images??=[]).push({x:a[1]*t.a+t.e,y:a[2]*t.d+t.f,w:a[3]*t.a,h:a[4]*t.d});return draw.apply(this,a)};
 p.fillText=function(s,x,y,...rest){const t=this.getTransform();(this.canvas.__texts??=[]).push({s:String(s),x:x*t.a+t.e,y:y*t.d+t.f,right:(x+this.measureText(s).width)*t.a+t.e,align:this.textAlign});return fill.call(this,s,x,y,...rest)};
 const original=HTMLCanvasElement.prototype.toBlob;
 HTMLCanvasElement.prototype.toBlob=function(...a){window.__png={w:this.width,h:this.height,texts:this.__texts??[],images:this.__images??[]};return original.apply(this,a)};
})();'''

def verify_png(path,details):
 with Image.open(path) as im:
  assert im.format=='PNG' and im.width<=4096 and im.height<=8192 and im.width*im.height<=12000000,(im.format,im.size)
  rgba=im.convert('RGBA');assert rgba.getextrema()[3]==(255,255),'Unexpected transparent chart background'
  for box in details['images']:
   bounds=(int(box['x']),int(box['y']),int(box['x']+box['w']),int(box['y']+box['h']))
   region=rgba.crop(bounds).convert('RGB')
   colours=region.resize((80,80)).getcolors(6400)
   assert colours is None or len(colours)>10,'Blank chart or missing map layer'
  assert any('STRATOSCOPE' in t['s'] for t in details['texts'])
  for t in details['texts']:
   assert -1<=t['y']<im.height,t
   if t['align']=='left':assert t['right']<=im.width+2,(t,im.size)
  return im.size
