/** Optional page-owned recorder. Backgrounds and ordinary visits do no work. */
export type DiagnosticRecorder={
 readonly active:boolean;
 event:(name:string,detail?:unknown)=>void;
 state:(state:Record<string,string>)=>void;
 frame:(cpuMs:number)=>void;
 resetFrames:()=>void;
 gpu:(milliseconds:number)=>void;
 work:(kind:string,waitMs:number,durationMs:number)=>void;
 environment:(values:Record<string,unknown>)=>void;
 test?:()=>boolean;
 cancelTest?:()=>void;
 report:()=>unknown;
};
declare global {interface Window {earthlightDiagnostics?:DiagnosticRecorder;}}
export function diagnostics(){return typeof window==='undefined'?undefined:window.earthlightDiagnostics;}
