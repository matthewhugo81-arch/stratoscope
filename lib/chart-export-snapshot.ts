import {canvasContext,type ExportPlot} from './chart-export-meta';
import {serializedSvg} from './chart-export-svg';
export type FrozenPlot={title?:string;caption?:string;backdrop?:'vortex';width:number;height:number;canvas?:HTMLCanvasElement;svg?:string;url?:string};
export function freezePlot(plot:ExportPlot):FrozenPlot{
 const {title,caption,backdrop}=plot,source=plot.layers?.[0]??plot.element;
 if(!source)throw Error('Wait for the chart to finish loading, then try Save again.');
 if(source instanceof HTMLCanvasElement){
  if(!source.width||!source.height)throw Error('Wait for the map to finish drawing.');
  const canvas=document.createElement('canvas'),shrink=Math.min(1,4096/source.width,4096/source.height);
  canvas.width=Math.max(1,Math.round(source.width*shrink));canvas.height=Math.max(1,Math.round(source.height*shrink));
  const ctx=canvasContext(canvas);
  for(const layer of plot.layers??[source]){
   if(!layer||layer.width!==source.width||layer.height!==source.height)throw Error('Map layers are not ready at the same size. Try Save again.');
   ctx.drawImage(layer,0,0,canvas.width,canvas.height);
  }
  const rect=source.getBoundingClientRect();
  return {title,caption,backdrop,canvas,width:rect.width||source.width,height:rect.height||source.height};
 }
 if(source instanceof SVGSVGElement){const data=serializedSvg(source);return {title,caption,backdrop,svg:data.markup,width:data.width,height:data.height};}
 if(!source.complete||!source.naturalWidth)throw Error('Wait for the official chart image to finish loading.');
 return {title,caption,backdrop,url:source.currentSrc||source.src,width:source.naturalWidth,height:source.naturalHeight};
}
function image(url:string):Promise<HTMLImageElement>{
 return new Promise((resolve,reject)=>{
  const img=new Image(),timer=setTimeout(()=>{img.src='';reject(Error('Image preparation timed out. Please retry.'));},20000);
  img.onload=()=>{clearTimeout(timer);resolve(img)};
  img.onerror=()=>{clearTimeout(timer);reject(Error('The chart image could not be decoded.'))};img.src=url;
 });
}
export async function drawable(plot:FrozenPlot):Promise<CanvasImageSource>{
 if(plot.canvas)return plot.canvas;
 if(plot.svg)return image('data:image/svg+xml;charset=utf-8,'+encodeURIComponent(plot.svg));
 // Fetch only the displayed official image, without credentials or a proxy.
 let response:Response;
 try{response=await fetch(plot.url!,{mode:'cors',credentials:'omit',signal:AbortSignal.timeout(20000)});}
 catch{throw Error('The source did not permit image saving. Open the original chart to save it.');}
 if(!response.ok)throw Error('The official chart image is temporarily unavailable.');
 const blob=await response.blob();
 if(!blob.type.startsWith('image/')||blob.size>20_000_000)throw Error('Unexpected official chart image.');
 const url=URL.createObjectURL(blob);try{return await image(url);}finally{URL.revokeObjectURL(url);}
}
