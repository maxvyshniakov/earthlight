// Hardware GPU queries in an isolated browser; no synchronous GPU waits.
// bun run benchmark:scene http://127.0.0.1:4347 /tmp/earthlight-profiles
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdir,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import {sceneProfiles} from '../src/scripts/scene-profile.ts';
const exec=promisify(execFile);
const [base='http://127.0.0.1:4347',out='/tmp/earthlight-profiles',only,selected='reference,compact,split,lighting']=process.argv.slice(2);
const profiles=selected.split(',');
assert.equal(profiles[0],'reference','Start with reference for matching camera and image checks');
assert.ok(profiles.every(name=>Object.hasOwn(sceneProfiles,name)),'Unknown render profile');
await mkdir(out,{recursive:true});
let sequence=0,session=`earthlight-profiles-${process.pid}`;
const run=async(...args)=>(await exec('agent-browser',['--session',session,...args],{maxBuffer:8e6,timeout:90000})).stdout;
const evaluate=async source=>JSON.parse(await run('eval','--base64',Buffer.from(source).toString('base64')));
const cases=[{name:'day',t:3235.65},{name:'night',t:610.87},{name:'horizon',t:3235.65,pitch:5},{name:'clouds',t:3235.65,pitch:-25},{name:'moon',t:1338.89},{name:'high',t:3235.65,orbit:'high'}].filter(scene=>!only||only==='all'||only.split(',').includes(scene.name));
assert.ok(cases.length,'Unknown scene name');
const results=[];
let browserOpen=false;
try {
  for(const scene of cases)for(const profile of profiles){
    session=`earthlight-profiles-${process.pid}-${sequence++}`;browserOpen=true;
    const url=new URL('/',base);
    for(const [key,value] of Object.entries({epoch:'2026-10-06T01:32:27Z',t:scene.t,orbit:scene.orbit??'iss',pitch:scene.pitch??0,motion:0,quality:'fixed',compare:1,render:profile}))url.searchParams.set(key,String(value));
    await run('open',url.href);
    await run('set','viewport','1440','900');
    const settled=`(()=>{const s=document.querySelector('earthlight-explorer');return s?.dataset.focus==='sharp'&&s.dataset.assetPhase==='settled'&&s.dataset.exposure==='settled'&&['dayTiles','nightTiles','cloudTiles'].every(k=>!s.dataset[k]||JSON.parse(s.dataset[k]).pending===0)})()`;
    // Cold browser runs may finish tile uploads near the CLI's 25 s limit;
    // metering needs another seven seconds after the last upload.
    try{await run('wait','--fn',settled);}catch(error){
      if(!String(error.stderr).includes('Wait timed out'))throw error;
      await run('wait','--fn',settled);
    }
    const result=await evaluate(`(async()=>{
      const sky=document.querySelector('earthlight-explorer'),canvas=sky.querySelector('canvas'),gl=canvas.getContext('webgl');
      const ext=gl.getExtension('EXT_disjoint_timer_query');
      if(!ext)throw Error('GPU timer queries unavailable; do not substitute CPU submission times');
      const debug=gl.getExtension('WEBGL_debug_renderer_info');
      const renderer=debug?gl.getParameter(debug.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER);
      const bind=gl.bindFramebuffer,draw=gl.drawArrays,queries=[],costs=[];
      let target=gl.getParameter(gl.FRAMEBUFFER_BINDING),active=null,started=0,disjoint=false;
      gl.bindFramebuffer=function(kind,framebuffer){target=framebuffer;return bind.call(this,kind,framebuffer);};
      gl.drawArrays=function(...args){
        if(!active&&started<42){active=ext.createQueryEXT();ext.beginQueryEXT(ext.TIME_ELAPSED_EXT,active);started++;}
        draw.apply(this,args);
        if(active&&target===null){ext.endQueryEXT(ext.TIME_ELAPSED_EXT);queries.push(active);active=null;}
      };
      const input=sky.querySelector('[data-look=grain]');
      const deadline=performance.now()+20000;
      try{
        while(costs.length<42&&performance.now()<deadline){
          if(gl.getParameter(ext.GPU_DISJOINT_EXT)){disjoint=true;break;}
          for(let i=queries.length-1;i>=0;i--)if(ext.getQueryObjectEXT(queries[i],ext.QUERY_RESULT_AVAILABLE_EXT)){
            costs.push(Number(ext.getQueryObjectEXT(queries[i],ext.QUERY_RESULT_EXT))/1e6);
            ext.deleteQueryEXT(queries[i]);queries.splice(i,1);
          }
          input.dispatchEvent(new Event('input'));
          await new Promise(resolve=>setTimeout(resolve,65));
        }
      }finally{
        gl.bindFramebuffer=bind;gl.drawArrays=draw;
        if(active){ext.endQueryEXT(ext.TIME_ELAPSED_EXT);ext.deleteQueryEXT(active);}
        for(const query of queries)ext.deleteQueryEXT(query);
      }
      const sorted=costs.slice(6).sort((a,b)=>a-b);
      return {renderer,profile:sky.dataset.renderProfile,width:canvas.width,height:canvas.height,
        medianMs:sorted[Math.floor(sorted.length*.5)],p90Ms:sorted[Math.floor(sorted.length*.9)],samples:costs.length,disjoint,
        error:gl.getError(),assetFailures:sky.dataset.assetFailures,position:sky.dataset.cameraPosition,basis:sky.dataset.cameraBasis,atmosphereTable:sky.dataset.atmosphereTable,volumePass:sky.dataset.volumePass};
    })()`);
    assert.equal(result.profile,profile);assert.equal(result.error,0);assert.equal(result.disjoint,false);assert.equal(result.samples,42);assert.equal(result.assetFailures,'0');
    if(profile!=='reference'){
      const reference=results.find(r=>r.scene===scene.name&&r.profile==='reference');
      assert.equal(result.position,reference.position);assert.equal(result.basis,reference.basis);
      if(sceneProfiles[profile].scale===1){assert.equal(result.width,reference.width);assert.equal(result.height,reference.height);}
    }
    await run('screenshot',`${out}/${scene.name}-${profile}.png`);
    if(['lighting','split','compact'].includes(profile)){
      const before=await sharp(`${out}/${scene.name}-reference.png`).removeAlpha().raw().toBuffer({resolveWithObject:true});
      const comparison=await sharp(`${out}/${scene.name}-${profile}.png`).removeAlpha().raw().toBuffer({resolveWithObject:true});
      assert.equal(comparison.info.width,before.info.width);assert.equal(comparison.info.height,before.info.height);
      const after=comparison.data;
      let sum=0,max=0,count=0,overTwo=0;
      for(let i=0;i<after.length;i++){
        const pixel=Math.floor(i/3),x=pixel%before.info.width,y=Math.floor(pixel/before.info.width);
        if(x>before.info.width-350&&y<170)continue; // Different comparison labels.
        const delta=Math.abs(before.data[i]-after[i]);sum+=delta;max=Math.max(max,delta);count++;if(delta>2)overTwo++;
      }
      result.imageDifference={mean:sum/count,max,overTwoFraction:overTwo/count};
      // Same sampling budgets and frame: allow float-projection rounding,
      // reject broad image changes or changed optical response.
      assert.ok(result.imageDifference.mean<8,'Candidate changed too much of the image: '+JSON.stringify(result.imageDifference));
    }
    results.push({scene:scene.name,...result});
    await writeFile(`${out}/results.json`,JSON.stringify(results,null,2)+'\n');
    console.log(`${scene.name} / ${profile}: ${result.medianMs.toFixed(2)} ms GPU (p90 ${result.p90Ms.toFixed(2)}), ${result.width}×${result.height}`);
    await run('close');browserOpen=false; // Release contexts and textures between candidates.
  }
} finally {if(browserOpen)await run('close');}
