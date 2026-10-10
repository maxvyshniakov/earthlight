import {modisDemoFragment} from './modis-demo-shader';
type Manifest={extentKm:[number,number];size:number;dates:{date:string;cloudPixels:number;clearPixels:number;unknownPixels:number}[]};
const root=document.querySelector<HTMLElement>('#modis-demo')!;
const canvas=root.querySelector('canvas')!,status=root.querySelector<HTMLElement>('#status')!;
const controls=['date','reconstruction','view','sun','azimuth','low','middle','high','ev','time','diagnostic'];
const input=(id:string)=>root.querySelector<HTMLInputElement|HTMLSelectElement>('#'+id)!;
const value=(id:string)=>Number(input(id).value);
const params=new URLSearchParams(location.search);
for(const id of controls){const el=input(id),v=params.get(id);if(v===null)continue;
 if(el instanceof HTMLSelectElement){if([...el.options].some(o=>o.value===v))el.value=v;}
 else if(el.type==='checkbox')el.checked=v!=='0';
 else if(Number.isFinite(Number(v)))el.value=String(Math.max(Number(el.min),Math.min(Number(el.max),Number(v))));
}
const gl=canvas.getContext('webgl2',{alpha:false,antialias:false,preserveDrawingBuffer:true});
if(!gl){status.textContent='Для этой демки нужен WebGL 2.';root.dataset.error='WebGL 2 unavailable';}
else{
 let manifest:Manifest,program:WebGLProgram|null=null,buffer:WebGLBuffer|null=null,textures:WebGLTexture[]=[];
 let uniforms:Record<string,WebGLUniformLocation|null>={},raf=0,lost=false,disposed=false,playing=false,loading=true,last=0,playTime=0,generation=0,drawCount=0;
 const play=root.querySelector<HTMLButtonElement>('#play')!;
 let images:ImageBitmap[]=[];
 const normalize=(v:number[])=>{const n=Math.hypot(...v);return v.map(x=>x/n);};
 const cross=(a:number[],b:number[])=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
 function save(){const u=new URL(location.href);for(const id of controls){const el=input(id);u.searchParams.set(id,el instanceof HTMLInputElement&&el.type==='checkbox'?String(Number(el.checked)):el.value);}history.replaceState(null,'',u);}
 function labels(){for(const [id,text] of [['sun',value('sun')+'°'],['ev',value('ev')+' EV'],['time',value('time').toFixed(1)+' мин']])root.querySelector('#'+id+'-value')!.textContent=text;
  play.textContent=playing?'Ⅱ Пауза':'▶ Ветер · 60×';play.setAttribute('aria-pressed',String(playing));
 }
 function request(){if(!raf&&!lost&&!disposed&&!document.hidden)raf=requestAnimationFrame(render);}
 function render(now:number){raf=0;if(loading||lost||disposed||document.hidden||!program||textures.length!==4)return;
  if(playing){playTime=Math.min(120,playTime+(last?Math.min(.2,(now-last)/1000):0));input('time').value=String(playTime);if(playTime>=120)playing=false;}last=now;labels();
  const rect=canvas.getBoundingClientRect(),scale=Math.min(devicePixelRatio,1.5,1100/rect.width);canvas.width=Math.max(1,Math.round(rect.width*scale));canvas.height=Math.max(1,Math.round(rect.height*scale));
  gl!.viewport(0,0,canvas.width,canvas.height);gl!.useProgram(program);
  let eye=[0,-420,470],target=[0,60,-1];
  if(input('view').value==='top'){eye=[0,-.01,1950];target=[0,0,0];}
  if(input('view').value==='close'){eye=[60,-170,180];target=[60,90,0];}
  const f=normalize(target.map((x,i)=>x-eye[i])),r=normalize(cross(f,[0,0,1])),up=normalize(cross(r,f));
  gl!.uniform3fv(uniforms.eye,eye);gl!.uniformMatrix3fv(uniforms.basis,false,new Float32Array([...r,...up,...f]));gl!.uniform2f(uniforms.resolution,canvas.width,canvas.height);
  gl!.uniform2fv(uniforms.extent,manifest.extentKm);const e=value('sun')*Math.PI/180,a=value('azimuth')*Math.PI/180;
  gl!.uniform3f(uniforms.sun,Math.cos(e)*Math.cos(a),Math.cos(e)*Math.sin(a),Math.sin(e));gl!.uniform1f(uniforms.exposure,2**value('ev'));
  gl!.uniform3fv(uniforms.layers,['low','middle','high'].map(id=>Number((input(id) as HTMLInputElement).checked)));
  gl!.uniform1f(uniforms.minutes,value('time'));gl!.uniform1f(uniforms.diagnostic,value('diagnostic'));
  for(let i=0;i<4;i++){gl!.activeTexture(gl!.TEXTURE0+i);gl!.bindTexture(gl!.TEXTURE_2D,textures[i]);}
  gl!.drawArrays(gl!.TRIANGLES,0,3);root.dataset.ready='true';root.dataset.drawCount=String(++drawCount);root.dataset.date=input('date').value;
  root.dataset.time=input('time').value;status.textContent=input('date').value+' · Aqua MODIS · '+canvas.width+' × '+canvas.height;
  if(playing)request();
 }
 function upload(){for(const t of textures)gl!.deleteTexture(t);textures=[];
  for(let i=0;i<images.length;i++){const t=gl!.createTexture()!;textures.push(t);gl!.activeTexture(gl!.TEXTURE0+i);gl!.bindTexture(gl!.TEXTURE_2D,t);
   gl!.texImage2D(gl!.TEXTURE_2D,0,gl!.RGBA,gl!.RGBA,gl!.UNSIGNED_BYTE,images[i]);
   gl!.texParameteri(gl!.TEXTURE_2D,gl!.TEXTURE_WRAP_S,gl!.CLAMP_TO_EDGE);gl!.texParameteri(gl!.TEXTURE_2D,gl!.TEXTURE_WRAP_T,gl!.CLAMP_TO_EDGE);
   gl!.texParameteri(gl!.TEXTURE_2D,gl!.TEXTURE_MAG_FILTER,i<3?gl!.LINEAR:gl!.NEAREST);gl!.texParameteri(gl!.TEXTURE_2D,gl!.TEXTURE_MIN_FILTER,i<3?gl!.LINEAR_MIPMAP_LINEAR:gl!.NEAREST);
   if(i<3)gl!.generateMipmap(gl!.TEXTURE_2D);
  }request();
 }
 async function load(){const token=++generation;loading=true;playing=false;last=0;labels();delete root.dataset.ready;status.textContent='Загрузка '+input('date').value+'…';
  const date=input('date').value;
  try{const loaded:ImageBitmap[]=[];
   // Sequential decode ensures a partially failed load can release its bitmaps.
   try{for(const kind of ['low','middle','high','quality']){const suffix=kind!=='quality'&&input('reconstruction').value==='1'?'-reconstructed':'';const r=await fetch(`${root.dataset.assetBase??'/media/orbit/'}modis-demo/${date}-${kind}${suffix}.png`);if(!r.ok)throw Error('HTTP '+r.status);loaded.push(await createImageBitmap(await r.blob(),{imageOrientation:'flipY',premultiplyAlpha:'none',colorSpaceConversion:'none'}));}}
   catch(e){loaded.forEach(i=>i.close());throw e;}
   if(token!==generation||disposed){loaded.forEach(i=>i.close());return;}
   images.forEach(i=>i.close());images=loaded;
   root.querySelector<HTMLImageElement>('#reference')!.src=`${root.dataset.assetBase??'/media/orbit/'}modis-demo/${date}-reference.webp`;
   const d=manifest.dates.find(d=>d.date===date)!;root.querySelector('#coverage')!.textContent=`Облака с парой измерений: ${(d.cloudPixels/manifest.size**2*100).toFixed(1)}%. Ясно по карте доли облачности: ${(d.clearPixels/manifest.size**2*100).toFixed(1)}%. Нет полной пары измерений: ${(d.unknownPixels/manifest.size**2*100).toFixed(1)}%.`;
   delete root.dataset.error;loading=false;if(!lost)upload();
  }catch(e){if(token===generation){root.dataset.error=String(e);status.textContent='Не удалось загрузить карты: '+String(e);}}
 }
 function init(){try{
  program=gl!.createProgram()!;for(const [type,source] of [[gl!.VERTEX_SHADER,'#version 300 es\nin vec2 p;void main(){gl_Position=vec4(p,0.,1.);}'],[gl!.FRAGMENT_SHADER,modisDemoFragment]] as const){
   const shader=gl!.createShader(type)!;gl!.shaderSource(shader,source);gl!.compileShader(shader);if(!gl!.getShaderParameter(shader,gl!.COMPILE_STATUS)){const msg=gl!.getShaderInfoLog(shader);gl!.deleteShader(shader);throw Error(msg??'compile');}gl!.attachShader(program,shader);gl!.deleteShader(shader);
  }gl!.linkProgram(program);if(!gl!.getProgramParameter(program,gl!.LINK_STATUS))throw Error(gl!.getProgramInfoLog(program)??'link');gl!.useProgram(program);
  buffer=gl!.createBuffer();gl!.bindBuffer(gl!.ARRAY_BUFFER,buffer);gl!.bufferData(gl!.ARRAY_BUFFER,new Float32Array([-1,-1,3,-1,-1,3]),gl!.STATIC_DRAW);
  const p=gl!.getAttribLocation(program,'p');gl!.enableVertexAttribArray(p);gl!.vertexAttribPointer(p,2,gl!.FLOAT,false,0,0);
  for(const name of ['resolution','extent','eye','sun','basis','layers','exposure','minutes','diagnostic','lowMap','middleMap','highMap','qualityMap'])uniforms[name]=gl!.getUniformLocation(program,name);
  gl!.uniform1i(uniforms.lowMap,0);gl!.uniform1i(uniforms.middleMap,1);gl!.uniform1i(uniforms.highMap,2);gl!.uniform1i(uniforms.qualityMap,3);lost=false;if(images.length)upload();
 }catch(e){root.dataset.error=String(e);status.textContent='Ошибка рендера: '+String(e);if(program)gl!.deleteProgram(program);program=null;}}
 for(const id of controls)input(id).addEventListener('input',()=>{if(id==='time'){playing=false;last=0;}save();labels();if(id==='date'||id==='reconstruction'){if(manifest)void load();}else request();});
 root.querySelector('#random')!.addEventListener('click',()=>{if(!manifest)return;const dates=manifest.dates.filter(d=>d.date!==input('date').value);input('date').value=dates[Math.floor(Math.random()*dates.length)].date;save();void load();});
 play.addEventListener('click',()=>{playing=!playing;playTime=value('time');last=0;save();labels();request();});
 root.querySelectorAll<HTMLButtonElement>('[data-preset]').forEach(b=>b.addEventListener('click',()=>{input('sun').value=b.dataset.preset==='sunset'?'10':'32';input('view').value=b.dataset.preset==='top'?'top':'oblique';save();request();}));
 document.addEventListener('visibilitychange',()=>{last=0;if(document.hidden){cancelAnimationFrame(raf);raf=0;save();}else request();});
 const resize=new ResizeObserver(request);resize.observe(canvas);
 canvas.addEventListener('webglcontextlost',e=>{e.preventDefault();lost=true;cancelAnimationFrame(raf);raf=0;delete root.dataset.ready;status.textContent='Ожидание восстановления WebGL…';textures=[];});
 canvas.addEventListener('webglcontextrestored',()=>{init();});
 window.addEventListener('pagehide',e=>{cancelAnimationFrame(raf);raf=0;if(!e.persisted){disposed=true;generation++;resize.disconnect();textures.forEach(t=>gl!.deleteTexture(t));images.forEach(i=>i.close());if(program)gl!.deleteProgram(program);if(buffer)gl!.deleteBuffer(buffer);}});
 window.addEventListener('pageshow',e=>{if(e.persisted){last=0;request();}});
 labels();
 fetch(`${root.dataset.assetBase??'/media/orbit/'}modis-demo/manifest.json`).then(r=>{if(!r.ok)throw Error('HTTP '+r.status);return r.json();}).then((m:Manifest)=>{if(disposed)return;manifest=m;init();return load();}).catch(e=>{root.dataset.error=String(e);status.textContent=String(e);});
}
