import {execFileSync,spawnSync} from 'node:child_process';
import {readFile,realpath} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';

const source=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const repository='maxvyshniakov/earthlight';
export function deliveryPath(path){
  return ['package.json','bun.lock','earthlight.lock.json'].includes(path)
    || path.endsWith('.tgz')&&/^vendor\/earthlight-[\w.-]+\.tgz$/.test(path);
}
export function validateRevision(value){
  if(value.length!==40||!/^[a-f0-9]{40}$/.test(value))throw Error('Expected a full Earthlight commit SHA');
  return value;
}

export async function deliver(site){
  if(process.env.CI!=='true'||process.env.GITHUB_REPOSITORY!==repository||process.env.GITHUB_REF!=='refs/heads/main')
    throw Error('Delivery runs only in the Earthlight main-branch workflow');
  const git=(cwd,...args)=>execFileSync('git',args,{cwd,encoding:'utf8'}).trim();
  const run=(cwd,command,args)=>execFileSync(command,args,{cwd,stdio:'inherit'});
  const revision=validateRevision(git(source,'rev-parse','HEAD'));
  if(revision!==process.env.GITHUB_SHA)throw Error('Checkout does not match the workflow revision');
  const current=()=>execFileSync('gh',['api',`repos/${repository}/git/ref/heads/main`,'--jq','.object.sha'],{encoding:'utf8'}).trim()===revision;
  if(!current()){console.log('A newer Earthlight commit superseded this run.');return;}
  if(git(site,'branch','--show-current')!=='dev')throw Error('Consumer checkout must be on dev');
  if(!/[:/]maxvyshniakov\/personal-site(?:\.git)?$/.test(git(site,'remote','get-url','origin')))throw Error('Unexpected consumer repository');
  if(git(site,'status','--porcelain'))throw Error('Consumer checkout must be clean');
  const previous=JSON.parse(await readFile(resolve(site,'earthlight.lock.json'),'utf8'));
  if(previous.revision===revision){console.log(`Dev already contains Earthlight ${revision}.`);return;}
  run(site,'bun',['run','earthlight:update',source]);
  git(site,'add','--','package.json','bun.lock','earthlight.lock.json','vendor');
  const files=git(site,'diff','--cached','--name-only','-z').split('\0').filter(Boolean);
  if(!files.length||files.some(file=>!deliveryPath(file)))throw Error('Unexpected changes in the delivery commit');
  git(site,'diff','--cached','--check');
  git(site,'-c','user.name=Earthlight delivery','-c','user.email=earthlight-delivery@users.noreply.github.com',
    'commit','-m',`Update Earthlight to ${revision.slice(0,12)}`);
  // A normal push rejects concurrent edits. Rebase only this generated commit,
  // then verify the entire resulting site again before retrying; never force.
  for(let attempt=0;attempt<3;attempt++){
    if(attempt){git(site,'fetch','origin','dev');git(site,'rebase','origin/dev');}
    run(site,'bun',['install','--frozen-lockfile']);
    run(site,'bun',['run','verify']);
    if(!current()){console.log('A newer Earthlight commit superseded this run before publication.');return;}
    const pushed=spawnSync('git',['push','origin','HEAD:refs/heads/dev'],{cwd:site,stdio:'inherit'});
    if(pushed.status===0){
      console.log(`Updated personal-site/dev to ${git(site,'rev-parse','HEAD')}; Cloudflare Builds handles deployment.`);
      return;
    }
  }
  throw Error('Could not publish verified dev update after three attempts');
}

if(process.argv[1]&&await realpath(resolve(process.argv[1]))===fileURLToPath(import.meta.url))
  await deliver(resolve(process.argv[2]??'../personal-site'));
