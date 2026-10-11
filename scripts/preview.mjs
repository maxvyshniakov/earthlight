import {preview} from 'astro';
import {parseArgs} from 'node:util';
import {terrainMiddleware} from '../server/terrain-middleware.mjs';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';

const {values}=parseArgs({options:{host:{type:'string',default:'127.0.0.1'},port:{type:'string',default:'4321'},'terrain-cache':{type:'string'}}});
// Optional local benchmark fixture: serve TIFF and prepared bytes over the
// same connection, instead of comparing S3 latency with local static files.
const terrainFetch=values['terrain-cache']?async(url,options)=>{
  const match=/Copernicus_DSM_COG_30_([NS]\d{2})_00_([EW]\d{3})_00_DEM\.tif$/.exec(url);
  if(match){try{const bytes=await readFile(join(values['terrain-cache'],match[1]+match[2]+'.tif'));return new Response(bytes,{headers:{'Content-Length':String(bytes.length)}});}catch(error){if(error.code!=='ENOENT')throw error;}}
  return fetch(url,options);
}:fetch;
const app=await preview({server:{host:values.host,port:Number(values.port)}});
// Astro's static preview intentionally omits user Vite plugins. Attach the
// same narrow DEM route used in dev; all other requests stay with Astro.
const handlers=app.server.listeners('request');
app.server.removeAllListeners('request');
app.server.on('request',(req,res)=>void terrainMiddleware(req,res,()=>{
  for(const handler of handlers)handler.call(app.server,req,res);
},terrainFetch));
for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>void app.stop());
