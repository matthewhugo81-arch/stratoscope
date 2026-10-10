/** Browser-side, lossless PNG exports. Never sends forecast data to a service. */
export type SnapshotOptions={
 filename:string;
 title:string;
 subtitle?:string;
 details?:string[];
 source?:string;
};
type Drawable=HTMLCanvasElement|HTMLImageElement|SVGSVGElement;
const BG='#0c1d27',INK='#e3f0f0',MUTED='#a7c1cb',EDGE='#304a56';

export function safeImageName(value:string){
 const base=value.toLowerCase().replace(/[^a-z0-9_-]+/g,'-').replace(/^-+|-+$/g,'').slice(0,110);
 return (base||'stratoscope-chart')+'.png';
}

function dimensions(element:Drawable){
 if(element instanceof SVGSVGElement){
  const b=element.viewBox.baseVal;
  const w=b?.width||Number(element.getAttribute('width'))||element.getBoundingClientRect().width;
  const h=b?.height||Number(element.getAttribute('height'))||element.getBoundingClientRect().height;
  return {width:w,height:h};
 }
 if(element instanceof HTMLImageElement)return {width:element.naturalWidth,height:element.naturalHeight};
 return {width:element.width,height:element.height};
}
function assertDimensions(width:number,height:number){
 if(!Number.isFinite(width)||!Number.isFinite(height)||width<10||height<10||width*height>30_000_000)
  throw Error('Chart image dimensions are not ready to export.');
}
function loadImage(src:string):Promise<HTMLImageElement>{
 return new Promise((resolve,reject)=>{
  const image=new Image();
  image.onload=()=>resolve(image);
  image.onerror=()=>reject(Error('The chart image could not be decoded for export.'));
  image.src=src;
 });
}
async function snapshotSvg(svg:SVGSVGElement){
 // SVG text styling is supplied by both inline attributes and the site stylesheet.
 // Copy computed styles so exported charts remain legible outside the page.
 const clone=svg.cloneNode(true) as SVGSVGElement;
 clone.setAttribute('xmlns','http://www.w3.org/2000/svg');
 const all=[svg,...Array.from(svg.querySelectorAll('*'))];
 const copied=[clone,...Array.from(clone.querySelectorAll('*'))];
 const properties=['fill','stroke','stroke-width','stroke-opacity','fill-opacity','opacity','font-size','font-family','font-weight','letter-spacing','text-anchor','dominant-baseline','visibility'];
 for(let i=0;i<all.length;i++){
  const css=getComputedStyle(all[i]);
  for(const prop of properties){const value=css.getPropertyValue(prop);if(value)(copied[i] as SVGElement).style.setProperty(prop,value);}
 }
 const {width,height}=dimensions(svg);
 clone.setAttribute('width',String(width));
 clone.setAttribute('height',String(height));
 const blob=new Blob([new XMLSerializer().serializeToString(clone)],{type:'image/svg+xml;charset=utf-8'});
 const objectUrl=URL.createObjectURL(blob);
 try{return await loadImage(objectUrl)}
 finally{URL.revokeObjectURL(objectUrl)}
}
async function snapshotExternalImage(img:HTMLImageElement){
 // Drawing an unverified cross-origin <img> can taint canvas output.
 // Re-request the *same* official image with CORS and a normal Blob URL.
 if(!img.currentSrc&&!img.src)throw Error('The official image has not loaded.');
 const response=await fetch(img.currentSrc||img.src,{mode:'cors',credentials:'omit'});
 if(!response.ok)throw Error('The official chart image is currently unavailable.');
 const mime=response.headers.get('Content-Type')||'';
 if(!mime.toLowerCase().includes('image/'))throw Error('The official chart did not return an image.');
 const blob=await response.blob();
 if(!blob.size||blob.size>25_000_000)throw Error('Unexpected official chart size.');
 const url=URL.createObjectURL(blob);
 try{return await loadImage(url)}
 finally{URL.revokeObjectURL(url)}
}
function drawWrapped(ctx:CanvasRenderingContext2D,message:string,x:number,y:number,maxWidth:number,lineHeight:number,maxLines:number){
 const words=message.split(/\s+/),lines:string[]=[];
 let line='';
 for(const word of words){
  const next=line?line+' '+word:word;
  if(ctx.measureText(next).width>maxWidth&&line){lines.push(line);line=word;}
  else line=next;
 }
 if(line)lines.push(line);
 for(let i=0;i<Math.min(maxLines,lines.length);i++)
  ctx.fillText(lines[i],x,y+i*lineHeight,maxWidth);
 return Math.min(maxLines,lines.length)*lineHeight;
}
async function downloadPng(canvas:HTMLCanvasElement,file:string){
 const blob=await new Promise<Blob>((resolve,reject)=>canvas.toBlob(b=>b?resolve(b):reject(Error('The PNG encoder is unavailable.')),'image/png'));
 const url=URL.createObjectURL(blob),link=document.createElement('a');
 link.href=url;link.download=safeImageName(file);link.style.display='none';
 document.body.appendChild(link);
 try{link.click()}finally{link.remove();setTimeout(()=>URL.revokeObjectURL(url),10000);}
}
export async function saveImageSnapshot(source:Drawable,options:SnapshotOptions){
 const base=dimensions(source);assertDimensions(base.width,base.height);
 const w=Math.round(Math.min(1600,Math.max(880,base.width))),gutter=48,plotWidth=w-2*gutter;
 const ratio=plotWidth/base.width,plotHeight=Math.round(base.height*ratio);
 const lines=(options.details||[]).slice(0,5),header=112,footer=72+lines.length*26+(options.source?28:0);
 const logicalHeight=header+plotHeight+footer;
 if(logicalHeight>7000)throw Error('This chart is too tall to export as one PNG.');
 const pixelRatio=logicalHeight*w>4_000_000?1:2;
 const result=document.createElement('canvas');
 result.width=w*pixelRatio;result.height=logicalHeight*pixelRatio;
 const ctx=result.getContext('2d');if(!ctx)throw Error('PNG export is unavailable in this browser.');
 ctx.scale(pixelRatio,pixelRatio);
 ctx.fillStyle=BG;ctx.fillRect(0,0,w,logicalHeight);
 ctx.fillStyle='#91cbbd';ctx.font='600 15px Arial, sans-serif';
 ctx.fillText('STRATOSCOPE   /   ATMOSPHERIC ATLAS',gutter,29);
 ctx.fillStyle=INK;ctx.font='600 25px Arial, sans-serif';
 ctx.fillText(options.title,gutter,66,w-2*gutter);
 if(options.subtitle){ctx.fillStyle=MUTED;ctx.font='14px Arial, sans-serif';ctx.fillText(options.subtitle,gutter,91,w-2*gutter);}
 ctx.fillStyle='#112b35';ctx.fillRect(gutter,header,plotWidth,plotHeight);
 let drawable:HTMLCanvasElement|HTMLImageElement;
 if(source instanceof SVGSVGElement)drawable=await snapshotSvg(source);
 else if(source instanceof HTMLImageElement)drawable=await snapshotExternalImage(source);
 else drawable=source;
 ctx.drawImage(drawable,gutter,header,plotWidth,plotHeight);
 const baseY=header+plotHeight+26;
 ctx.strokeStyle=EDGE;ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(gutter,baseY-12);ctx.lineTo(w-gutter,baseY-12);ctx.stroke();
 ctx.fillStyle=MUTED;ctx.font='14px Arial, sans-serif';
 let y=baseY;
 for(const d of lines){ctx.fillText(d,gutter,y,plotWidth);y+=26;}
 if(options.source){ctx.fillStyle='#8aabb4';ctx.font='12px Arial, sans-serif';drawWrapped(ctx,options.source,gutter,y+6,plotWidth,18,2);}
 ctx.fillStyle='#7897a3';ctx.font='12px Arial, sans-serif';
 ctx.fillText('Forecast model output · Times UTC · stratoscope',gutter,logicalHeight-19,w-2*gutter);
 await downloadPng(result,options.filename);
}

/** Take the current WebGL globe pixels synchronously, before its framebuffer is cleared. */
export function captureLayeredGlobe(base:HTMLCanvasElement|null,overlay:HTMLCanvasElement,webgl:boolean){
 const result=document.createElement('canvas');
 result.width=overlay.width;result.height=overlay.height;
 const ctx=result.getContext('2d');if(!ctx)throw Error('Cannot capture globe in this browser.');
 if(webgl&&base){
  const gl=base.getContext('webgl2');
  if(!gl)throw Error('The globe renderer is unavailable.');
  const width=base.width,height=base.height,raw=new Uint8Array(width*height*4),pixels=new Uint8ClampedArray(raw.length);
  gl.readPixels(0,0,width,height,gl.RGBA,gl.UNSIGNED_BYTE,raw);
  if(gl.getError()!==gl.NO_ERROR)throw Error('WebGL globe capture failed.');
  const stride=width*4;
  for(let y=0;y<height;y++)pixels.set(raw.subarray((height-y-1)*stride,(height-y)*stride),y*stride);
  const temp=document.createElement('canvas');temp.width=width;temp.height=height;
  const tctx=temp.getContext('2d');if(!tctx)throw Error('Cannot compose WebGL globe.');
  tctx.putImageData(new ImageData(pixels,width,height),0,0);
  ctx.drawImage(temp,0,0,result.width,result.height);
 }
 ctx.drawImage(overlay,0,0,result.width,result.height);
 return result;
}
export async function saveZonalWindSnapshot(options:{value:number;display:string;direction:string;model:string;run:string;valid:string;member:string;grid:string}){
 const canvas=document.createElement('canvas');canvas.width=960;canvas.height=320;
 const ctx=canvas.getContext('2d');if(!ctx)throw Error('Canvas export unavailable.');
 ctx.fillStyle=BG;ctx.fillRect(0,0,canvas.width,canvas.height);
 ctx.fillStyle='#97c5c7';ctx.font='600 19px Arial, sans-serif';ctx.fillText('60°N  /  10 hPa',42,52);
 ctx.fillStyle=options.value<0?'#fa9aa7':'#b5efdd';ctx.font='bold 100px Arial, sans-serif';
 ctx.fillText((options.value>0?'+':'')+options.value.toFixed(1),42,185);
 ctx.fillStyle='#b9d5da';ctx.font='28px Arial, sans-serif';ctx.fillText('m/s',420,174);
 ctx.fillStyle='#b9d5da';ctx.font='24px Arial, sans-serif';ctx.fillText(options.direction,42,236);
 ctx.fillStyle='#91aeba';ctx.font='16px Arial, sans-serif';ctx.fillText('Positive = westerly   |   Negative = easterly',42,285);
 await saveImageSnapshot(canvas,{filename:'stratoscope-zonal-wind-'+options.model+'-'+options.run.slice(0,10)+'-f'+Math.round((Date.parse(options.valid)-Date.parse(options.run))/3600000),
 title:'Zonal-mean zonal wind · 60°N, 10 hPa',
 subtitle:options.model+' · '+options.member,
 details:['Run '+options.run+' · Valid '+options.valid,'Grid: '+options.grid,'Instantaneous u wind, not a formal SSW diagnosis'],
 source:'Official forecast model data; see Stratoscope source and methods.'});
}
