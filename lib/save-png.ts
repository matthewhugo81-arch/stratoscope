/** Client-side exports. No server, tracking, screenshot permissions or remote uploads. */
export type PngExport={
 filename:string;
 title:string;
 subtitle?:string;
 caption?:string;
};

function cleanFilename(value:string){
 const name=value.normalize('NFKD').replace(/[^a-zA-Z0-9._-]+/g,'-').replace(/^-+|-+$/g,'').slice(0,140);
 return (name||'stratoscope-forecast').replace(/\.png$/i,'')+'.png';
}

async function download(blob:Blob,filename:string){
 if(!blob.size||!blob.type.includes('png'))throw Error('The image could not be encoded as PNG.');
 const url=URL.createObjectURL(blob);
 try{
  const a=document.createElement('a');a.href=url;a.download=cleanFilename(filename);
  a.style.display='none';document.body.insertAdjacentElement('beforeend',a);
  try{a.click()}finally{a.remove()}
 }finally{
  // Safari may need time to finish creating the download.
  window.setTimeout(()=>URL.revokeObjectURL(url),60000);
 }
}

function bitmap(source:HTMLCanvasElement):Promise<Blob>{
 return new Promise((resolve,reject)=>source.toBlob(b=>b?resolve(b):reject(Error('PNG export failed. Try again.')),'image/png'));
}

/** A compact, source-labelled forecast graphic with enough margin for all axes. */
export async function saveCanvasPng(source:HTMLCanvasElement,meta:PngExport){
 if(!source.width||!source.height)throw Error('The chart is not ready to save.');
 const scale=Math.min(1,4096/source.width,4096/source.height);
 const width=Math.max(680,Math.ceil(source.width*scale)+60);
 const pad=Math.max(26,Math.round(width*.035)),imageWidth=width-pad*2;
 const maxImageHeight=4096-220;
 const factor=Math.min(1,imageWidth/source.width,maxImageHeight/source.height);
 const drawW=Math.round(source.width*factor),drawH=Math.round(source.height*factor);
 const header=118,footer=meta.caption?76:48;
 const output=document.createElement('canvas');
 output.width=width;output.height=header+drawH+footer;
 const ctx=output.getContext('2d');if(!ctx)throw Error('Your browser cannot create a PNG.');
 ctx.fillStyle='#0b1d27';ctx.fillRect(0,0,output.width,output.height);
 ctx.fillStyle='#a6e6d9';ctx.fillRect(pad,28,38,3);
 ctx.fillStyle='#edf8fa';ctx.font='600 28px system-ui, Arial, sans-serif';
 ctx.fillText(meta.title,pad,68,width-2*pad);
 ctx.fillStyle='#a6becb';ctx.font='16px system-ui, Arial, sans-serif';
 if(meta.subtitle)ctx.fillText(meta.subtitle,pad,95,width-2*pad);
 const x=Math.round((width-drawW)/2);
 ctx.drawImage(source,x,header,drawW,drawH);
 ctx.fillStyle='#9ab7c4';ctx.font='14px system-ui, Arial, sans-serif';
 if(meta.caption)ctx.fillText(meta.caption,pad,header+drawH+28,width-2*pad);
 ctx.fillStyle='#6d8e9c';ctx.font='12px system-ui, Arial, sans-serif';
 ctx.fillText('STRATOSCOPE · Forecast information · UTC',pad,header+drawH+footer-13,width-2*pad);
 await download(await bitmap(output),meta.filename);
}

/** Exports the actual visible SVG/2D canvas/DOM rather than recalculating values. */
export async function saveElementPng(element:HTMLElement|SVGElement|null,meta:PngExport){
 if(!element)throw Error('Open this chart before saving its image.');
 const bounds=element.getBoundingClientRect();
 if(bounds.width<30||bounds.height<30)throw Error('The chart is not ready to save.');
 const {toCanvas}=await import('html-to-image');
 // Member galleries scroll on phones. Export the complete grid (all 31/51
 // members), not only the rows currently visible on screen.
 const memberGrid=element instanceof HTMLElement&&element.classList.contains('member-maps-grid');
 const width=memberGrid?1150:Math.max(bounds.width,element.scrollWidth);
 const height=memberGrid?Math.ceil(element.children.length/7)*165:Math.max(bounds.height,element.scrollHeight);
 const ratio=Math.max(1,Math.min(2,window.devicePixelRatio||1));
 const canvas=await toCanvas(element as HTMLElement,{
  backgroundColor:'#0e202b',
  cacheBust:false,
  width,height,
  style:memberGrid?{width:'1150px',height:height+'px',maxHeight:'none',overflow:'visible',gridTemplateColumns:'repeat(7,minmax(0,1fr))',gridAutoRows:'minmax(0,1fr)'}:undefined,
  pixelRatio:Math.min(ratio,4096/Math.max(width,height)),
  skipFonts:true,
  filter:(node:HTMLElement)=>!node.hasAttribute?.('data-save-exclude')
    &&!node.classList?.contains('image-save-button')
    &&!node.classList?.contains('vortex-view-controls')
    &&!node.classList?.contains('globe-tools')
    &&!node.classList?.contains('probe'),
 });
 await saveCanvasPng(canvas,meta);
}

/** Direct PNG download for permitted remote charts (no proxy or altered imagery). */
export async function saveRemotePng(url:string,filename:string){
 const source=new URL(url);
 if(source.origin!=='https://charts.ecmwf.int'||!source.pathname.startsWith('/content/')){
  throw Error('Unexpected official chart image URL.');
 }
 let response:Response;
 try{response=await fetch(source.href,{mode:'cors',credentials:'omit'});}
 catch{throw Error('The ECMWF image cannot be downloaded automatically. Open the official graphic and use Save Image As.');}
 if(!response.ok||!response.headers.get('content-type')?.toLowerCase().includes('image/png')){
  throw Error('The official PNG was not available for download.');
 }
 const blob=await response.blob();
 if(blob.size>20_000_000)throw Error('Unexpected size of official ECMWF image.');
 await download(blob,filename);
}
