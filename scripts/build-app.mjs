import {execFileSync} from 'node:child_process';
import {readFile,rm} from 'node:fs/promises';
const manifest=JSON.parse(await readFile(new URL('../assets-manifest.json',import.meta.url),'utf8'));
execFileSync('bun',['run','build'],{stdio:'inherit',cwd:new URL('..',import.meta.url),env:{...process.env,PUBLIC_EARTHLIGHT_ASSET_BASE_URL:`https://media.maxvyshniakov.com/earthlight/${manifest.version}/`}});
// Data is already deployed as immutable Static Assets. The app only owns code.
await rm(new URL('../dist/media/orbit',import.meta.url),{recursive:true,force:true});
