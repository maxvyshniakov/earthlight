import {createOrbitRenderer} from './orbit-renderer';
import {sceneLook} from './scene-defaults';
import {SceneCalendar,calendarFrame} from './scene-calendar';
import {OrbitPlayback} from './orbit-playback';
import {issFrame,initialOrbitSeconds} from './iss-orbit';
import {SceneFocus} from './scene-assets';
import {sceneBufferSize,sceneComposition,focusRenderScale} from './scene-viewport';
import {sceneContext,isWebGL2} from './webgl-context';

/** Passive host for the same renderer. No navigation, panels or input handlers. */
export class EarthlightBackground extends HTMLElement {
  private cleanup?:()=>void;
  connectedCallback(){
    if(this.cleanup)return;
    const canvas=this.querySelector('canvas')!;
    const reduced=matchMedia('(prefers-reduced-motion: reduce)');
    let renderer:ReturnType<typeof createOrbitRenderer>|undefined;
    let gl:WebGLRenderingContext|null=null;
    let disposed=false,visible=false,lost=false,frame=0,lastDraw=0,lastAnimationDraw=0,grain=0;
    let scale=.75,focusRadius=6,cssHeight=1;
    const params=new URLSearchParams({texture:'compact',aurora:'0'});
    const seconds=initialOrbitSeconds(new URLSearchParams());
    const calendar=new SceneCalendar(new URLSearchParams(),seconds);
    const playback=new OrbitPlayback(seconds,10);
    const focus=new SceneFocus();
    const active=()=>!disposed&&visible&&!document.hidden&&!reduced.matches&&!lost;
    const resize=()=>{
      const bounds=canvas.getBoundingClientRect();
      cssHeight=Math.max(1,bounds.height);
      const size=sceneBufferSize(bounds.width,bounds.height,devicePixelRatio,Math.min(.75,scale)*focusRenderScale(focusRadius));
      if(canvas.width!==size.width)canvas.width=size.width;
      if(canvas.height!==size.height)canvas.height=size.height;
      gl?.viewport(0,0,canvas.width,canvas.height);
    };
    const tick=(now:number)=>{
      frame=0;if(!active()||!renderer)return;
      renderer.observeAnimationFrame(now);
      if(now-lastDraw>=1000/24&&('surfaceReady' in renderer.state||'galaxyReady' in renderer.state)){
        if(lastAnimationDraw&&focusRadius===0)renderer.observeCadence(now-lastAnimationDraw,now);
        lastAnimationDraw=focusRadius===0?now:0;
        const sceneTime=playback.read(now);
        const composition=sceneComposition(scrollY,innerHeight,cssHeight,true);
        const orbit=calendarFrame(issFrame(sceneTime+composition.offset,composition.limb,{yaw:0,pitch:0},composition.altitudeLift),calendar.date(sceneTime+composition.offset));
        const result=renderer.render(orbit,canvas.width,canvas.height,cssHeight,sceneTime,grain++,sceneLook,focusRadius,10);
        if(result){
          const wasReady=this.hasAttribute('data-ready');
          this.dataset.ready='';Object.assign(this.dataset,result.state);
          if(!wasReady)playback.setRunning(true,now);
          const nextFocus=focus.value(now,true,renderer.assets.settled,true);
          const nextScale=Math.min(.75,result.scale);
          const needsResize=nextScale!==scale||focusRenderScale(nextFocus)!==focusRenderScale(focusRadius);
          scale=nextScale;focusRadius=nextFocus;
          this.dataset.focus=focusRadius<.01?'sharp':'acquiring';
          this.dataset.renderScale=scale.toFixed(2);
          this.dataset.frames=String(grain);
          if(needsResize)resize();
        }
        lastDraw=now-(now-lastDraw)%(1000/24);
      }
      frame=requestAnimationFrame(tick);
    };
    const sync=()=>{
      cancelAnimationFrame(frame);frame=0;
      this.dataset.running=String(active());
      playback.setRunning(active()&&this.hasAttribute('data-ready'),performance.now());
      if(!active())return;
      if(!renderer){
        gl=sceneContext(canvas,params,{alpha:false,antialias:false,depth:false,powerPreference:'low-power'});
        if(!gl)return;
        this.dataset.renderApi=isWebGL2(gl)?'webgl2':'webgl';
        renderer=createOrbitRenderer(gl,canvas,params,()=>{
          if(!disposed&&renderer)Object.assign(this.dataset,renderer.state);
        },{background:true,assetBaseURL:this.dataset.assetBase});
        resize();renderer.load();
      }
      lastDraw=0;lastAnimationDraw=0;renderer.resetCadence();frame=requestAnimationFrame(tick);
    };
    const contextLost=(event:Event)=>{
      event.preventDefault();lost=true;renderer?.contextLost();delete this.dataset.ready;sync();
    };
    const contextRestored=async()=>{
      const restored=await renderer?.contextRestored();
      if(disposed)return;
      lost=!restored;resize();sync();
    };
    const intersection=new IntersectionObserver(entries=>{visible=entries.some(entry=>entry.isIntersecting);sync();});
    intersection.observe(canvas);
    const size=new ResizeObserver(resize);size.observe(canvas);
    document.addEventListener('visibilitychange',sync);
    reduced.addEventListener('change',sync);
    canvas.addEventListener('webglcontextlost',contextLost);
    canvas.addEventListener('webglcontextrestored',contextRestored);
    this.cleanup=()=>{
      disposed=true;cancelAnimationFrame(frame);intersection.disconnect();size.disconnect();
      document.removeEventListener('visibilitychange',sync);reduced.removeEventListener('change',sync);
      canvas.removeEventListener('webglcontextlost',contextLost);canvas.removeEventListener('webglcontextrestored',contextRestored);
      renderer?.dispose();delete this.dataset.ready;
    };
  }
  disconnectedCallback(){this.cleanup?.();this.cleanup=undefined;}
}
