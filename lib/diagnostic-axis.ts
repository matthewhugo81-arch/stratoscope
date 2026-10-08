// Fit the visible curves, with a small margin and roughly five readable ticks.
export function diagnosticAxis(values:number[],includeZero=false){
 const finite=values.filter(Number.isFinite);
 if(includeZero)finite.push(0);
 if(!finite.length)return {min:0,max:1,step:.2,ticks:[0,.2,.4,.6,.8,1]};
 const low=Math.min(...finite),high=Math.max(...finite),span=Math.max(1,high-low),pad=span*.06;
 const bottom=(high-low<1?(high+low)/2-span/2:low)-pad,top=(high-low<1?(high+low)/2+span/2:high)+pad;
 const raw=(top-bottom)/5,power=10**Math.floor(Math.log10(raw));
 const step=([1,2,2.5,5,10].find(v=>v*power>=raw)??10)*power;
 const min=Math.floor(bottom/step)*step,max=Math.ceil(top/step)*step;
 const ticks=Array.from({length:Math.round((max-min)/step)+1},(_,i)=>Number((min+i*step).toFixed(8)));
 return {min,max,step,ticks};
}
