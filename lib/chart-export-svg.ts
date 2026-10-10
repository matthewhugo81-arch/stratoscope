import {boundedImageSize} from './chart-export-meta';
const properties=['color','fill','fill-opacity','fill-rule','stroke','stroke-width','stroke-opacity','stroke-dasharray','stroke-dashoffset','stroke-linecap','stroke-linejoin','stroke-miterlimit','opacity','font-size','font-weight','font-style','letter-spacing','text-anchor','dominant-baseline','visibility','display','paint-order','vector-effect'];
export function serializedSvg(svg:SVGSVGElement){
 const clone=svg.cloneNode(true) as SVGSVGElement;
 const originals=[svg,...svg.querySelectorAll('*')],copies=[clone,...clone.querySelectorAll('*')];
 for(let i=0;i<originals.length;i++){
  const style=getComputedStyle(originals[i]),target=copies[i] as SVGElement;
  for(const key of properties){
   const value=style.getPropertyValue(key).replace(/url\(["']?[^)#]*#([^)'"]+)["']?\)/g,'url(#$1)');
   if(value)target.style.setProperty(key,value);
  }
  target.style.fontFamily='Arial, sans-serif';
 }
 // Controls and active content are not part of the saved chart.
 clone.querySelectorAll('[data-export-ignore],script,foreignObject,[role="button"]').forEach(n=>n.remove());
 for(const node of clone.querySelectorAll('image,use')){
  const href=node.getAttribute('href')||node.getAttribute('xlink:href');
  if(href&&!href.startsWith('#')&&!href.startsWith('data:'))throw Error('External chart resources cannot be embedded safely.');
 }
 const box=svg.viewBox.baseVal,rect=svg.getBoundingClientRect(),width=box.width||rect.width,height=box.height||rect.height;
 boundedImageSize(width,height);
 clone.setAttribute('xmlns','http://www.w3.org/2000/svg');clone.setAttribute('width',String(width));clone.setAttribute('height',String(height));
 clone.style.width=width+'px';clone.style.height=height+'px';clone.style.maxWidth='none';clone.style.maxHeight='none';
 return {markup:new XMLSerializer().serializeToString(clone),width,height};
}
