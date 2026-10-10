import type {Frame} from './grib';
import {createRenderer,type Basis,type Viewport} from './globe';
import type {ImageCaption} from './image-export';

export type GlobeImage={blob:Blob;filename:string;title:string};
export type GlobeSnapshot={frame:Frame;basis:Basis;zoom:number;field:string;contours:boolean;viewport:Viewport;overlay:HTMLCanvasElement;software:boolean;caption:ImageCaption};

/** Main globe only. Never read back the on-screen WebGL canvas: some mobile
 * compositors invalidate/alter that surface when it is copied for a download.
 * The temporary renderer uses exactly the same shader, grid, palette and view.
 */
export async function prepareGlobeImage(s:GlobeSnapshot):Promise<GlobeImage>{
 if(!s.frame||!s.overlay.width||!s.overlay.height)throw Error('Wait for the globe to finish loading.');
 const width=Math.round(s.viewport.width),height=Math.round(s.viewport.height);
 if(width<20||height<20)throw Error('The globe is not visible yet.');
 const ratio=Math.min(s.overlay.width/width,1600/Math.max(width,height));
 const scene=document.createElement('canvas');
 scene.width=Math.round(width*ratio);scene.height=Math.round(height*ratio);
 const ctx=scene.getContext('2d');
 if(!ctx)throw Error('Image export is not available in this browser.');
 ctx.fillStyle='#0d202a';ctx.fillRect(0,0,scene.width,scene.height);
 if(!s.software){
  const surface=document.createElement('canvas');surface.width=scene.width;surface.height=scene.height;
  let renderer:ReturnType<typeof createRenderer>=null;
  let gl:WebGL2RenderingContext|null=null;
  try{
   renderer=createRenderer(surface);
   gl=surface.getContext('webgl2');
   if(!renderer||!gl)throw Error('The image renderer is unavailable. Close unused browser tabs and try again.');
   renderer.draw(s.frame,s.basis,s.zoom,s.field==='wind',s.contours,{...s.viewport,dpr:ratio});
   // Explicit RGBA readback avoids the WebKit WebGL-to-2D drawImage path.
   // GL rows are bottom-up; ImageData is top-down. Alpha stays unpremultiplied.
   const pixels=new Uint8Array(surface.width*surface.height*4);
   gl.readPixels(0,0,surface.width,surface.height,gl.RGBA,gl.UNSIGNED_BYTE,pixels);
   if(gl.isContextLost()||gl.getError()!==gl.NO_ERROR)throw Error('Could not capture this globe. Try again.');
   const raster=document.createElement('canvas');raster.width=surface.width;raster.height=surface.height;
   const r=raster.getContext('2d');if(!r)throw Error('Could not prepare the globe image.');
   const image=r.createImageData(raster.width,raster.height),row=raster.width*4;
   for(let y=0;y<raster.height;y++)image.data.set(pixels.subarray((raster.height-1-y)*row,(raster.height-y)*row),y*row);
   r.putImageData(image,0,0);
   ctx.drawImage(raster,0,0);
   raster.width=0;raster.height=0;
  }finally{
   renderer?.dispose();
   // Release the temporary GPU context, not the live globe's context.
   gl?.getExtension('WEBGL_lose_context')?.loseContext();
   surface.width=0;surface.height=0;
  }
 }
 // This is the 2D coastline/label layer (or complete software-rendered globe),
 // never the visible GPU canvas. All pixels are frozen before the first await.
 ctx.drawImage(s.overlay,0,0,scene.width,scene.height);
 const filename=s.caption.filename.replace(/\.png$/i,'').replace(/[^a-z0-9_-]+/gi,'-').replace(/-{2,}/g,'-').slice(0,150)+'.png';
 const output=document.createElement('canvas');
 const logicalWidth=Math.max(550,width),padding=24;
 const imageHeight=height*(logicalWidth/width);
 const measure=output.getContext('2d');if(!measure)throw Error('Could not prepare the PNG.');
 function lines(text:string,font:string){
  measure!.font=font;
  const result:string[]=[];let line='';
  for(const word of text.split(/\s+/)){
   const next=line?line+' '+word:word;
   if(line&&measure!.measureText(next).width>logicalWidth){result.push(line);line=word;}else line=next;
  }
  if(line)result.push(line);return result;
 }
 const subtitle=lines(s.caption.subtitle,'13px Arial, sans-serif');
 const notes=(s.caption.notes??[]).flatMap(note=>lines(note,'12px Arial, sans-serif'));
 const header=74+subtitle.length*18,footer=46+notes.length*17;
 const logicalHeight=header+imageHeight+footer;
 const scale=Math.min(2,2048/(logicalWidth+2*padding),4096/logicalHeight,Math.sqrt(8_000_000/((logicalWidth+2*padding)*logicalHeight)));
 output.width=Math.round((logicalWidth+2*padding)*scale);output.height=Math.round(logicalHeight*scale);
 const o=output.getContext('2d')!;o.scale(scale,scale);
 o.fillStyle='#0d202a';o.fillRect(0,0,logicalWidth+2*padding,logicalHeight);
 o.fillStyle='#d9edf3';o.font='bold 23px Arial, sans-serif';o.fillText(s.caption.title,padding,38,logicalWidth);
 o.fillStyle='#adc5cf';o.font='13px Arial, sans-serif';subtitle.forEach((line,i)=>o.fillText(line,padding,62+i*18));
 o.drawImage(scene,padding,header,logicalWidth,imageHeight);
 o.font='12px Arial, sans-serif';notes.forEach((line,i)=>o.fillText(line,padding,header+imageHeight+25+i*17));
 o.fillStyle='#7c9ca8';o.font='10px Arial, sans-serif';o.fillText('STRATOSCOPE · UTC',padding,logicalHeight-12);
 scene.width=0;scene.height=0;
 try{
  const blob=await new Promise<Blob>((resolve,reject)=>{
   try{output.toBlob(value=>value?resolve(value):reject(Error('Could not create the PNG.')),'image/png');}catch(e){reject(e);}
  });
  return {blob,filename,title:s.caption.title};
 }finally{output.width=0;output.height=0;}
}
