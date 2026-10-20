import {softwareProbe} from './software-probe';

/** Whether a short-lived probe context with these attributes runs on a
 * software renderer. Browsers do not flag a software GL that was selected
 * explicitly, so failIfMajorPerformanceCaveat alone does not refuse it.
 * The probe runs in a worker: creating the first context blocks its thread,
 * for hundreds of milliseconds under SwiftShader and tens on real GPUs. */
export function softwareRenderer(attributes:WebGLContextAttributes):Promise<boolean>{
  return new Promise(resolve=>{
    let worker:Worker|undefined;
    const done=(software:boolean|null)=>{worker?.terminate();resolve(software??softwareProbe(document.createElement('canvas').getContext('webgl',attributes)));};
    try{worker=new Worker(new URL('./software-probe.worker.ts',import.meta.url),{type:'module'});}catch{done(null);return;}
    worker.onmessage=(event:MessageEvent<boolean|null>)=>done(event.data);
    worker.onerror=()=>done(null);
    worker.postMessage(attributes);
  });
}
