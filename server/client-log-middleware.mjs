// Development only: prints startup failures that browsers report through
// src/scripts/dev-report.ts, so failures on phones show in the server log.
export function clientLogMiddleware(req,res,next){
  if(req.url!=='/__earthlight/client-log'||req.method!=='POST')return next();
  let body='';
  req.on('data',chunk=>{if(body.length<65536)body+=chunk;});
  req.on('end',()=>{console.log('[client-log]',body);res.statusCode=204;res.end();});
}
