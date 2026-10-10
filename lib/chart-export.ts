import {boundedImageSize,canvasContext,type ChartImage} from './chart-export-meta';
import {freezePlot,drawable} from './chart-export-snapshot';
import {imageLayout} from './chart-export-layout';
export {utcStamp,imageFilename,boundedImageSize} from './chart-export-meta';
export type {ChartImage,ExportPlot,ExportGradient,ExportLegend} from './chart-export-meta';
export async function chartPng(input:ChartImage):Promise<Blob>{
 // Freeze pixels, paths and text before the first await; changing a model or
 // forecast time while encoding must not mislabel an image.
 const plots=input.plots.map(freezePlot);
 if(!plots.length&&!input.readout)throw Error('There is no loaded chart to save.');
 if(plots.length>70)throw Error('Too many chart panels to save in one image.');
 const layout=imageLayout(input,plots),size=boundedImageSize(layout.width,layout.height);
 const canvas=document.createElement('canvas');canvas.width=size.width;canvas.height=size.height;
 const ctx=canvasContext(canvas);ctx.scale(size.scale,size.scale);ctx.fillStyle='#0d202a';ctx.fillRect(0,0,layout.width,layout.height);ctx.textBaseline='top';
 for(const box of layout.boxes){
  if(box.plot.backdrop==='vortex'){
   ctx.save();ctx.translate(box.x+box.width/2,box.y+box.height/2);ctx.scale(box.width/2,box.height/2);
   const bg=ctx.createRadialGradient(0,0,0,0,0,1);bg.addColorStop(0,'#152e38');bg.addColorStop(.75,'#0c1a24');bg.addColorStop(1,'#0c1a24');ctx.fillStyle=bg;ctx.fillRect(-1,-1,2,2);ctx.restore();
  }
  const source=await drawable(box.plot);ctx.drawImage(source,box.x,box.y,box.width,box.height);
 }
 for(const action of layout.draw)action(ctx);
 return new Promise((resolve,reject)=>{
  try{canvas.toBlob(blob=>blob?resolve(blob):reject(Error('The browser could not create the PNG. Try a smaller view.')),'image/png');}
  catch{reject(Error('The browser blocked this image export. Open the original chart to save it.'));}
 });
}
export function downloadPng(blob:Blob,filename:string){
 const url=URL.createObjectURL(blob),link=document.createElement('a');
 link.href=url;link.download=filename.toLowerCase().endsWith('.png')?filename:filename+'.png';link.style.display='none';
 document.body.appendChild(link);link.click();link.remove();
 // Safari/mobile may consume the download asynchronously.
 setTimeout(()=>URL.revokeObjectURL(url),60000);
}
