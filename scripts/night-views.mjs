// Renders the physical-night lab views (docs/lab/physical-night-2026-10-17.md)
// in an isolated agent-browser session: each view with night=current, video
// and still. Saves screenshots and prints the metered EV, EV100 and scene
// radiance quantiles. Frames are for review, not for the repository.
// bun scripts/night-views.mjs http://127.0.0.1:4321 /tmp/night-views
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {cameraProgramFor} from '../src/scripts/camera-model.ts';
import {SCENE_CANDELA} from '../src/scripts/radiometry.ts';
import {equatorialFrame} from '../src/scripts/celestial-sky.ts';

const exec=promisify(execFile);
const [base='http://127.0.0.1:4321',out=join(tmpdir(),'night-views'),...only]=process.argv.slice(2);
await mkdir(out,{recursive:true});
const session=`night-${process.pid}`;
const ab=async(...args)=>(await exec('agent-browser',['--session',session,...args],{maxBuffer:3e7,timeout:180000})).stdout;

// The radiance ledger's scene-buffer hook, plus the exposure state it writes.
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
// Free flight at ISS altitude over p; heading 'east' or 'south'.
function view(date,p,elevation,heading='east',extra=''){
 const east=unit(cross([0,0,1],p)),south=unit(cross(east,p));
 const t=4752.76,epoch=new Date(Date.parse(date)-t*1000).toISOString();
 return `t=${t}&epoch=${encodeURIComponent(epoch)}&motion=0&flight=free&position=${fmt(p.map(x=>x*r))}&heading=${fmt(heading==='east'?east:south)}&elevation=${elevation}${extra}`;
}
// Full Moon 2026-10-26 04:12 UTC: the Moon stands near the zenith of the
// antisolar point. The same view a full lunation earlier is moonless.
const full='2026-10-26T04:12:00Z',fresh='2026-10-10T04:12:00Z';
const anti=equatorialFrame(new Date(full)).sun.map(x=>-x);
const views=[
 {id:'full-moon',url:view(full,anti,-1.45)},
 {id:'new-moon',url:view(fresh,anti,-1.45)},
 {id:'quarter-moon',url:view('2026-10-18T22:00:00Z',ll(5,-20),-1.45)},
 // ISS030-E-10008: Iberia at night, 2011-12-04 00:13 UTC, 24 mm, oblique.
 {id:'iberia',url:view('2011-12-04T00:13:00Z',ll(46,-3),-.75,'south')},
 // The same at the reference's EV100 −3.7 (manual EV 19.3), lab modes only.
 {id:'iberia-reference',url:view('2011-12-04T00:13:00Z',ll(46,-3),-.75,'south','&exposure-mode=manual&exposure-fixed=19.3'),modes:['video','still']},
 // The ledger's daylit nadir: exposure must not change.
 {id:'day',url:'t=4752.76&epoch=2026-10-16T07%3A57%3A47.730Z&motion=0&flight=free&position=0.9055%2C0.6860%2C-0.1790&heading=0.6039%2C-0.7971%2C0&elevation=-1.45'},
].filter(v=>!only.length||only.includes(v.id));
const modes=['current','video','still'];
const settled="document.querySelector('earthlight-explorer')?.dataset.assets==='settled'&&document.querySelector('earthlight-explorer')?.dataset.focus==='sharp'";
await exec('agent-browser',['--session',session,'--init-script',hookPath,'set','viewport','1200','800'],{timeout:60000});
const rows=[];
try{
 for(const v of views)for(const mode of modes){
  if(v.id==='day'&&mode==='still'||v.modes&&!v.modes.includes(mode))continue;
  await ab('open',`${base}/?${v.url}${mode==='current'?'':`&night=${mode}`}`);await ab('wait','--fn',settled);await ab('wait','12000');
  const result=JSON.parse(JSON.parse(await ab('eval',`JSON.stringify({ev:window.__ev(),stats:window.__ledger(['all'])})`)));
  const max=mode==='current'?5.1:22.1,ev=result.ev*(max+5.5)-5.5,camera=cameraProgramFor(mode,ev);
  await ab('screenshot',join(out,`${v.id}-${mode}.png`));
  const s=result.stats.all,cd=x=>(x*SCENE_CANDELA).toExponential(2);
  rows.push({view:v.id,mode,ev:+ev.toFixed(2),ev100:+camera.ev100.toFixed(2),f:+camera.fNumber.toFixed(2),t:+camera.shutterSeconds.toPrecision(3),iso:Math.round(camera.iso),nd:+camera.ndStops.toFixed(2),p50:cd(s.p50),p90:cd(s.p90),p99:cd(s.p99)});
  console.log(JSON.stringify(rows.at(-1)));
 }
}finally{await ab('close');}
await writeFile(join(out,'night-views.json'),JSON.stringify({views,rows},null,1));
