import {cloudFamilies} from './cloud-families';
import {cloudLabFragment} from './cloud-lab-shader';

const root=document.querySelector<HTMLElement>('#cloud-lab');
if(root){
 const canvas=root.querySelector('canvas')!;
 const status=root.querySelector<HTMLElement>('#status')!;
 const control=(id:string)=>root.querySelector<HTMLInputElement|HTMLSelectElement>('#'+id)!;
 const params=new URLSearchParams(location.search);
 const limits:Record<string,[number,number,number]>={family:[0,5,0],cells:[0,1,0],sun:[6,80,25],time:[0,180,0],seed:[0,999,7],ev:[-2,2,0],diagnostic:[0,1,0]};
 for(const [key,[min,max,fallback]] of Object.entries(limits)){
  const raw=params.get(key),value=raw===null?fallback:Number(raw);
  control(key).value=String(Number.isFinite(value)?Math.max(min,Math.min(max,['family','cells','seed','diagnostic'].includes(key)?Math.round(value):value)):fallback);
 }
 for(const key of ['view','azimuth'])if([...((control(key) as HTMLSelectElement).options)].some(o=>o.value===params.get(key)))control(key).value=params.get(key)!;
 const gl=canvas.getContext('webgl',{alpha:false,antialias:false,preserveDrawingBuffer:true});
 if(!gl){status.textContent='WebGL недоступен: сцена не запущена.';}
 else{
  let program:WebGLProgram|null=null,buffer:WebGLBuffer|null=null;
  let uniforms:Record<string,WebGLUniformLocation|null>={};
  let frame=0,playing=false,last=0,lost=false,drawCount=0,playTime=0;
  const button=root.querySelector<HTMLButtonElement>('#play')!;
  const value=(key:string)=>Number(control(key).value);
  const normalize=(v:number[])=>{const n=Math.hypot(...v);return v.map(x=>x/n);};
  const cross=(a:number[],b:number[])=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
  function save(){const url=new URL(location.href);for(const key of [...Object.keys(limits),'view','azimuth'])url.searchParams.set(key,control(key).value);history.replaceState(null,'',url);}
  function labels(){
   const family=Math.round(value('family'));
   root!.querySelector('#description')!.textContent=cloudFamilies[family].description;
   const references=[
    'https://science.nasa.gov/earth/earth-observatory/at-the-intersection-of-coastal-peru-and-a-cloud-bank-86032/',
    'https://science.nasa.gov/earth/earth-observatory/open-and-closed-cells-over-the-pacific-87456/',
    'https://science.nasa.gov/earth/earth-observatory/sunglint-and-clouds-off-western-south-america-78107/',
    'https://cloudatlas.wmo.int/en/observation-of-clouds-from-aircraft-descriptions-nimbostratus.html',
    'https://science.nasa.gov/earth/earth-observatory/cloudscape-at-dawn-northwest-atlantic-149490/',
    'https://science.nasa.gov/earth/earth-observatory/cirrus-clouds-off-the-coast-of-chile-85943/',
   ];
   root!.querySelector<HTMLAnchorElement>('#reference')!.href=references[family];
   (root!.querySelector('#cell-control') as HTMLElement).hidden=family!==1;
   root!.querySelector('#sun-value')!.textContent=value('sun')+'°';
   root!.querySelector('#time-value')!.textContent=value('time').toFixed(1)+' мин';
   root!.querySelector('#ev-value')!.textContent=(value('ev')>0?'+':'')+value('ev')+' EV';
   button.textContent=playing?'Ⅱ Пауза':'▶ Развитие · 60×';button.setAttribute('aria-pressed',String(playing));
  }
  function render(now:number){
   frame=0;if(lost||document.hidden||!program)return;
   if(playing){playTime=Math.min(180,playTime+(last?Math.min(.25,(now-last)/1000):0));control('time').value=String(playTime);if(value('time')>=180)playing=false;}
   last=now;labels();
   const rect=canvas.getBoundingClientRect(),scale=Math.min(devicePixelRatio,1.5,1000/rect.width);
   const width=Math.max(1,Math.round(rect.width*scale)),height=Math.max(1,Math.round(rect.height*scale));
   if(canvas.width!==width||canvas.height!==height){canvas.width=width;canvas.height=height;}
   gl!.viewport(0,0,width,height);gl!.useProgram(program);
   let eye=[0,-175,150],target=[0,0,2.];
   if(control('view').value==='top'){eye=[0,-.01,150];target=[0,0,0];}
   if(control('view').value==='limb'){eye=[0,-650,Math.sqrt((6371+150)**2-650**2)-6371];target=[0,140,4];}
   const forward=normalize(target.map((x,i)=>x-eye[i]));
   const right=normalize(cross(forward,[0,0,1]));const up=normalize(cross(right,forward));
   gl!.uniformMatrix3fv(uniforms.basis,false,new Float32Array([...right,...up,...forward]));
   gl!.uniform3fv(uniforms.eye,eye);gl!.uniform2f(uniforms.resolution,width,height);
   const elevation=value('sun')*Math.PI/180,azimuth=value('azimuth')*Math.PI/180;
   gl!.uniform3fv(uniforms.sun,[Math.cos(elevation)*Math.cos(azimuth),Math.cos(elevation)*Math.sin(azimuth),Math.sin(elevation)]);
   for(const [uniform,id] of [['family','family'],['minutes','time'],['weatherSeed','seed'],['openCells','cells'],['diagnostic','diagnostic']])gl!.uniform1f(uniforms[uniform],value(id));
   gl!.uniform1f(uniforms.exposure,2**value('ev'));
   gl!.drawArrays(gl!.TRIANGLES,0,3);
   root!.dataset.ready='true';root!.dataset.drawCount=String(++drawCount);root!.dataset.time=String(value('time'));
   status.textContent=cloudFamilies[value('family')].name+' · '+width+' × '+height+' · фиксированная экспозиция';
   if(playing)request();
  }
  function request(){if(!frame&&!lost&&!document.hidden)frame=requestAnimationFrame(render);}
  function init(){
   try{
    program=gl!.createProgram();if(!program)throw Error('Не удалось создать программу WebGL');
    for(const [type,source] of [[gl!.VERTEX_SHADER,'attribute vec2 p;void main(){gl_Position=vec4(p,0.,1.);}'],[gl!.FRAGMENT_SHADER,cloudLabFragment]] as const){
     const shader=gl!.createShader(type)!;gl!.shaderSource(shader,source);gl!.compileShader(shader);
     if(!gl!.getShaderParameter(shader,gl!.COMPILE_STATUS)){const message=gl!.getShaderInfoLog(shader);gl!.deleteShader(shader);throw Error(message??'Shader compilation failed');}
     gl!.attachShader(program,shader);gl!.deleteShader(shader);
    }
    gl!.linkProgram(program);if(!gl!.getProgramParameter(program,gl!.LINK_STATUS))throw Error(gl!.getProgramInfoLog(program)??'Shader link failed');
    gl!.useProgram(program);buffer=gl!.createBuffer();gl!.bindBuffer(gl!.ARRAY_BUFFER,buffer);gl!.bufferData(gl!.ARRAY_BUFFER,new Float32Array([-1,-1,3,-1,-1,3]),gl!.STATIC_DRAW);
    const pos=gl!.getAttribLocation(program,'p');gl!.enableVertexAttribArray(pos);gl!.vertexAttribPointer(pos,2,gl!.FLOAT,false,0,0);
    uniforms={};for(const name of ['resolution','eye','basis','sun','family','minutes','weatherSeed','openCells','exposure','diagnostic'])uniforms[name]=gl!.getUniformLocation(program,name);
    lost=false;request();
   }catch(error){status.textContent='Ошибка рендера: '+String(error);root!.dataset.error=String(error);if(program)gl!.deleteProgram(program);program=null;}
  }
  for(const key of [...Object.keys(limits),'view','azimuth'])control(key).addEventListener('input',()=>{
   if(key==='seed')control(key).value=String(Math.max(0,Math.min(999,Math.round(value(key)||0))));
   if(key==='time'){playing=false;last=0;}
   save();labels();request();
  });
  button.addEventListener('click',()=>{playing=!playing;playTime=value('time');last=0;save();labels();request();});
  root.querySelector('#reset-time')!.addEventListener('click',()=>{playing=false;control('time').value='0';last=0;save();labels();request();});
  root.querySelector('#share')!.addEventListener('click',async()=>{
   playing=false;save();labels();request();
   const result=root!.querySelector('#share-status')!;
   try{await navigator.clipboard.writeText(location.href);result.textContent='Ссылка скопирована.';}
   catch{result.textContent='Скопируйте текущий адрес из строки браузера.';}
  });
  document.addEventListener('visibilitychange',()=>{last=0;if(document.hidden){cancelAnimationFrame(frame);frame=0;}else request();});
  canvas.addEventListener('webglcontextlost',e=>{e.preventDefault();lost=true;cancelAnimationFrame(frame);frame=0;delete root!.dataset.ready;status.textContent='Контекст WebGL потерян. Ожидание восстановления…';});
  canvas.addEventListener('webglcontextrestored',()=>{last=0;init();});
  new ResizeObserver(request).observe(canvas);
  window.addEventListener('pagehide',event=>{cancelAnimationFrame(frame);frame=0;if(!event.persisted){if(buffer)gl!.deleteBuffer(buffer);if(program)gl!.deleteProgram(program);}});
  window.addEventListener('pageshow',event=>{if(event.persisted){last=0;request();}});
  labels();init();
 }
}
