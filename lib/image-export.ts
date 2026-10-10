/**
 * Client-only PNG exports for Stratoscope. Every pixel comes from the currently
 * displayed image, SVG or canvas. No screenshot service or external API.
 */
export type ImageCaption={
 filename:string;
 title:string;
 subtitle:string;
 notes?:string[];
};

const ink='#d9edf3',muted='#adc5cf',back='#0d202a';
const clean=(name:string)=>name.replace(/\.png$/i,'').replace(/[^a-z0-9_-]+/gi,'-').replace(/-{2,}/g,'-').slice(0,150)+'.png';

export function downloadBlob(blob:Blob,filename:string){
 if(blob.size<10)throw Error('The exported image was empty.');
 const url=URL.createObjectURL(blob),link=document.createElement('a');
 link.href=url;link.download=clean(filename);link.style.display='none';
 document.body.appendChild(link);
 try{link.click()}finally{link.remove();window.setTimeout(()=>URL.revokeObjectURL(url),30000);}
}

function png(canvas:HTMLCanvasElement):Promise<Blob>{
 return new Promise((resolve,reject)=>{
  try{canvas.toBlob(blob=>blob?resolve(blob):reject(Error('Could not encode PNG.')),'image/png');}
  catch(error){reject(error)}
 });
}

function prepared(width:number,height:number){
 if(!Number.isFinite(width)||!Number.isFinite(height)||width<20||height<20)throw Error('The selected chart is not ready.');
 // Max 25 megapixels and 8192 CSS pixels: keep mobile exports responsive.
 const factor=Math.min(2,8192/Math.max(width,height),Math.sqrt(25_000_000/(width*height)));
 const canvas=document.createElement('canvas');
 canvas.width=Math.round(width*factor);canvas.height=Math.round(height*factor);
 const ctx=canvas.getContext('2d');
 if(!ctx)throw Error('Canvas export is unavailable in this browser.');
 ctx.scale(factor,factor);
 return {canvas,ctx};
}

function wrapped(ctx:CanvasRenderingContext2D,message:string,x:number,y:number,maxWidth:number,step=17){
 const words=message.split(/\s+/);let line='';let lines=0;
 for(const word of words){
  const next=line?line+' '+word:word;
  if(line&&ctx.measureText(next).width>maxWidth){ctx.fillText(line,x,y+lines*step);lines++;line=word;}
  else line=next;
 }
 if(line){ctx.fillText(line,x,y+lines*step);lines++;}
 return lines;
}

async function exportSurface(draw:(ctx:CanvasRenderingContext2D,left:number,top:number,w:number,h:number)=>Promise<void>|void,size:{w:number;h:number},caption:ImageCaption){
 const margin=24,header=102,notes=caption.notes??[],foot=Math.max(59,28+notes.length*36);
 const {canvas,ctx}=prepared(size.w+margin*2,size.h+header+foot);
 const cw=size.w+margin*2,ch=size.h+header+foot;
 ctx.fillStyle=back;ctx.fillRect(0,0,cw,ch);
 ctx.fillStyle='#16323c';ctx.fillRect(0,0,cw,7);
 ctx.fillStyle=ink;ctx.font='bold 23px Arial, sans-serif';ctx.textBaseline='alphabetic';
 ctx.fillText(caption.title,margin,43,Math.max(20,cw-margin*2));
 ctx.font='13px Arial, sans-serif';ctx.fillStyle=muted;
 wrapped(ctx,caption.subtitle,margin,68,cw-margin*2);
 ctx.fillStyle='#081820';ctx.fillRect(margin,header,size.w,size.h);
 await draw(ctx,margin,header,size.w,size.h);
 ctx.fillStyle='#40616b';ctx.fillRect(margin,header+size.h+16,size.w,1);
 ctx.fillStyle=muted;ctx.font='12px Arial, sans-serif';
 let y=header+size.h+38;
 for(const note of notes){y+=wrapped(ctx,note,margin,y,cw-margin*2,16)*16+7;}
 ctx.textAlign='right';ctx.fillStyle='#7c9ca8';ctx.font='10px Arial, sans-serif';
 ctx.fillText('STRATOSCOPE · UTC',cw-margin,ch-13);
 downloadBlob(await png(canvas),caption.filename);
}

const SVG_STYLE=['fill','fill-opacity','stroke','stroke-opacity','stroke-width','stroke-dasharray','stroke-linecap','stroke-linejoin','opacity','font-family','font-size','font-style','font-weight','letter-spacing','text-anchor','dominant-baseline','paint-order','visibility'];
export async function saveSvgChart(svg:SVGSVGElement,caption:ImageCaption){
 const view=svg.viewBox.baseVal;
 const w=view?.width||svg.clientWidth,h=view?.height||svg.clientHeight;
 if(w<20||h<20)throw Error('The chart has not finished rendering.');
 // Inlining computed styles retains chart CSS (notably the diagnostic axis labels).
 const clone=svg.cloneNode(true) as SVGSVGElement;
 clone.setAttribute('xmlns','http://www.w3.org/2000/svg');
 clone.setAttribute('width',String(w));
 clone.setAttribute('height',String(h));
 const originals=[svg,...svg.querySelectorAll('*')];
 const copies=[clone,...clone.querySelectorAll('*')];
 for(let i=0;i<originals.length;i++){
  const original=originals[i],copy=copies[i] as SVGElement;
  const style=window.getComputedStyle(original);
  for(const property of SVG_STYLE){
   const value=style.getPropertyValue(property);
   if(value)copy.style.setProperty(property,value);
  }
 }
 const source=new XMLSerializer().serializeToString(clone);
 const url=URL.createObjectURL(new Blob([source],{type:'image/svg+xml;charset=utf-8'}));
 try{
  const img=await new Promise<HTMLImageElement>((resolve,reject)=>{
   const element=new Image();
   element.onload=()=>resolve(element);
   element.onerror=()=>reject(Error('The chart SVG could not be rendered as a PNG.'));
   element.src=url;
  });
  await exportSurface(ctx=>{ctx.drawImage(img,24,102,w,h);},{w,h},caption);
 }finally{URL.revokeObjectURL(url);}
}

export async function saveCanvasScene(layers:HTMLCanvasElement[],caption:ImageCaption){
 const first=layers[0];
 if(!first||!first.width||!first.height)throw Error('The chart image is not ready.');
 const box=first.getBoundingClientRect();
 const w=Math.round(box.width||first.width),h=Math.round(box.height||first.height);
 await exportSurface((ctx,x,y)=>{
  for(const layer of layers){
   if(!layer)continue;
   const rect=layer.getBoundingClientRect();
   if(rect.width<=0||rect.height<=0)throw Error('A chart layer is not ready.');
   ctx.drawImage(layer,x,y,w,h);
  }
 },{w,h},caption);
}

export async function saveReadoutCard(caption:ImageCaption,reading:string,direction:string){
 const w=550,h=170;
 await exportSurface((ctx,x,y)=>{
  ctx.fillStyle='#142d35';ctx.fillRect(x,y,w,h);
  ctx.fillStyle=direction.toLowerCase().includes('easterly')?'#ffd093':'#b8edda';
  ctx.font='bold 65px monospace';ctx.textAlign='center';
  ctx.fillText(reading,x+w/2,y+87,w-35);
  ctx.font='16px Arial, sans-serif';ctx.fillStyle=muted;
  ctx.fillText(direction,x+w/2,y+125);
  ctx.textAlign='left';
 },{w,h},caption);
}

export async function saveMemberMosaic(container:HTMLElement,caption:ImageCaption){
 const tiles=Array.from(container.querySelectorAll<HTMLElement>('.member-map-tile'));
 if(!tiles.length)throw Error('The ensemble member maps have not loaded.');
 if(tiles.some(tile=>!tile.querySelector('canvas')?.width))throw Error('A member map is still loading.');
 const columns=Math.min(7,Math.max(3,Math.ceil(Math.sqrt(tiles.length*1.4))));
 const tile=164,cellW=175,cellH=199,gap=7;
 const rows=Math.ceil(tiles.length/columns);
 const w=columns*cellW+(columns-1)*gap,h=rows*cellH+(rows-1)*gap;
 await exportSurface((ctx,x,y)=>{
  for(let i=0;i<tiles.length;i++){
   const tileElement=tiles[i],canvas=tileElement.querySelector('canvas')!;
   const col=i%columns,row=Math.floor(i/columns),left=x+col*(cellW+gap),top=y+row*(cellH+gap);
   const easterly=tileElement.classList.contains('easterly');
   ctx.fillStyle='#102733';ctx.fillRect(left,top,cellW,cellH);
   ctx.strokeStyle=easterly?'#fa6174':'#365766';ctx.lineWidth=2;ctx.strokeRect(left+1,top+1,cellW-2,cellH-2);
   ctx.drawImage(canvas,left+(cellW-tile)/2,top+23,tile,tile);
   ctx.fillStyle=ink;ctx.textAlign='center';ctx.font='12px Arial, sans-serif';
   ctx.fillText(tileElement.querySelector('strong')?.textContent??'Member',left+cellW/2,top+17);
   ctx.fillStyle=easterly?'#ffacb7':muted;ctx.font='11px Arial, sans-serif';
   ctx.fillText(tileElement.querySelector('span')?.textContent??'',left+cellW/2,top+cellH-9);
  }
  ctx.textAlign='left';
 },{w,h},caption);
}

export async function saveOfficialPng(url:string,filename:string){
 // For official ECMWF raster graphics, retain the supplied PNG as-is rather
 // than rasterising and altering its labels. Cross-origin access needs CORS.
 const u=new URL(url);
 if(u.protocol!=='https:'||u.hostname!=='charts.ecmwf.int'||!u.pathname.startsWith('/content/'))throw Error('Unverified official chart URL.');
 const response=await fetch(url,{mode:'cors',cache:'no-cache',signal:AbortSignal.timeout(30000)});
 if(!response.ok)throw Error('The official chart is not available for downloading.');
 const blob=await response.blob();
 if(!blob.type.toLowerCase().startsWith('image/png')||blob.size>25_000_000)throw Error('The chart did not return a valid PNG.');
 downloadBlob(blob,filename);
}
