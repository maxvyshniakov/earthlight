import {softwareProbe} from './software-probe';

// No context answers null: the browser may lack WebGL in workers, so the
// page probes itself. A context refused for its caveat is refused there too.
self.onmessage=(event:MessageEvent<WebGLContextAttributes>)=>{
  let probe:WebGLRenderingContext|null;
  try{probe=new OffscreenCanvas(1,1).getContext('webgl',event.data);}catch{self.postMessage(null);return;}
  self.postMessage(probe?softwareProbe(probe):null);
};
