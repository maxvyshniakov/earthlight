import {readFile,writeFile,mkdir,copyFile,rm} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const manifest=JSON.parse(await readFile(join(root,'assets-manifest.json'),'utf8'));
if(manifest.files.length+1>19000)throw Error('Static Assets free file budget exceeded (19,000 safety limit)');
const output=join(root,'.media',manifest.version),prefix=`earthlight/${manifest.version}`;
await rm(output,{recursive:true,force:true});
for(const file of manifest.files){
 if(file.bytes>25*1024*1024)throw Error(`Static Assets file exceeds 25 MiB: ${file.path}`);
 const input=join(root,'public/media/orbit',file.path),bytes=await readFile(input);
 if(createHash('sha256').update(bytes).digest('hex')!==file.sha256)throw Error(`Asset changed: ${file.path}; run assets:prepare`);
 const target=join(output,prefix,file.path);await mkdir(dirname(target),{recursive:true});await copyFile(input,target);
}
await writeFile(join(output,prefix,'manifest.json'),JSON.stringify(manifest));
await writeFile(join(output,'_headers'),`/earthlight/${manifest.version}/*\n  Access-Control-Allow-Origin: *\n  Cache-Control: public, max-age=31536000, immutable\n  X-Content-Type-Options: nosniff\n`);
const shared={compatibility_date:'2026-10-10',workers_dev:false,preview_urls:false};
await writeFile(join(root,'.media/wrangler-version.json'),JSON.stringify({...shared,name:`earthlight-assets-${manifest.version}`,routes:[{pattern:`media.maxvyshniakov.com/earthlight/${manifest.version}/*`,zone_name:'maxvyshniakov.com'}],assets:{directory:`./${manifest.version}`,not_found_handling:'404-page'}},null,2));
await mkdir(join(root,'.media/root'),{recursive:true});
await writeFile(join(root,'.media/root/404.html'),'<!doctype html><meta charset="utf-8"><title>Not found</title><h1>Not found</h1>');
await writeFile(join(root,'.media/wrangler-root.json'),JSON.stringify({...shared,name:'earthlight-media',routes:[{pattern:'media.maxvyshniakov.com',custom_domain:true}],assets:{directory:'./root',not_found_handling:'404-page'}},null,2));
console.log(`Prepared ${manifest.files.length} immutable static files at https://media.maxvyshniakov.com/${prefix}/`);
