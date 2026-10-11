import {execFileSync} from 'node:child_process';
import {readFile,rm,writeFile} from 'node:fs/promises';
const root=new URL('..',import.meta.url);
const revision=execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim();
if(!/^[a-f0-9]{40}$/.test(revision))throw Error('Missing source revision');
const manifest=JSON.parse(await readFile(new URL('../assets-manifest.json',import.meta.url),'utf8'));
execFileSync('bun',['run','build'],{stdio:'inherit',cwd:new URL('..',import.meta.url),env:{...process.env,PUBLIC_EARTHLIGHT_ASSET_BASE_URL:`https://media.maxvyshniakov.com/earthlight/${manifest.version}/`}});
// Data is already deployed as immutable Static Assets. The app only owns code.
await rm(new URL('../dist/media/orbit',import.meta.url),{recursive:true,force:true});
await writeFile(new URL('../dist/earthlight-version.json',import.meta.url),JSON.stringify({revision,assets:manifest.version,builtAt:new Date().toISOString()})+'\n');
