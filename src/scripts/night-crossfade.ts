/** The held night hand-over frame belongs to one host and one fade. The
 * photographic settle policy stays in Explorer; this owns its DOM lifetime. */
export class NightCrossfade {
  private disposed=false;
  private generation=0;
  private timer=0;
  private completion:(()=>void)|null=null;
  constructor(private canvas:HTMLCanvasElement,private timers={
    later:(callback:()=>void,ms:number)=>window.setTimeout(callback,ms),
    cancel:(id:number)=>clearTimeout(id),
  }){}
  private cancelFade(){
    this.generation++;
    if(this.timer)this.timers.cancel(this.timer);
    this.timer=0;
    if(this.completion)this.canvas.removeEventListener('transitionend',this.completion);
    this.completion=null;
  }
  private clear(){
    this.canvas.hidden=true;delete this.canvas.dataset.fading;
    this.canvas.width=this.canvas.height=0;
  }
  /** Call in the rendering task while its drawing buffer still holds the frame. */
  hold(source:HTMLCanvasElement){
    if(this.disposed)return;
    this.cancelFade();
    this.canvas.width=source.width;this.canvas.height=source.height;
    this.canvas.getContext('2d',{alpha:false})?.drawImage(source,0,0);
    delete this.canvas.dataset.fading;this.canvas.hidden=false;
  }
  release(reducedMotion:boolean){
    if(this.disposed||this.canvas.hidden)return;
    this.cancelFade();
    if(reducedMotion){this.clear();return;}
    const generation=this.generation;
    const done=()=>{
      if(this.disposed||generation!==this.generation)return;
      this.cancelFade();this.clear();
    };
    this.completion=done;
    this.canvas.dataset.fading='';
    this.canvas.addEventListener('transitionend',done,{once:true});
    // The CSS dissolve is .45 s; this retains its existing 800 ms fallback.
    this.timer=this.timers.later(done,800);
  }
  dispose(){
    if(this.disposed)return;
    this.disposed=true;this.cancelFade();this.clear();
  }
}
