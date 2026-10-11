import {existsSync,realpathSync} from 'node:fs';
import {readFile} from 'node:fs/promises';
import {delimiter,join,basename} from 'node:path';
import {spawn} from 'node:child_process';

// Wrangler uses Node: Bun 1.3.14 can exit before its undici uploads finish.
const node=(process.env.PATH??'').split(delimiter).map(dir=>join(dir,'node'))
  .find(path=>existsSync(path)&&basename(realpathSync(path))==='node');
if(!node)throw Error('Wrangler requires Node 22+; use Bun for project scripts and dependencies.');
const {revision}=JSON.parse(await readFile(new URL('../dist/earthlight-version.json',import.meta.url),'utf8'));
if(!/^[a-f0-9]{40}$/.test(revision))throw Error('Run bun run build:deploy before deploying.');
const child=spawn(realpathSync(node),[
  new URL('../node_modules/wrangler/bin/wrangler.js',import.meta.url).pathname,
  'deploy','--message',`Earthlight source ${revision}`,...process.argv.slice(2),
],{cwd:new URL('..',import.meta.url),stdio:'inherit'});
child.on('error',()=>{console.error('Could not start Wrangler');process.exitCode=1;});
child.on('exit',code=>{process.exitCode=code??1;});
