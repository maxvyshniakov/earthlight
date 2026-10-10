// Isolated lab GPU cost. No FPS or physical-device claim is inferred from it.
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdir,writeFile} from 'node:fs/promises';
const [base='http://127.0.0.1:4322',out='/tmp/cloud-family-cost',selection='0,1,2,3,4,5']=process.argv.slice(2);
await mkdir(out,{recursive:true});
const exec=promisify(execFile),session=`cloud-cost-${process.pid}`;
const run=async(...args)=>(await exec('rtk',['proxy','agent-browser','--session',session,...args],{maxBuffer:4e6,timeout:90000})).stdout;
const evaluate=async code=>JSON.parse(await run('eval','--base64',Buffer.from(code).toString('base64')));
try{
 await run('set','viewport','1200','1000');await run('open',base+'/cloud-lab/');
 await run('wait','--fn',`document.querySelector('#cloud-lab').dataset.ready==='true'`);
 const result=await evaluate(`(async()=>{
  const gl=document.querySelector('canvas').getContext('webgl'),ext=gl.getExtension('EXT_disjoint_timer_query');
  if(!ext)return {supported:false};
  const info=gl.getExtension('WEBGL_debug_renderer_info');
  const renderer=info?gl.getParameter(info.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER);
  const native=gl.drawArrays.bind(gl),rows=[];
  try{
   for(const family of ${JSON.stringify(selection.split(',').map(Number))}){
    document.querySelector('#family').value=String(family);const samples=[];
    for(let n=0;n<10;n++){
     const q=ext.createQueryEXT();
     try{
      await new Promise(resolve=>{
       gl.drawArrays=(...args)=>{ext.beginQueryEXT(ext.TIME_ELAPSED_EXT,q);native(...args);ext.endQueryEXT(ext.TIME_ELAPSED_EXT);gl.drawArrays=native;resolve();};
       document.querySelector('#family').dispatchEvent(new Event('input'));
      });
      const deadline=performance.now()+10000;
      while(!ext.getQueryObjectEXT(q,ext.QUERY_RESULT_AVAILABLE_EXT)){if(performance.now()>deadline)throw Error('GPU query timeout');await new Promise(r=>setTimeout(r,10));}
      if(gl.getParameter(ext.GPU_DISJOINT_EXT))throw Error('Disjoint GPU query');
      if(n>=2)samples.push(ext.getQueryObjectEXT(q,ext.QUERY_RESULT_EXT)/1e6);
     }finally{ext.deleteQueryEXT(q);}
    }
    const sorted=[...samples].sort((a,b)=>a-b);rows.push({family,samples,medianMs:(sorted[3]+sorted[4])/2,maxMs:sorted.at(-1)});
   }
  }finally{gl.drawArrays=native;}
  return {supported:true,renderer,width:gl.drawingBufferWidth,height:gl.drawingBufferHeight,rows,error:gl.getError(),scope:'Regional prototype, Mac browser; not complete Orbit or phone performance'};
 })()`);
 await writeFile(out+'/results.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
}finally{await run('close');}
