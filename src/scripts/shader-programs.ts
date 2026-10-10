import {prepareShaderSource} from './webgl-context.ts';

/** Submit a scene's programs together. No program-dependent GL calls belong
 * between add() and wait(); take() transfers a linked program to its owner. */
export class ShaderProgramBatch {
  private shaders=new Map<string,WebGLShader>();
  private programs:{program:WebGLProgram;label:string;shaders:WebGLShader[]}[]=[];
  private owned=new Set<WebGLProgram>();
  private started=false;
  private complete=false;
  private cancelled=false;
  private cancelWait:(()=>void)|null=null;
  readonly parallel:boolean;
  private extension:KHR_parallel_shader_compile|null;
  private gl:WebGLRenderingContext;

  constructor(gl:WebGLRenderingContext){
    this.gl=gl;
    this.extension=gl.getExtension('KHR_parallel_shader_compile');
    this.parallel=!!this.extension;
  }

  add(label:string,vertex:string,fragment:string){
    if(this.started||this.cancelled)throw Error('Shader batch is already closed');
    const gl=this.gl,shaders:WebGLShader[]=[];
    for(const [type,source] of [[gl.VERTEX_SHADER,vertex],[gl.FRAGMENT_SHADER,fragment]] as const){
      const prepared=prepareShaderSource(gl,type,source),key=`${type}:${prepared}`;
      let shader=this.shaders.get(key);
      if(!shader){
        shader=gl.createShader(type)??undefined;
        if(!shader)throw Error(`Cannot allocate ${label} shader`);
        this.shaders.set(key,shader);
        gl.shaderSource(shader,prepared);gl.compileShader(shader);
      }
      shaders.push(shader);
    }
    const program=gl.createProgram();
    if(!program)throw Error(`Cannot allocate ${label} program`);
    this.owned.add(program);
    for(const shader of shaders)gl.attachShader(program,shader);
    this.programs.push({program,label,shaders});
    return program;
  }

  wait(signal:AbortSignal):Promise<void>{
    if(this.started)throw Error('Shader batch was already submitted');
    this.started=true;
    return new Promise((resolve,reject)=>{
      const gl=this.gl;
      let frame=0,settled=false;
      const finish=(error?:unknown)=>{
        if(settled)return;settled=true;
        if(frame)cancelAnimationFrame(frame);
        signal.removeEventListener('abort',abort);this.cancelWait=null;
        if(error)reject(error);else{this.complete=true;resolve();}
      };
      const abort=()=>finish(new DOMException('Shader preparation cancelled','AbortError'));
      const stopped=()=>signal.aborted||this.cancelled||gl.isContextLost();
      this.cancelWait=abort;signal.addEventListener('abort',abort,{once:true});
      if(stopped()){abort();return;}
      // Link only after every shader has been submitted, even without KHR.
      for(const {program} of this.programs)gl.linkProgram(program);
      const check=()=>{
        frame=0;
        if(stopped()){abort();return;}
        try{
          if(this.extension){
            let pending=false;
            for(const {program} of this.programs)if(!gl.getProgramParameter(program,this.extension.COMPLETION_STATUS_KHR))pending=true;
            if(pending){frame=requestAnimationFrame(check);return;}
          }
          // Completion is not success. Query errors only after all programs
          // finish, and shader status only when their program failed to link.
          for(const {program,label,shaders} of this.programs){
            if(!gl.getProgramParameter(program,gl.LINK_STATUS)){
              const details=[gl.getProgramInfoLog(program)];
              for(const shader of shaders)if(!gl.getShaderParameter(shader,gl.COMPILE_STATUS))details.push(gl.getShaderInfoLog(shader));
              throw Error(`${label}: ${details.filter(Boolean).join('\n')||'Cannot link program'}`);
            }
          }
          finish();
        }catch(error){finish(error);}
      };
      // Yield before the first poll so the browser can paint the poster.
      if(this.extension)frame=requestAnimationFrame(check);else check();
    });
  }

  take(program:WebGLProgram){
    if(!this.complete||!this.owned.delete(program))throw Error('Program is not ready or was already claimed');
    return program;
  }

  dispose(){
    this.cancelled=true;this.cancelWait?.();
    for(const program of this.owned)this.gl.deleteProgram(program);
    for(const shader of this.shaders.values())this.gl.deleteShader(shader);
    this.owned.clear();this.shaders.clear();
  }
}
