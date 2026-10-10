import {preview} from 'astro';
import {parseArgs} from 'node:util';
import {terrainMiddleware} from '../server/terrain-middleware.mjs';

const {values}=parseArgs({options:{host:{type:'string',default:'127.0.0.1'},port:{type:'string',default:'4321'}}});
const app=await preview({server:{host:values.host,port:Number(values.port)}});
// Astro's static preview intentionally omits user Vite plugins. Attach the
// same narrow DEM route used in dev; all other requests stay with Astro.
const handlers=app.server.listeners('request');
app.server.removeAllListeners('request');
app.server.on('request',(req,res)=>void terrainMiddleware(req,res,()=>{
  for(const handler of handlers)handler.call(app.server,req,res);
}));
for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>void app.stop());
