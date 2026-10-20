import {createSceneRenderer} from './scene-renderer';
import {sceneLook} from './scene-defaults';
import {SceneCalendar,calendarFrame} from './scene-calendar';
import {SceneClock} from './scene-clock';
import {issFrame,initialSceneSeconds} from './iss-orbit';
import {SceneFocus} from './scene-assets';
import {sceneBufferSize,sceneComposition,focusRenderScale,focusGrainScale,bufferDensity} from './scene-viewport';
import {sceneContext,isWebGL2} from './webgl-context';
import {softwareRenderer} from './software-renderer';
import {SceneFrameClock} from './scene-frame-clock';
import {SceneHostLifecycle} from './scene-host-lifecycle';

/** Passive host for the same renderer. No navigation, panels or input handlers. */
export class EarthlightBackground extends HTMLElement {
  private cleanup?:()=>void;
  connectedCallback(){
    if(this.cleanup)return;
    const canvas=this.querySelector('canvas')!;
    const reduced=matchMedia('(prefers-reduced-motion: reduce)');
    let renderer:ReturnType<typeof createSceneRenderer>|undefined;
    let gl:WebGLRenderingContext|null=null;
    let visible=false,unavailable=false,probed=false,lastAnimationDraw=0,grain=0;
    let probe:Promise<void>|undefined;
    const runtime=new SceneHostLifecycle({running:()=>active()&&!!renderer,frame:now=>tick(now)});
    let scale=.75,focusRadius=6,cssHeight=1,density=1.5;
    const params=new URLSearchParams({texture:'compact',aurora:'0'});
    const seconds=initialSceneSeconds(new URLSearchParams());
    const calendar=new SceneCalendar(new URLSearchParams(),seconds);
    const playback=new SceneClock(seconds,10);
    const focus=new SceneFocus();
    // Whole display refreshes nearest to 24 FPS, like the explorer: 30 FPS at
    // 60 Hz instead of alternating 33 and 50 ms frames, 24 FPS at 120 Hz.
    const clock=new SceneFrameClock(24,true);
    const active=():boolean=>!runtime.disposed&&visible&&!document.hidden&&!reduced.matches&&!runtime.lost;
    const resize=()=>{
      const bounds=canvas.getBoundingClientRect();
      cssHeight=Math.max(1,bounds.height);
      density=bufferDensity(bounds.width,bounds.height,devicePixelRatio,Math.min(.75,scale));
      const size=sceneBufferSize(bounds.width,bounds.height,devicePixelRatio,Math.min(.75,scale)*focusRenderScale(focusRadius,density));
      const changed=canvas.width!==size.width||canvas.height!==size.height;
      if(canvas.width!==size.width)canvas.width=size.width;
      if(canvas.height!==size.height)canvas.height=size.height;
      gl?.viewport(0,0,canvas.width,canvas.height);
      return changed;
    };
    const paint=(now:number)=>{
      const sceneTime=playback.read(now);
      const composition=sceneComposition(scrollY,innerHeight,cssHeight,true);
      const observer=calendarFrame(issFrame(sceneTime+composition.offset,composition.limb,{yaw:0,pitch:0},composition.altitudeLift),calendar.date(sceneTime+composition.offset));
      // Grain cells are buffer pixels; scale with a reduced loading buffer so
      // the noise per CSS area stays that of the settled image.
      const look=focusRadius>0?{...sceneLook,grain:sceneLook.grain*focusGrainScale(focusRadius,density)}:sceneLook;
      return renderer!.render(observer,canvas.width,canvas.height,cssHeight,sceneTime,grain++,look,focusRadius,10);
    };
    // A new buffer size clears the opaque drawing buffer. Repaint before
    // yielding to the compositor, or the cleared buffer shows as a black frame.
    const refit=(now=performance.now())=>{
      if(resize()&&renderer&&active()&&this.hasAttribute('data-ready'))paint(now);
    };
    const tick=(now:number)=>{
      if(!active()||!renderer)return;
      renderer.observeAnimationFrame(now);clock.observe(now);
      if(clock.due(now)&&('surfaceReady' in renderer.state||'galaxyReady' in renderer.state)){
        if(lastAnimationDraw&&focusRadius===0)renderer.observeCadence(now-lastAnimationDraw,now);
        lastAnimationDraw=focusRadius===0?now:0;
        const result=paint(now);
        if(result){
          const wasReady=this.hasAttribute('data-ready');
          this.dataset.ready='';Object.assign(this.dataset,result.state);
          if(!wasReady)playback.setRunning(true,now);
          const nextFocus=focus.value(now,true,renderer.assets.detailProgress);
          const nextScale=Math.min(.75,result.scale);
          const needsResize=nextScale!==scale||focusRenderScale(nextFocus,density)!==focusRenderScale(focusRadius,density);
          scale=nextScale;focusRadius=nextFocus;
          this.dataset.focus=focusRadius<.01?'sharp':'acquiring';
          this.dataset.focusRadius=focusRadius.toFixed(2);
          this.dataset.renderScale=scale.toFixed(2);
          this.dataset.frames=String(grain);
          if(needsResize)refit(now);
        }
      }
    };
    const sync=()=>{
      runtime.stop();
      this.dataset.running=String(active());
      playback.setRunning(active()&&this.hasAttribute('data-ready'),performance.now());
      if(!active())return;
      if(!renderer){
        if(unavailable)return;
        // A decorative scene never runs on software GL (VMs, blocklisted GPUs,
        // headless audits): it would spend seconds of CPU per frame. The poster stays.
        const attributes:WebGLContextAttributes={alpha:false,antialias:false,depth:false,powerPreference:'low-power',failIfMajorPerformanceCaveat:true};
        if(!probed){
          probe??=softwareRenderer(attributes).then(software=>{
            probed=true;
            if(software){unavailable=true;this.dataset.renderApi='unavailable';}
            if(!runtime.disposed)sync();
          });
          return;
        }
        gl=sceneContext(canvas,params,attributes);
        if(!gl){unavailable=true;this.dataset.renderApi='unavailable';return;}
        this.dataset.renderApi=isWebGL2(gl)?'webgl2':'webgl';
        renderer=createSceneRenderer(gl,canvas,params,()=>{
          if(!runtime.disposed&&renderer)Object.assign(this.dataset,renderer.state);
        },{background:true,assetBaseURL:this.dataset.assetBase});
        resize();renderer.load();
      }
      clock.reset(performance.now());lastAnimationDraw=0;renderer.resetCadence();runtime.animate();
    };
    runtime.connect({
      canvas,resizeTargets:[canvas],resize:()=>refit(),sync,
      contextLost:()=>{renderer?.contextLost();delete this.dataset.ready;sync();},
      contextRestored:async()=>!!(await renderer?.contextRestored()),
      restored:()=>{resize();sync();},
    });
    // The canvas is fixed to the viewport and always intersects it. The scene
    // is on screen while the first ancestor that has a box is; past that, the
    // page covers it and drawing would only cost GPU time.
    let host=this.parentElement;
    while(host&&getComputedStyle(host).display==='contents')host=host.parentElement;
    const intersection=new IntersectionObserver(entries=>{visible=entries.some(entry=>entry.isIntersecting);sync();});
    intersection.observe(host??canvas);
    reduced.addEventListener('change',sync);
    this.cleanup=()=>{
      runtime.dispose();intersection.disconnect();
      reduced.removeEventListener('change',sync);
      renderer?.dispose();delete this.dataset.ready;
    };
  }
  disconnectedCallback(){this.cleanup?.();this.cleanup=undefined;}
}
