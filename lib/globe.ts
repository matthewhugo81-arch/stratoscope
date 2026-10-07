import type {Frame} from './grib';
export type Vec=[number,number,number];
export type Basis={right:Vec;up:Vec;front:Vec};
export const SIZE=760,CENTER=380,RADIUS=310;
const rad=Math.PI/180;
export const temperatureStops=[[43,24,79],[58,52,144],[57,99,197],[61,165,192],[141,205,196],[234,205,127],[236,112,76]];
export const windStops=[[22,43,67],[30,91,121],[42,148,161],[100,195,169],[207,213,123],[238,155,76],[203,70,93]];
export function viewBasis(lat=65,lon=0):Basis{return {right:[Math.cos(lon*rad),0,-Math.sin(lon*rad)],up:[-Math.sin(lat*rad)*Math.sin(lon*rad),Math.cos(lat*rad),-Math.sin(lat*rad)*Math.cos(lon*rad)],front:[Math.cos(lat*rad)*Math.sin(lon*rad),Math.sin(lat*rad),Math.cos(lat*rad)*Math.cos(lon*rad)]}}
const mix=(a:Vec,b:Vec,c:number,s:number):Vec=>[a[0]*c+b[0]*s,a[1]*c+b[1]*s,a[2]*c+b[2]*s];
export function rotateBasis(b:Basis,dx:number,dy:number):Basis{const x=dx*rad,y=dy*rad,right=mix(b.right,b.front,Math.cos(x),Math.sin(x)),front=mix(b.front,b.right,Math.cos(x),-Math.sin(x));return {right,up:mix(b.up,front,Math.cos(y),-Math.sin(y)),front:mix(front,b.up,Math.cos(y),Math.sin(y))}}
const dot=(a:Vec,b:Vec)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
export function projectGlobe(lon:number,lat:number,b:Basis,zoom:number){const p:Vec=[Math.cos(lat*rad)*Math.sin(lon*rad),Math.sin(lat*rad),Math.cos(lat*rad)*Math.cos(lon*rad)];return {x:CENTER+RADIUS*zoom*dot(p,b.right),y:CENTER-RADIUS*zoom*dot(p,b.up),depth:dot(p,b.front)}}
export function inverseGlobe(x:number,y:number,b:Basis,zoom:number){const a=(x-CENTER)/(RADIUS*zoom),c=(CENTER-y)/(RADIUS*zoom),r2=a*a+c*c;if(r2>1)return null;const z=Math.sqrt(1-r2),p:Vec=[a*b.right[0]+c*b.up[0]+z*b.front[0],a*b.right[1]+c*b.up[1]+z*b.front[1],a*b.right[2]+c*b.up[2]+z*b.front[2]];return {lat:Math.asin(Math.max(-1,Math.min(1,p[1])))/rad,lon:Math.atan2(p[0],p[2])/rad,z}}
export function sample(f:Frame,values:number[],lat:number,lon:number){const g=f.grid,x=((lon-g.lon0)/g.dx%g.nx+g.nx)%g.nx,y=Math.max(0,Math.min(g.ny-1,(lat-g.lat0)/g.dy)),i=Math.floor(x),j=Math.floor(y),a=x-i,b=y-j,j2=Math.min(g.ny-1,j+1);return (values[j*g.nx+i]*(1-a)+values[j*g.nx+(i+1)%g.nx]*a)*(1-b)+(values[j2*g.nx+i]*(1-a)+values[j2*g.nx+(i+1)%g.nx]*a)*b;}
export function sampleWind(f:Frame,lat:number,lon:number){return f.wind?sample(f,f.wind,lat,lon):Math.hypot(sample(f,f.u,lat,lon),sample(f,f.v,lat,lon))}
export function color(value:number,wind:boolean,spread=false){const a=Math.max(0,Math.min(5.999,(spread?value/(wind?30:15):wind?value/120:(value+90)/90)*6)),i=Math.floor(a),t=a-i,s=wind||spread?windStops:temperatureStops;return s[i].map((v,c)=>v*(1-t)+s[i+1][c]*t)}
const vertex=`#version 300 es
+in vec2 position;
+void main(){gl_Position=vec4(position,0.,1.);}`.replaceAll('+','');
const fragment=`#version 300 es
precision highp float;
uniform sampler2D data;
uniform mat3 basis;
uniform vec4 grid;
uniform vec2 stepSize;
uniform float zoom;
uniform bool wind;
uniform bool spread;
uniform bool hasData;
uniform bool contours;
out vec4 outColor;
vec4 at(vec2 p){ivec2 size=textureSize(data,0);ivec2 i=ivec2(p);i.x=(i.x%size.x+size.x)%size.x;i.y=clamp(i.y,0,size.y-1);return texelFetch(data,i,0);}
vec4 sampleGrid(float lat,float lon){vec2 q=vec2(mod((lon-grid.w)/stepSize.x,grid.x),clamp((lat-grid.z)/stepSize.y,0.,grid.y-1.));vec2 p=floor(q),f=fract(q);return mix(mix(at(p),at(p+vec2(1,0)),f.x),mix(at(p+vec2(0,1)),at(p+vec2(1,1)),f.x),f.y);}
vec3 palette(float t){vec3 colors[7];if(wind||spread){colors=vec3[7](vec3(22,43,67),vec3(30,91,121),vec3(42,148,161),vec3(100,195,169),vec3(207,213,123),vec3(238,155,76),vec3(203,70,93));}else{colors=vec3[7](vec3(43,24,79),vec3(58,52,144),vec3(57,99,197),vec3(61,165,192),vec3(141,205,196),vec3(234,205,127),vec3(236,112,76));}float a=clamp(t*6.,0.,5.999);int i=int(a);return mix(colors[i],colors[i+1],fract(a))/255.;}
void main(){vec2 p=(gl_FragCoord.xy-vec2(380.))/(310.*zoom);float r=length(p);if(r>1.){float glow=exp(-(r-1.)*65.)*.25;outColor=vec4(vec3(.18,.55,.7),glow);return;}float z=sqrt(max(0.,1.-dot(p,p)));vec3 world=basis*vec3(p,z);float lat=degrees(asin(clamp(world.y,-1.,1.))),lon=degrees(atan(world.x,world.z));vec3 c=vec3(.05,.11,.15);if(lat>=0.&&hasData){vec4 v=sampleGrid(lat,lon);float val=wind?length(v.zw):v.x;c=palette(spread?val/(wind?30.:15.):wind?val/120.:(val+90.)/90.);if(contours){float h=v.y/400.;float distanceToLine=abs(h-floor(h+.5));float width=max(fwidth(h)*.8,.00025);float ink=1.-smoothstep(width*.2,width,distanceToLine);c=mix(c,vec3(.96,.94,.83),ink*.68);}}float light=.72+.28*z;c*=light;outColor=vec4(c,1.);}`;
export function createRenderer(canvas:HTMLCanvasElement){
 const gl=canvas.getContext('webgl2',{alpha:true,premultipliedAlpha:false,antialias:true});if(!gl)return null;
 const shader=(type:number,source:string)=>{const s=gl.createShader(type)!;gl.shaderSource(s,source);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw Error(gl.getShaderInfoLog(s)||'Globe shader failed');return s};
 const program=gl.createProgram()!,vs=shader(gl.VERTEX_SHADER,vertex),fs=shader(gl.FRAGMENT_SHADER,fragment);gl.attachShader(program,vs);gl.attachShader(program,fs);gl.linkProgram(program);if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw Error('Globe shader link failed');gl.useProgram(program);
 const buffer=gl.createBuffer()!;gl.bindBuffer(gl.ARRAY_BUFFER,buffer);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,1,-1,-1,1,-1,1,1,-1,1,1]),gl.STATIC_DRAW);const a=gl.getAttribLocation(program,'position');gl.enableVertexAttribArray(a);gl.vertexAttribPointer(a,2,gl.FLOAT,false,0,0);
 const texture=gl.createTexture()!;gl.bindTexture(gl.TEXTURE_2D,texture);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.NEAREST);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.NEAREST);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA32F,1,1,0,gl.RGBA,gl.FLOAT,new Float32Array(4));
 let loaded:Frame|null=null;const uniform=(name:string)=>gl.getUniformLocation(program,name);
 return {draw(frame:Frame|null,b:Basis,zoom:number,wind:boolean,contours:boolean){gl.useProgram(program);if(frame!==loaded&&frame){const n=frame.grid.nx*frame.grid.ny,values=new Float32Array(n*4);for(let i=0;i<n;i++)values.set([frame.temperature[i],frame.height[i],frame.wind?frame.wind[i]:frame.u[i],frame.wind?0:frame.v[i]],i*4);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA32F,frame.grid.nx,frame.grid.ny,0,gl.RGBA,gl.FLOAT,values);loaded=frame;}gl.viewport(0,0,SIZE,SIZE);gl.uniformMatrix3fv(uniform('basis'),false,new Float32Array([...b.right,...b.up,...b.front]));gl.uniform1f(uniform('zoom'),zoom);gl.uniform1i(uniform('wind'),wind?1:0);gl.uniform1i(uniform('spread'),frame?.ensemble?.view==='spread'?1:0);gl.uniform1i(uniform('hasData'),frame?1:0);gl.uniform1i(uniform('contours'),contours?1:0);if(frame){const g=frame.grid;gl.uniform4f(uniform('grid'),g.nx,g.ny,g.lat0,g.lon0);gl.uniform2f(uniform('stepSize'),g.dx,g.dy);}gl.drawArrays(gl.TRIANGLES,0,6)},dispose(){gl.deleteTexture(texture);gl.deleteBuffer(buffer);gl.deleteProgram(program);gl.deleteShader(vs);gl.deleteShader(fs)}};
}
