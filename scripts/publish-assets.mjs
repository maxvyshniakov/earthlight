import {S3Client} from 'bun';
import {createHash} from 'node:crypto';
import {readFile,writeFile,mkdir,stat} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {dirname,resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const {CLOUDFLARE_API_TOKEN:token,CLOUDFLARE_ACCOUNT_ID:account}=process.env;
const bucket='media';
async function api(path){
 const response=await fetch(`https://api.cloudflare.com/client/v4${path}`,{headers:{Authorization:`Bearer ${token}`}});
 const body=await response.json();
 if(!response.ok||!body.success)throw Error(`Cloudflare request failed (${response.status}): ${body.errors?.map(error=>error.message).join('; ')}`);
 return body.result;
}
async function main(){
 if(!token||!account)throw Error('Run with the Keychain-backed Cloudflare wrapper.');
 const manifest=JSON.parse(await readFile(join(root,'assets-manifest.json'),'utf8'));
 const verified=await api('/user/tokens/verify');
 const credentials={accessKeyId:verified.id,secretAccessKey:createHash('sha256').update(token).digest('hex'),endpoint:`https://${account}.r2.cloudflarestorage.com`,region:'auto'};
 const domains=await api(`/accounts/${account}/r2/buckets/${bucket}/domains/custom`);
 const managed=await api(`/accounts/${account}/r2/buckets/${bucket}/domains/managed`);
 if(domains.domains?.some(domain=>domain.enabled)||managed.enabled)throw Error('Release bucket must remain private; disable public access first.');
 const client=new S3Client({...credentials,bucket});
 const prefix=`earthlight/releases/${manifest.version}`;
 if(await client.exists(`${prefix}/manifest.json`)){
  const published=await client.file(`${prefix}/manifest.json`).json();
  if(JSON.stringify(published.manifest)!==JSON.stringify(manifest))throw Error('Refusing to overwrite an immutable release');
  console.log(`Release ${manifest.version} already exists; no upload.`);return;
 }
 // Budgets cover this release bucket only. Other buckets (e.g. homelab
 // backups) belong to other tools and are neither listed nor enforced here.
 let total=0,monthly=0,continuationToken,pages=0;
 const month=new Date().toISOString().slice(0,7);
 do{
  if(++pages>20)throw Error('Storage audit exceeded its request budget.');
  const page=await client.list({maxKeys:1000,...(continuationToken?{continuationToken}:{})});
  for(const object of page.contents??[]){total+=Number(object.size);if(new Date(object.lastModified).toISOString().startsWith(month))monthly++;}
  if(page.isTruncated&&!page.nextContinuationToken)throw Error('Incomplete storage listing');
  continuationToken=page.isTruncated?page.nextContinuationToken:undefined;
 }while(continuationToken);
 if(monthly+2>100)throw Error('Monthly release-write safety budget reached. Review R2 usage before uploading.');
 const scratch=join(root,'.asset-upload');await mkdir(scratch,{recursive:true});
 // Validate every source before creating a release, including provenance files.
 for(const file of manifest.files){
  const bytes=await readFile(join(root,'public/media/orbit',file.path));
  if(bytes.length!==file.bytes||createHash('sha256').update(bytes).digest('hex')!==file.sha256)throw Error(`Changed asset: ${file.path}`);
 }
 const list=join(scratch,'files.txt'),archive=join(scratch,`${manifest.version}.tar`);
 await writeFile(list,manifest.files.map(file=>file.path).join('\n')+'\n');
 execFileSync('tar',['-cf',archive,'-C',join(root,'public/media/orbit'),'-T',list],{stdio:'pipe',env:{...process.env,COPYFILE_DISABLE:'1'}});
 const size=(await stat(archive)).size;
 if(size>512*1024*1024)throw Error('Release archive exceeds the 512 MiB upload safety budget.');
 // Keep the current release and at most one previous one; ~2 GB fits both.
 if(total+size+5_000_000>2_000_000_000)throw Error(`Bucket ${bucket} would exceed its 2 GB safety budget; delete releases no consumer references. No files uploaded.`);
 const archiveSHA256=createHash('sha256').update(await readFile(archive)).digest('hex');
 console.log(`Uploading private release: ${Math.ceil(size/1e6)} MB; projected ${bucket} storage ${Math.ceil((total+size)/1e6)} MB.`);
 await client.write(`${prefix}/assets.tar`,Bun.file(archive),{type:'application/x-tar'});
 const uploaded=await client.stat(`${prefix}/assets.tar`);
 if(uploaded.size!==size)throw Error('Uploaded archive size mismatch');
 await client.write(`${prefix}/manifest.json`,JSON.stringify({manifest,archiveSHA256,archiveBytes:size}),{type:'application/json'});
 console.log(`Private release ${manifest.version} stored. Browser traffic uses Static Assets, never this bucket.`);
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
