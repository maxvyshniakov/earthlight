// Serve an isolated codec comparison and the site's Earth shader with a regional
// high-resolution overlay. Production assets, routes and rendering stay untouched.
import fs from 'node:fs';
import path from 'node:path';
import {createServer} from 'node:http';
import {issFrame} from '../src/scripts/iss-orbit.ts';
import {nightLightsLabShader as shader} from './night-lights-lab-shader.mjs';
const root=path.resolve(import.meta.dirname,'..'),out=path.resolve(process.argv[2]||'/tmp/night-lights-lab'),port=Number(process.argv[3]||4340);
const html=`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Night lights · texture lab</title>
<style>
*{box-sizing:border-box}body{margin:0;background:#0b0e11;color:#e7e7df;font:15px/1.6 system-ui}main{max-width:1440px;margin:auto;padding:40px 28px}h1{font-size:36px;letter-spacing:-.04em}h2{margin-top:44px}p{max-width:850px;color:#aeb6bd}label{display:inline-flex;gap:10px;align-items:center;margin:8px 20px 8px 0}select,button{background:#202830;color:inherit;border:1px solid #45505a;border-radius:5px;padding:9px;font:inherit}a{color:#dcaf89}.controls{position:sticky;top:0;padding:12px;background:#0b0e11f5;z-index:2;display:flex;flex-wrap:wrap;align-items:center;gap:12px}.pair{display:grid;grid-template-columns:1fr 1fr;gap:20px}.viewport{overflow:auto;height:450px;background:black}.viewport img{max-width:none;display:block}figure{margin:0;min-width:0}figcaption{padding:10px 0;color:#b2bac2}canvas{display:block;width:100%;height:auto}.pair.orbit{grid-template-columns:1fr}.scene{height:300px;overflow:hidden;background:black;position:relative}.scene canvas{position:absolute;bottom:0}table{border-collapse:collapse;width:100%;font-variant-numeric:tabular-nums}td,th{text-align:right;padding:9px 12px;border-bottom:1px solid #ffffff15}td:first-child,th:first-child{text-align:left}tr.selected{background:#30251d}code{color:#d5b79c}.small{font-size:13px} @media(max-width:800px){.pair{grid-template-columns:1fr}.viewport{height:340px}main{padding:20px 12px}.scene{height:200px}table{font-size:12px}}
</style><main>
<p>NASA BLACK MARBLE 2016 · 500 M · LOCAL EXPERIMENT</p><h1>Night lights, without the Earth beneath them.</h1>
<p>Four identical samples: Buenos Aires / Montevideo, São Paulo, Santiago and an empty Atlantic patch. The left image is the decoded NASA grayscale JPEG, stored as lossless PNG. The right is the selected encoding. These are published, tone-mapped composites; white city centers are already clipped in the source.</p>
<div class="controls"><label>Variant <select id="variant"></select></label><label>Region <select id="region"></select></label><label>Zoom <select id="zoom"><option value="1">1 image pixel = 1 CSS pixel</option><option value="2">2× pixels</option><option value=".5">Fit / 50%</option></select></label><span id="size"></span></div>
<div class="pair"><figure><div class="viewport" id="left"><img id="reference" src="/bench/reference.png" alt="Source night lights"></div><figcaption>NASA grayscale reference · no added color or glow</figcaption></figure><figure><div class="viewport" id="right"><img id="candidate" alt="Encoded night lights"></div><figcaption id="caption"></figcaption></figure></div>
<h2>Same Earth shader, same orbital camera</h2>
<p>The preview uses the site's Earth surface, cloud, atmosphere and light shaders. A 500 m regional overlay replaces the base map only over southern South America. The sky and camera grain are omitted so the comparison stays readable. Both views share the same time and sunlight.</p>
<label>ISS replay time <input id="time" type="range" min="0" max="600" step="1" value="0"><output id="timeLabel">0 s</output></label>
<label>Regional texture <select id="sceneVariant"></select></label>
<label>Clouds <input id="clouds" type="checkbox" checked></label>
<label>Overlay exposure <input id="gain" type="range" min="0.1" max="1.5" step=".05" value=".55"><output id="gainLabel">0.55×</output></label>
<p class="small">The grayscale and color products have different published tone curves. Exposure is adjustable; codec comparisons above always use identical grayscale values. This prototype loads one region as a whole texture; a production version should load sparse tiles.</p>
<div class="pair orbit"><figure><div class="scene"><canvas id="old" width="1400" height="900"></canvas></div><figcaption>Current global 8K night map</figcaption></figure><figure><div class="scene"><canvas id="new" width="1400" height="900"></canvas></div><figcaption id="sceneCaption">Regional 500 m overlay</figcaption></figure></div>
<p id="status">Loading renderer…</p>
<h2>Measured sizes and losses</h2><p class="small">RMSE is measured only where reference brightness ≥4/255; edge error compares adjacent pixel differences. “Lost lights” counts reference pixels ≥16 that fall below 8. This excludes empty black pixels from the main error metric. Source JPEG compression is present in every variant.</p>
<table><thead><tr><th>Encoding</th><th>Size</th><th>Lit RMSE / 255</th><th>Edge error</th><th>Lost lights</th></tr></thead><tbody id="rows"></tbody></table>
<h2>Empty space</h2><p id="sparse"></p><p id="tileBudget"></p><p><a href="/bench/results.json">Download measurements</a> · <a href="https://science.nasa.gov/earth/earth-observatory/earth-at-night/maps/">NASA source and credits</a></p>
</main><script type="module" src="/lab.js"></script></html>`;
const client=`
const manifest=await fetch('/bench/results.json').then(r=>r.json()),$=s=>document.querySelector(s),kb=n=>(n/1024).toFixed(1)+' KiB';
for(const row of manifest.rows)$('#variant').add(new Option(row.name+' · '+kb(row.bytes),row.file));
for(const [i,r] of manifest.regions.entries())$('#region').add(new Option(r.name,i));
const show=()=>{const row=manifest.rows.find(r=>r.file===$('#variant').value),scale=+$('#zoom').value;
 $('#candidate').src='/bench/'+row.file;for(const id of ['reference','candidate']){$('#'+id).style.width=2048*scale+'px';$('#'+id).style.imageRendering=scale>1?'pixelated':'auto';}
 $('#size').textContent=kb(row.bytes);$('#caption').textContent=row.name+' · '+row.width+' × '+row.width;
 const i=+$('#region').value;for(const id of ['left','right']){$('#'+id).scrollLeft=i%2*1024*scale;$('#'+id).scrollTop=Math.floor(i/2)*1024*scale;}
 for(const tr of document.querySelectorAll('tbody tr'))tr.classList.toggle('selected',tr.dataset.file===row.file);
};
for(const r of manifest.rows){const tr=document.createElement('tr');tr.dataset.file=r.file;const vals=[r.name,kb(r.bytes),r.activeRmse?.toFixed(2)??'—',r.edgeError===undefined?'—':(r.edgeError*100).toFixed(1)+'%',r.lostLitFraction===undefined?'—':(r.lostLitFraction*100).toFixed(2)+'%'];for(const value of vals){const td=document.createElement('td');td.textContent=value;tr.append(td);}$('#rows').append(tr);}
let scrolling=false;for(const [a,b] of [['left','right'],['right','left']])$('#'+a).onscroll=()=>{if(scrolling)return;scrolling=true;$('#'+b).scrollLeft=$('#'+a).scrollLeft;$('#'+b).scrollTop=$('#'+a).scrollTop;requestAnimationFrame(()=>scrolling=false);};
$('#variant').value='avif-80.avif';for(const id of ['variant','region','zoom'])$('#'+id).onchange=show;show();
const s=manifest.sparse;$('#sparse').textContent=(100*s.zeroPixels/s.sourcePixels).toFixed(2)+'% of the South America / Atlantic source tile is exactly black. '+s.empty+' of '+s.total+' tiles (512×512, edge tiles smaller) are entirely empty. A ≤3/255 threshold would skip '+s.faintOnly+' tiles and remove '+(100*s.faintFlux/s.totalFlux).toFixed(4)+'% of total encoded brightness. These measurements describe this tile, not the whole Earth.';
if(manifest.tiling){const t=manifest.tiling;$('#tileBudget').textContent='The 8192×8192 regional overlay occupies '+t.nonempty+' of '+t.slots+' 512px tiles. Together: '+kb(t.avifBytes)+' (AVIF 80), '+kb(t.webpBytes)+' (WebP near-lossless). At t=0, a sampled view plus one-tile guard band selects '+t.views[0].tiles+' tiles / '+kb(t.views[0].avifBytes)+'. This is a coverage estimate before texture gutters and HTTP overhead; the preview above still loads the whole regional texture.';}
const shader=await fetch('/shader.frag').then(r=>r.text());
function renderer(canvas){
 const gl=canvas.getContext('webgl',{antialias:false,alpha:false,preserveDrawingBuffer:true});if(!gl)throw Error('WebGL unavailable');
 const p=gl.createProgram();for(const [type,src] of [[gl.VERTEX_SHADER,'attribute vec2 position;void main(){gl_Position=vec4(position,0.,1.);}'],[gl.FRAGMENT_SHADER,shader]]){const s=gl.createShader(type);gl.shaderSource(s,src);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw Error(gl.getShaderInfoLog(s));gl.attachShader(p,s);}gl.linkProgram(p);if(!gl.getProgramParameter(p,gl.LINK_STATUS))throw Error(gl.getProgramInfoLog(p));gl.useProgram(p);
 const u=n=>gl.getUniformLocation(p,n),buffer=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,buffer);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,3,-1,-1,3]),gl.STATIC_DRAW);const a=gl.getAttribLocation(p,'position');gl.enableVertexAttribArray(a);gl.vertexAttribPointer(a,2,gl.FLOAT,false,0,0);
 const names=['surfaceMap','nightMap','cloudMap','starMap','opticalPsf','milkyWayMap','unused','nightDetail'],textures=[];
 for(let i=0;i<8;i++){const t=gl.createTexture();textures.push(t);gl.activeTexture(gl.TEXTURE0+i);gl.bindTexture(gl.TEXTURE_2D,t);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,1,1,0,gl.RGBA,gl.UNSIGNED_BYTE,new Uint8Array([0,0,0,255]));gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);for(const d of [gl.TEXTURE_WRAP_S,gl.TEXTURE_WRAP_T])gl.texParameteri(gl.TEXTURE_2D,d,gl.CLAMP_TO_EDGE);gl.uniform1i(u(names[i]),i);}
 gl.uniform2f(u('resolution'),canvas.width,canvas.height);gl.uniform1f(u('pixelRatio'),1);gl.uniform1f(u('mapsReady'),1);gl.uniform1f(u('surfaceEnabled'),1);gl.uniform4f(u('moon'),0,0,1,0);gl.uniform4fv(u('planets[0]'),new Float32Array(Array.from({length:5},()=>[0,0,1,100]).flat()));
 const e=manifest.extent;gl.uniform4f(u('detailBounds'),.5+e.west/360,.5+e.south/180,(e.east-e.west)/360,(e.north-e.south)/180);
 const upload=(unit,image)=>{gl.activeTexture(gl.TEXTURE0+unit);gl.bindTexture(gl.TEXTURE_2D,textures[unit]);const fmt=unit===1||unit===2||unit===7?gl.LUMINANCE:gl.RGBA;gl.texImage2D(gl.TEXTURE_2D,0,fmt,fmt,gl.UNSIGNED_BYTE,image);gl.generateMipmap(gl.TEXTURE_2D);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR_MIPMAP_LINEAR);const an=gl.getExtension('EXT_texture_filter_anisotropic');if(an)gl.texParameterf(gl.TEXTURE_2D,an.TEXTURE_MAX_ANISOTROPY_EXT,Math.min(8,gl.getParameter(an.MAX_TEXTURE_MAX_ANISOTROPY_EXT)));if(unit===1)gl.uniform2f(u('nightMapResolution'),image.width,image.height);if(unit===2)gl.uniform1f(u('cloudMapWidth'),image.width);};
 return {upload,draw(f,detail){gl.useProgram(p);gl.uniform3fv(u('cameraPosition'),f.camera);gl.uniformMatrix3fv(u('cameraBasis'),false,f.cameraBasis);gl.uniform3fv(u('sunDirection'),f.sun);gl.uniform1f(u('time'),+$('#time').value);gl.uniform1f(u('detailEnabled'),detail?1:0);gl.uniform1f(u('detailGain'),+$('#gain').value);gl.uniform1f(u('cloudAmount'),$('#clouds').checked?1:0);gl.viewport(0,0,canvas.width,canvas.height);gl.drawArrays(gl.TRIANGLES,0,3);if(gl.getError())throw Error('WebGL draw/upload failed');}};
}
try{
 const renderers=[renderer($('#old')),renderer($('#new'))],bitmaps=new Map();
 const load=async url=>{if(!bitmaps.has(url)){const response=await fetch(url);if(!response.ok)throw Error(url);bitmaps.set(url,await createImageBitmap(await response.blob(),{imageOrientation:'flipY'}));}return bitmaps.get(url);};
 await Promise.all(['earth-day','earth-night','earth-clouds'].map(async(name,i)=>{const img=await load('/media/earthlight/'+name+'-8k.avif');renderers.forEach(r=>r.upload(i,img));}));
 let sequence=0;
 const draw=async()=>{const seq=++sequence,f=await fetch('/frame?t='+$('#time').value).then(r=>r.json());if(seq!==sequence)return;renderers[0].draw(f,false);renderers[1].draw(f,true);$('#timeLabel').textContent=$('#time').value+' s';$('#gainLabel').textContent=$('#gain').value+'×';$('#status').textContent='ISS '+f.latitude.toFixed(2)+'°, '+f.longitude.toFixed(2)+'° · '+f.phase+' · renderer ready';};
 for(const r of manifest.scene)$('#sceneVariant').add(new Option(r.name+' · '+kb(r.bytes),r.file));
 if(manifest.scene.some(r=>r.file==='native-avif-80.avif'))$('#sceneVariant').value='native-avif-80.avif';
 const change=async()=>{const file=$('#sceneVariant').value;$('#status').textContent='Loading regional texture…';const img=await load('/bench/'+file);if(file!==$('#sceneVariant').value)return;renderers[1].upload(7,img);$('#sceneCaption').textContent=file;await draw();};
 $('#sceneVariant').onchange=()=>change().catch(e=>$('#status').textContent=e.message);
 for(const id of ['time','clouds','gain'])$('#'+id).oninput=()=>draw().catch(e=>$('#status').textContent=e.message);
 await change();window.labReady=true;
}catch(e){$('#status').textContent=e.stack;}
`;
createServer((req,res)=>{
 const url=new URL(req.url,'http://localhost');res.setHeader('Cache-Control','no-store');
 if(url.pathname==='/'){res.setHeader('Content-Type','text/html');res.end(html);return;}
 if(url.pathname==='/lab.js'){res.setHeader('Content-Type','text/javascript');res.end(client);return;}
 if(url.pathname==='/shader.frag'){res.setHeader('Content-Type','text/plain');res.end(shader);return;}
 if(url.pathname==='/frame'){res.setHeader('Content-Type','application/json');const t=Number(url.searchParams.get('t'));res.end(JSON.stringify(issFrame(Number.isFinite(t)?t:180,.22)));return;}
 const base=url.pathname.startsWith('/bench/')?out:path.join(root,'public/media/earthlight');
 const file=path.join(base,path.basename(url.pathname));
 if(!fs.existsSync(file)||!fs.statSync(file).isFile()){res.statusCode=404;res.end();return;}
 const types={'.json':'application/json','.png':'image/png','.webp':'image/webp','.avif':'image/avif','.jpg':'image/jpeg'};
 res.setHeader('Content-Type',types[path.extname(file)]||'application/octet-stream');fs.createReadStream(file).pipe(res);
}).listen(port,'127.0.0.1',()=>console.log('Night lights lab: http://127.0.0.1:'+port+'/'));
