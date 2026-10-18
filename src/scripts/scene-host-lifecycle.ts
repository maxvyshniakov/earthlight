/** Browser resources owned by one scene host. Photographic policy (cadence,
 * focus, exposure and whether playback is wanted) stays with that host. */
export type SceneHostEnvironment={
  request:(callback:FrameRequestCallback)=>number;
  cancel:(handle:number)=>void;
  hidden:()=>boolean;
};
export type SceneHostPolicy={
  running:()=>boolean;
  drawing?:()=>boolean;
  frame:(now:number)=>void;
  /** false means the host's submission clock is not due yet. */
  draw?:(now:number)=>boolean|void;
};
export type SceneHostBindings={
  canvas:HTMLCanvasElement;
  resizeTargets:Element[];
  resize:()=>void;
  sync:()=>void;
  contextLost:()=>void;
  contextRestored:()=>Promise<boolean>;
  restored:(ready:boolean)=>void;
  document?:Document;
};
export class SceneHostLifecycle {
  disposed=false;
  lost=false;
  private generation=0;
  private animation=0;
  private invalidation=0;
  private cleanups:(()=>void)[]=[];
  constructor(private policy:SceneHostPolicy,private environment:SceneHostEnvironment={
    request:callback=>requestAnimationFrame(callback),cancel:handle=>cancelAnimationFrame(handle),hidden:()=>document.hidden,
  }){}
  private available(){return !this.disposed&&!this.lost&&!this.environment.hidden();}
  private tick=(now:number)=>{
    this.animation=0;
    if(!this.available()||!this.policy.running())return;
    this.policy.frame(now);
    // A frame may synchronously resync or dispose its host. Never leave two
    // RAF chains after first light, a resize, or a play/pause transition.
    this.animate();
  };
  animate(){
    if(!this.animation&&this.available()&&this.policy.running())this.animation=this.environment.request(this.tick);
  }
  private flush=(now:number)=>{
    this.invalidation=0;
    if(!this.available()||!this.policy.drawing?.())return;
    if(this.policy.draw?.(now)===false)this.invalidate();
  };
  invalidate(){
    if(!this.invalidation&&this.available()&&this.policy.drawing?.())this.invalidation=this.environment.request(this.flush);
  }
  /** Cancel both submission paths before the host resets its clocks. */
  stop(){
    this.environment.cancel(this.animation);this.environment.cancel(this.invalidation);
    this.animation=this.invalidation=0;
  }
  loseContext(){this.generation++;this.lost=true;this.stop();}
  /** A new loss or disposal invalidates an outstanding asynchronous restore. */
  async restoreContext(restore:()=>Promise<boolean>,settled:(ready:boolean)=>void){
    if(this.disposed)return;
    const generation=++this.generation;
    const ready=await restore();
    if(this.disposed||generation!==this.generation)return;
    this.lost=!ready;settled(ready);
  }
  connect(bindings:SceneHostBindings){
    const doc=bindings.document??document;
    const lost=(event:Event)=>{event.preventDefault();this.loseContext();bindings.contextLost();};
    const restored=()=>{void this.restoreContext(bindings.contextRestored,bindings.restored);};
    const visibility=()=>{this.stop();bindings.sync();};
    const size=new ResizeObserver(()=>{if(!this.disposed)bindings.resize();});
    bindings.resizeTargets.forEach(target=>size.observe(target));
    doc.addEventListener('visibilitychange',visibility);
    bindings.canvas.addEventListener('webglcontextlost',lost);
    bindings.canvas.addEventListener('webglcontextrestored',restored);
    this.cleanups.push(()=>{
      size.disconnect();doc.removeEventListener('visibilitychange',visibility);
      bindings.canvas.removeEventListener('webglcontextlost',lost);
      bindings.canvas.removeEventListener('webglcontextrestored',restored);
    });
  }
  dispose(){
    if(this.disposed)return;
    this.disposed=true;this.generation++;this.stop();
    this.cleanups.splice(0).forEach(cleanup=>cleanup());
  }
}
