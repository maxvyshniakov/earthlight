// Renders the physical-night lab views (docs/lab/physical-night-2026-10-17.md,
// docs/lab/night-camera-2026-10-17.md) in an isolated agent-browser session:
// each view with night=current, video and still. Saves screenshots and prints
// the metered EV, EV100, the camera settings for the view's focal length, the
// scene radiance quantiles and the grain's SNR. Frames are for review, not
// for the repository.
// bun scripts/night-views.mjs http://127.0.0.1:4321 /tmp/night-views [view ...] [--modes=video,still] [--unbinned]
//
// SNR: each view is opened a second time at the metered EV in manual exposure
// with look-grain=0. Over the central crop (no HUD), the green channel's
// linear difference between the two frames is the grain; SNR is the mean over
// its standard deviation for pixels whose clean value lies within ±0.5 stop
// of metered mid-grey (0.055), or of the crop's median when too few are there.
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import sharp from 'sharp';
import {cameraProgramFor,NIGHT_EXPOSURE_MAX_EV,EXPOSURE_MIN_EV} from '../src/scripts/camera-model.ts';
import {grainSnr as modelSnr} from '../src/scripts/sensor-noise.ts';
import {SCENE_CANDELA} from '../src/scripts/radiometry.ts';
import {equatorialFrame} from '../src/scripts/celestial-sky.ts';

const exec=promisify(execFile);
const args=process.argv.slice(2),flags=args.filter(a=>a.startsWith('--')),positional=args.filter(a=>!a.startsWith('--'));
const [base='http://127.0.0.1:4321',out=join(tmpdir(),'night-views'),...only]=positional;
// --unbinned: model SNR of the grain before photosite binning (older builds).
const unbinned=flags.includes('--unbinned');
const modes=(flags.find(f=>f.startsWith('--modes='))?.slice(8)??'current,video,still').split(',');
await mkdir(out,{recursive:true});
const session=`night-${process.pid}`;
const ab=async(...args)=>(await exec('agent-browser',['--session',session,...args],{maxBuffer:3e7,timeout:240000})).stdout;

// The radiance ledger's scene-buffer hook, plus the exposure state it writes.
// Lab modes pre-expose the scene buffer; the ledger divides that out.
const ledger=await readFile(new URL('./radiance-ledger.mjs',import.meta.url),'utf8');
const hook=ledger.slice(ledger.indexOf('const hook=`')+12,ledger.indexOf('})();`;')+5)
 .replace('if(fb&&small.has(fb)){','if(fb&&small.has(fb)){window.__state={gl:this,fb};')
 +`;window.__ev=()=>{const s=window.__state;if(!s)return null;const gl=s.gl,p=gl.getParameter(gl.FRAMEBUFFER_BINDING);gl.bindFramebuffer(gl.FRAMEBUFFER,s.fb);const v=new Uint8Array(4);gl.readPixels(0,0,1,1,gl.RGBA,gl.UNSIGNED_BYTE,v);gl.bindFramebuffer(gl.FRAMEBUFFER,p);return (v[0]*256+v[1])/65535;};`;
const hookPath=join(out,'night-hook.js');
await writeFile(hookPath,hook);

const r=1+420/6371;
const unit=v=>{const l=Math.hypot(...v);return v.map(x=>x/l);};
const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const fmt=v=>v.map(x=>x.toFixed(4)).join('%2C');
const ll=(lat,lon)=>{const a=lat*Math.PI/180,b=lon*Math.PI/180;return [Math.cos(a)*Math.cos(b),Math.cos(a)*Math.sin(b),Math.sin(a)];};
// Free flight at ISS altitude over p; heading 'east', 'west' or 'south'.
function view(date,p,elevation,heading='east',extra=''){
 const east=unit(cross([0,0,1],p)),south=unit(cross(east,p));
 const t=4752.76,epoch=new Date(Date.parse(date)-t*1000).toISOString();
 return `t=${t}&epoch=${encodeURIComponent(epoch)}&motion=0&flight=free&position=${fmt(p.map(x=>x*r))}&heading=${fmt(heading==='east'?east:heading==='west'?east.map(x=>-x):south)}&elevation=${elevation}${extra}`;
}
// Full Moon 2026-10-26 04:12 UTC: the Moon stands near the zenith of the
// antisolar point. The same view a full lunation earlier is moonless.
const full='2026-10-26T04:12:00Z',fresh='2026-10-10T04:12:00Z';
const anti=equatorialFrame(new Date(full)).sun.map(x=>-x);
// Dubai as ISS030-E-99324 (2012-02-22 19:24 UTC, a day after new Moon,
// 400 mm f/2.8 1/40 s ISO 8 000, EV100 +2.0).
const dubai='2012-02-22T19:24:00Z',dubaiAt=ll(25.2,55.27);
const views=[
 {id:'full-moon',url:view(full,anti,-1.45)},
 {id:'quarter-moon',url:view('2026-10-18T22:00:00Z',ll(5,-20),-1.45)},
 {id:'new-moon',url:view(fresh,anti,-1.45)},
 {id:'city-1x',url:view(dubai,dubaiAt,-1.45),focal:1.25},
 {id:'city-8x',url:view(dubai,dubaiAt,-1.45,'east','&lens=8'),focal:10},
 // ISS030-E-7397: night limb with airglow and stars, looking west over the
 // N Pacific near 41.5° N 179.9° W, 2011-11-24 15:36 UTC (a day before new
 // Moon), 20 mm f/3.2 1.3 s ISO 12 800, EV100 −4.0.
 {id:'limb',url:view('2011-11-24T15:36:00Z',ll(41.5,-179.9),-.33,'west','&lens=0.667'),focal:1.25*.667},
 // ISS030-E-10008: Iberia at night, 2011-12-04 00:13 UTC, 24 mm, oblique.
 {id:'iberia',url:view('2011-12-04T00:13:00Z',ll(46,-3),-.75,'south')},
 // The ledger's daylit nadir: exposure must not change.
 {id:'day',url:'t=4752.76&epoch=2026-10-16T07%3A57%3A47.730Z&motion=0&flight=free&position=0.9055%2C0.6860%2C-0.1790&heading=0.6039%2C-0.7971%2C0&elevation=-1.45'},
].filter(v=>!only.length||only.includes(v.id));
const settled="document.querySelector('earthlight-explorer')?.dataset.assets==='settled'&&document.querySelector('earthlight-explorer')?.dataset.focus==='sharp'";
const open=async url=>{await ab('open',url);await ab('wait','--fn',settled);await ab('wait','12000');};

// Green channel, linear, over the central crop that the HUD leaves free.
async function greenLinear(file){
 const {data,info}=await sharp(file).raw().toBuffer({resolveWithObject:true});
 const x0=Math.round(info.width*.2),x1=Math.round(info.width*.8),y0=Math.round(info.height*.15),y1=Math.round(info.height*.8);
 const values=new Float64Array((x1-x0)*(y1-y0));let k=0;
 for(let y=y0;y<y1;y++)for(let x=x0;x<x1;x++){const v=data[(y*info.width+x)*info.channels+1]/255;values[k++]=v<=.04045?v/12.92:((v+.055)/1.055)**2.4;}
 return values;
}
function grainSnr(grain,clean){
 const sorted=Float64Array.from(clean).sort(),median=sorted[sorted.length>>1];
 let level=.055,count=0;
 const pick=at=>{const lo=at/2**.5,hi=at*2**.5;let n=0,sum=0,sq=0,dsum=0;for(let i=0;i<clean.length;i++)if(clean[i]>=lo&&clean[i]<=hi){const d=grain[i]-clean[i];n++;sum+=clean[i];dsum+=d;sq+=d*d;}return {n,mean:sum/n,sigma:Math.sqrt(Math.max(0,sq/n-(dsum/n)**2))};};
 let s=pick(level);count=s.n;
 if(count<2000&&median>2/255){level=median;s=pick(level);}
 return s.n<500?null:{level:+s.mean.toFixed(4),snr:+(s.mean/s.sigma).toFixed(1),pixels:s.n};
}

await exec('agent-browser',['--session',session,'--init-script',hookPath,'set','viewport','1200','800'],{timeout:60000});
const rows=[];
try{
 for(const v of views)for(const mode of modes){
  if(v.id==='day'&&mode==='still'||v.modes&&!v.modes.includes(mode))continue;
  const night=mode==='current'?'':`&night=${mode}`;
  await open(`${base}/?${v.url}${night}`);
  const result=JSON.parse(JSON.parse(await ab('eval',`JSON.stringify({ev:window.__ev(),stats:window.__ledger(['all'],${mode==='current'?1:`2**(window.__sceneState()*${NIGHT_EXPOSURE_MAX_EV-EXPOSURE_MIN_EV}+${EXPOSURE_MIN_EV})`})})`)));
  const max=mode==='current'?5.1:NIGHT_EXPOSURE_MAX_EV,ev=result.ev*(max-EXPOSURE_MIN_EV)+EXPOSURE_MIN_EV,focal=v.focal??1.25,camera=cameraProgramFor(mode,ev,focal);
  const grainFile=join(out,`${v.id}-${mode}.png`),cleanFile=join(out,`${v.id}-${mode}-clean.png`);
  await ab('screenshot',grainFile);
  await open(`${base}/?${v.url}${night}&exposure-mode=manual&exposure-fixed=${ev.toFixed(3)}&look-grain=0`);
  await ab('screenshot',cleanFile);
  const measured=grainSnr(await greenLinear(grainFile),await greenLinear(cleanFile));
  const s=result.stats.all,cd=x=>(x*SCENE_CANDELA).toExponential(2);
  rows.push({view:v.id,mode,ev:+ev.toFixed(2),ev100:+camera.ev100.toFixed(2),f:+camera.fNumber.toFixed(2),t:+camera.shutterSeconds.toPrecision(3),iso:Math.round(camera.iso),nd:+camera.ndStops.toFixed(2),
   snrModel:+modelSnr(.055,camera.isoGain,800,mode!=='current'&&!unbinned).toFixed(1),snrMeasured:measured,p50:cd(s.p50),p90:cd(s.p90),p99:cd(s.p99)});
  console.log(JSON.stringify(rows.at(-1)));
 }
}finally{await ab('close');}
await writeFile(join(out,'night-views.json'),JSON.stringify({views,rows},null,1));
