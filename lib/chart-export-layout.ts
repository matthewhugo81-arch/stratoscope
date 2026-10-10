import {canvasContext,type ChartImage} from './chart-export-meta';
import type {FrozenPlot} from './chart-export-snapshot';
const INK='#e1edf2',MUTED='#a9c3d0';
function wrap(ctx:CanvasRenderingContext2D,value:string,width:number){
 const out:string[]=[];let line='';
 for(const word of value.replace(/\s+/g,' ').trim().split(' ')){
  if(line&&ctx.measureText(line+' '+word).width>width){out.push(line);line='';}
  for(const char of (line?' ':'')+word){
   if(line&&ctx.measureText(line+char).width>width){out.push(line);line='';}line+=char;
  }
 }
 if(line)out.push(line);return out;
}
export function imageLayout(spec:ChartImage,plots:FrozenPlot[]){
 const columns=Math.max(1,Math.min(10,Math.floor(spec.columns??1),plots.length||1));
 const width=columns>1?1600:Math.max(1000,Math.min(1800,Math.max(...plots.map(p=>p.width),936)+64));
 const pad=32,gap=16,available=width-pad*2,cell=(available-gap*(columns-1))/columns;
 const measure=canvasContext(document.createElement('canvas'));
 const draw:((ctx:CanvasRenderingContext2D)=>void)[]=[];let y=28;
 function paragraph(value:string,size=14,colour=MUTED,bold=false,x=pad,maxWidth=available){
  const font=`${bold?'600 ':''}${size}px Arial, sans-serif`;measure.font=font;
  for(const line of wrap(measure,value,maxWidth)){
   const at=y;draw.push(ctx=>{ctx.font=font;ctx.fillStyle=colour;ctx.fillText(line,x,at)});y+=size*1.45;
  }
 }
 paragraph('STRATOSCOPE · NORTHERN HEMISPHERE',11);y+=9;
 paragraph(spec.title,25,INK,true);y+=4;
 for(const line of spec.subtitle??[])paragraph(line);y+=14;
 for(const item of spec.legend??[]){
  const at=y;draw.push(ctx=>{ctx.strokeStyle=item.colour;ctx.lineWidth=3;ctx.setLineDash(item.dashed?[6,4]:[]);ctx.beginPath();ctx.moveTo(pad,at+7);ctx.lineTo(pad+24,at+7);ctx.stroke();ctx.setLineDash([])});
  paragraph(item.label,12,MUTED,false,pad+34,available-34);
 }
 if(spec.legend?.length)y+=12;
 if(spec.readout){paragraph(spec.readout.value,60,spec.readout.colour??INK,true);paragraph(spec.readout.label,18);y+=24;}
 const boxes:{plot:FrozenPlot;x:number;y:number;width:number;height:number}[]=[];
 for(let row=0;row<plots.length;row+=columns){
  let end=y;
  for(let column=0;column<columns&&row+column<plots.length;column++){
   const plot=plots[row+column],x=pad+column*(cell+gap),start=y;
   if(plot.title){paragraph(plot.title,columns===1?17:12,INK,true,x,cell);y+=6;}
   const height=cell*plot.height/plot.width;
   boxes.push({plot,x,y,width:cell,height});y+=height+8;
   if(plot.caption)paragraph(plot.caption,columns===1?13:11,MUTED,false,x,cell);
   end=Math.max(end,y);y=start;
  }
  y=end+18;
 }
 for(const gradient of spec.gradients??[]){
  paragraph(gradient.title,13,INK);const at=y+4,barWidth=Math.min(available,650);y+=40;
  draw.push(ctx=>{
   const bar=ctx.createLinearGradient(pad,0,pad+barWidth,0);
   for(const stop of gradient.stops)bar.addColorStop(stop.at,stop.colour);
   ctx.fillStyle=bar;ctx.fillRect(pad,at,barWidth,10);ctx.font='11px Arial, sans-serif';ctx.fillStyle=MUTED;
   for(const tick of gradient.ticks){ctx.textAlign=tick.at===0?'left':tick.at===1?'right':'center';ctx.fillText(tick.label,pad+barWidth*tick.at,at+16);}ctx.textAlign='left';
  });
 }
 for(const note of spec.notes??[]){paragraph(note,12);y+=5;}
 return {width,height:y+12,draw,boxes};
}
