// Day pyramid views (docs/lab/day-pyramid-global-2026-10-17.md): paired
// renders with and without `dayDetail=sentinel`, bytes per view, first-detail
// latency and GPU frame time, straight down from the ISS's 420 km. Uses an
// isolated agent-browser session per view; never attaches to the user's tab.
//
//   bun scripts/measure-day-pyramid-views.mjs <base-url> <output-dir> [regions] [lenses] [--frames]
//
// regions: comma-separated names below (default all); lenses: e.g. 4,8,20.
// --modes=bmng captures only the view without detail (for A/B checks).
// --rounds=N repeats every view N times, interleaved, for frame-time pairs.
// --frames adds GPU timer queries (42 frames, median of the last 36), as in
// scripts/benchmark-scene-profiles.mjs. Results go to <output-dir>/views.json:
// deepBytes are the deep tiles' own bytes (what range reads would fetch),
// packBytes what whole packs cost, and firstDetailMs the time from the first
// pack request to the first deep tile drawn.
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
const exec=promisify(execFile);
const [target,output,only,lensList='4,8,20']=process.argv.slice(2).filter(a=>!a.startsWith('--')),out=output&&resolve(output);
// --throttle=<Mbit/s>,<RTT ms> serves the page through a local proxy that
// holds each day-pyramid response for one round trip and paces its body at
// that rate (per request), so first-detail latency reflects a real link.
const throttle=process.argv.find(a=>a.startsWith('--throttle='))?.split('=')[1].split(',').map(Number);
const relay=throttle&&target?proxy(target,...throttle):null,base=relay?.url??target;
function proxy(origin,mbps,rtt){
  const rate=mbps*1e6/8,sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  const server=Bun.serve({port:0,idleTimeout:120,async fetch(request){
    const url=new URL(request.url),response=await fetch(new URL(url.pathname+url.search,origin),{method:request.method,headers:request.headers,body:request.body});
    const headers=new Headers(response.headers);headers.delete('content-encoding');headers.delete('content-length');
    const bytes=new Uint8Array(await response.arrayBuffer());
    if(!url.pathname.includes('/day-pyramid/'))return new Response(bytes,{status:response.status,headers});
    await sleep(rtt);
    const started=performance.now();let at=0;
    return new Response(new ReadableStream({async pull(controller){
      if(at>=bytes.length){controller.close();return;}
      const n=Math.min(16384,bytes.length-at),wait=started+(at+n)/rate*1000-performance.now();
      if(wait>0)await sleep(wait);
      controller.enqueue(bytes.slice(at,at+n));at+=n;
    }}),{status:response.status,headers});
  }});
  return {url:`http://localhost:${server.port}/`,stop:()=>server.stop(true)};
}
if(!base||!output)throw new Error('Usage: measure-day-pyramid-views.mjs <base-url> <output-dir> [regions] [lenses] [--frames]');
const frames=process.argv.includes('--frames');
export const REGIONS={
  alps:{lon:7.66,lat:45.98,label:'Alps, Matterhorn'},
  sahara:{lon:10.1,lat:25.9,label:'Sahara, Tassili n\'Ajjer'},
  amazon:{lon:-60.02,lat:-3.1,label:'Amazon at Manaus'},
  himalaya:{lon:86.71,lat:27.81,label:'Himalaya, Khumbu below Everest'},
  netherlands:{lon:4.9,lat:52.37,label:'Netherlands, Amsterdam'},
  coast:{lon:-122.42,lat:37.77,label:'San Francisco Bay'},
  dateline:{lon:179.95,lat:-16.75,label:'Taveuni across 180°'},
  arctic:{lon:-31,lat:82.9,label:'Peary Land at 83° N'},
  antarctic:{lon:-45.6,lat:-60.6,label:'South Orkney at 60° S'},
  giza:{lon:31.134,lat:29.979,label:'Giza'},
  cairo:{lon:31.24,lat:30.04,label:'Cairo'},
};
const regions=(only&&only!=='all'?only.split(','):Object.keys(REGIONS)).map(name=>({name,...REGIONS[name]}));
const lenses=lensList.split(',').map(Number);
await mkdir(out,{recursive:true});

function url(region,lens,detail){
  const r=Math.PI/180,k=1+420/6371,{lon,lat}=region;
  const position=[Math.cos(lat*r)*Math.cos(lon*r),Math.cos(lat*r)*Math.sin(lon*r),Math.sin(lat*r)].map(v=>(v*k).toFixed(5));
  // Local solar noon on 8 October 2026: the Sun high and the ground lit.
  const epoch=new Date(Date.UTC(2026,9,8,12)-lon/15*3600e3).toISOString().slice(0,19)+'Z';
  const u=new URL('/',base);
  for(const [key,value] of Object.entries({epoch,t:0,flight:'free',position:position.join(','),heading:'0,0,1',elevation:0,roll:0,pitch:-90,motion:0,clouds:'off',lens,quality:'fixed'}))u.searchParams.set(key,String(value));
  if(detail)u.searchParams.set('dayDetail','sentinel');
  return u.href;
}

const results=JSON.parse(await readFile(join(out,'views.json'),'utf8').catch(()=>'[]'));
let sequence=0;
const modes=(process.argv.find(a=>a.startsWith('--modes='))?.split('=')[1]??'bmng,deep').split(',');
const rounds=Number(process.argv.find(a=>a.startsWith('--rounds='))?.split('=')[1]??1);
for(let round=0;round<rounds;round++)for(const region of regions)for(const lens of lenses)for(const detail of modes.map(mode=>mode==='deep')){
  const name=`${region.name}-${lens}x-${detail?'deep':'bmng'}${round?`-r${round}`:''}`;
  if(results.some(r=>r.name===name&&(!frames||r.medianMs)))continue;
  const session=`day-pyramid-${process.pid}-${sequence++}`;
  const run=async(...args)=>(await exec('agent-browser',['--session',session,...args],{maxBuffer:8e6,timeout:120000})).stdout;
  const evaluate=async source=>JSON.parse(await run('eval','--base64',Buffer.from(source).toString('base64')));
  try{
    await run('set','viewport','1280','800');
    await run('open',url(region,lens,detail));
    // Day tiles loaded and faded in, streamed relief loaded, exposure settled.
    const settled=`(()=>{const s=document.querySelector('earthlight-explorer');if(!s||s.dataset.focus!=='sharp'||s.dataset.assetPhase!=='settled'||s.dataset.exposure!=='settled')return false;const d=s.dataset.dayTiles&&JSON.parse(s.dataset.dayTiles),t=s.dataset.terrainTiles&&JSON.parse(s.dataset.terrainTiles);return !!d&&d.pending===0&&d.fading===0&&d.resident>=d.wanted&&(!t||t.pending===0&&t.fineResident>=t.fineWanted);})()`;
    const started=Date.now();
    for(let attempt=0;attempt<6;attempt++){
      try{await run('wait','--fn',settled);break;}catch(error){
        if(attempt<5)continue;
        const state=await evaluate(`(()=>{const s=document.querySelector('earthlight-explorer');return {focus:s?.dataset.focus,phase:s?.dataset.assetPhase,exposure:s?.dataset.exposure,day:s?.dataset.dayTiles,terrain:s?.dataset.terrainTiles&&JSON.parse(s.dataset.terrainTiles)};})()`).catch(()=>({}));
        throw new Error('not settled: '+JSON.stringify({...state,terrain:state.terrain&&{pending:state.terrain.pending,fineResident:state.terrain.fineResident,fineWanted:state.terrain.fineWanted}}));
      }
    }
    // A last selection round after settling, then the state as drawn.
    await new Promise(resolve=>setTimeout(resolve,1500));
    await run('wait','--fn',settled);
    const state=await evaluate(`(()=>{const s=document.querySelector('earthlight-explorer'),packs=performance.getEntriesByType('resource').filter(e=>/\\/day-pyramid\\/\\d\\/\\d+-\\d+\\.pack$/.test(e.name));return {day:JSON.parse(s.dataset.dayTiles),failures:s.dataset.assetFailures,position:s.dataset.cameraPosition,packs:packs.map(e=>({name:e.name.replace(/^.*day-pyramid\\//,''),bytes:e.encodedBodySize,start:Math.round(e.startTime),end:Math.round(e.responseEnd)}))};})()`);
    const firstPack=Math.min(...state.packs.map(pack=>pack.start));
    let timing={};
    if(frames)timing=await evaluate(`(async()=>{
      const sky=document.querySelector('earthlight-explorer'),canvas=sky.querySelector('canvas'),gl=canvas.getContext('webgl');
      const ext=gl.getExtension('EXT_disjoint_timer_query');
      if(!ext)return {timer:'unavailable'};
      const bind=gl.bindFramebuffer,draw=gl.drawArrays,queries=[],costs=[];
      let target=gl.getParameter(gl.FRAMEBUFFER_BINDING),active=null,started=0,disjoint=false;
      gl.bindFramebuffer=function(kind,framebuffer){target=framebuffer;return bind.call(this,kind,framebuffer);};
      gl.drawArrays=function(...args){
        if(!active&&started<42){active=ext.createQueryEXT();ext.beginQueryEXT(ext.TIME_ELAPSED_EXT,active);started++;}
        draw.apply(this,args);
        if(active&&target===null){ext.endQueryEXT(ext.TIME_ELAPSED_EXT);queries.push(active);active=null;}
      };
      const input=sky.querySelector('[data-look=grain]');
      const deadline=performance.now()+30000;
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
      return {medianMs:sorted[Math.floor(sorted.length*.5)],p10Ms:sorted[Math.floor(sorted.length*.1)],p90Ms:sorted[Math.floor(sorted.length*.9)],samples:costs.length,disjoint,width:canvas.width,height:canvas.height};
    })()`);
    // The canvas alone: the HUD hidden for the capture.
    await evaluate(`(()=>{const style=document.createElement('style');style.textContent='earthlight-explorer *{visibility:hidden!important}earthlight-explorer canvas{visibility:visible!important}';document.head.append(style);return true;})()`);
    await new Promise(resolve=>setTimeout(resolve,300));
    await run('screenshot',join(out,`${name}.png`));
    const result={name,round,region:region.name,lens,detail,seconds:(Date.now()-started)/1000,bytes:state.day.bytes,requests:state.day.requests,deepBytes:state.day.deepBytes??0,packBytes:state.day.deepPackBytes??0,packRequests:state.day.deepRequests??0,deep:state.day.deep??0,packs:state.packs,firstDetailMs:state.day.deepFirst&&state.packs.length?state.day.deepFirst-firstPack:null,resident:state.day.resident,failures:state.failures,...timing};
    const index=results.findIndex(r=>r.name===name);if(index>=0)results[index]=result;else results.push(result);
    await writeFile(join(out,'views.json'),JSON.stringify(results,null,1)+'\n');
    console.log(`${name}: ${result.bytes} B day (${result.deep} deep tiles of ${result.deepBytes} B from ${result.packRequests} packs of ${result.packBytes} B${result.firstDetailMs!=null?`, first detail ${result.firstDetailMs} ms after the first pack request`:''})${result.medianMs?`, ${result.medianMs.toFixed(2)} ms GPU`:''}`);
  }catch(error){console.log(`${name}: failed (${String(error.message.startsWith('not settled')?error.message:error.stderr||error.message).trim().split('\n').at(-1)})`);}
  finally{await run('close').catch(()=>{});}
}

// Evidence: per region, centre crops (480 × 300 of 1280 × 800) of each lens,
// BMNG only on the left, with the day pyramid on the right.
if(process.argv.includes('--compose')){
  const sharp=(await import('sharp')).default,W=480,H=300,GAP=4;
  for(const region of regions){
    const rows=[];
    for(const lens of lenses){
      const pair=[join(out,`${region.name}-${lens}x-bmng.png`),join(out,`${region.name}-${lens}x-deep.png`)];
      if(!(await Promise.all(pair.map(f=>readFile(f).then(()=>true,()=>false)))).every(Boolean))continue;
      rows.push(await Promise.all(pair.map(async file=>{const m=await sharp(file).metadata();return sharp(file).extract({left:Math.floor((m.width-W)/2),top:Math.floor((m.height-H)/2),width:W,height:H}).removeAlpha().toBuffer();})));
    }
    if(!rows.length)continue;
    await sharp({create:{width:2*W+GAP,height:rows.length*H+(rows.length-1)*GAP,channels:3,background:'#000'}})
      .composite(rows.flatMap((pair,r)=>pair.map((input,c)=>({input,left:c*(W+GAP),top:r*(H+GAP)})))).jpeg({quality:78,mozjpeg:true}).toFile(join(out,`${region.name}.jpg`));
    console.log(`${region.name}.jpg: ${rows.length} lenses`);
  }
}
relay?.stop();
