export type ChartElement=HTMLCanvasElement|SVGSVGElement|HTMLImageElement;
export type ExportPlot={element?:ChartElement|null;layers?:(HTMLCanvasElement|null)[];title?:string;caption?:string;backdrop?:'vortex'};
export type ExportLegend={label:string;colour:string;dashed?:boolean};
export type ExportGradient={title:string;stops:{at:number;colour:string}[];ticks:{at:number;label:string}[]};
export type ChartImage={title:string;filename:string;subtitle?:string[];plots:ExportPlot[];columns?:number;legend?:ExportLegend[];gradients?:ExportGradient[];notes?:string[];readout?:{value:string;label:string;colour?:string}};
export function utcStamp(value:string){const t=Date.parse(value);return Number.isFinite(t)?new Date(t).toISOString().replace('T',' ').replace('.000Z',' UTC'):'Time unavailable';}
export function imageFilename(...parts:(string|number|undefined)[]){
 const name=parts.filter(p=>p!==undefined).join('-').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-zA-Z0-9_-]+/g,'-').replace(/-+/g,'-').replace(/^-|-$/g,'').slice(0,185);
 return 'stratoscope-'+(name||'chart')+'.png';
}
export function boundedImageSize(width:number,height:number){
 if(!Number.isFinite(width)||!Number.isFinite(height)||width<=0||height<=0)throw Error('The chart has no drawable size.');
 const scale=Math.min(2,4096/width,8192/height,Math.sqrt(12_000_000/(width*height)));
 return {width:Math.max(1,Math.floor(width*scale)),height:Math.max(1,Math.floor(height*scale)),scale};
}
export function canvasContext(canvas:HTMLCanvasElement){const ctx=canvas.getContext('2d');if(!ctx)throw Error('Image export is unavailable in this browser.');return ctx;}
