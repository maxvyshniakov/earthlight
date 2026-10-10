import {readFile,cp,mkdir} from 'node:fs/promises';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const manifest=JSON.parse(await readFile(join(root,'assets-manifest.json'),'utf8'));
export const backgroundAssetBase=`/media/earthlight/${manifest.version}/`;
const types={avif:'image/avif',webp:'image/webp',bin:'application/octet-stream'};
/** The same package supports offline builds and a versioned R2 asset origin. */
export default function earthlight({assetBaseURL=backgroundAssetBase}={}){
 const local=assetBaseURL===backgroundAssetBase;
 return {name:'earthlight-background',hooks:{
  'astro:config:setup':({updateConfig})=>{
   if(!local)return;
   updateConfig({vite:{plugins:[{name:'earthlight-background-assets',configureServer(server){
    server.middlewares.use(async(req,res,next)=>{
     const path=new URL(req.url??'/','http://localhost').pathname;
     if(!path.startsWith(backgroundAssetBase))return next();
     const name=path.slice(backgroundAssetBase.length);
     if(!manifest.background.includes(name)||!['GET','HEAD'].includes(req.method??''))return next();
     try{
      const body=await readFile(join(root,'assets/background',name));
      res.setHeader('Content-Type',types[name.split('.').pop()]??'application/octet-stream');
      res.setHeader('Cache-Control','public, max-age=31536000, immutable');
      res.end(req.method==='HEAD'?undefined:body);
     }catch(error){next(error);}
    });
   }}]}});
  },
  'astro:build:done':async({dir})=>{
   if(!local)return;
   const destination=join(fileURLToPath(dir),backgroundAssetBase.slice(1));
   await mkdir(destination,{recursive:true});
   await cp(join(root,'assets/background'),destination,{recursive:true});
  },
 }};
}
