import {Readable} from 'node:stream';
import {terrainResponse} from './terrain-source.mjs';

export async function terrainMiddleware(req,res,next){
  if(!req.url?.startsWith('/media/orbit/dem90/'))return next();
  const controller=new AbortController();res.on('close',()=>controller.abort());
  const result=await terrainResponse(new Request(new URL(req.url,'http://localhost'),{method:req.method,signal:controller.signal}));
  if(res.destroyed){await result.body?.cancel();return;}
  res.writeHead(result.status,Object.fromEntries(result.headers));
  if(result.body)Readable.fromWeb(result.body).on('error',()=>res.destroy()).pipe(res);else res.end();
}
