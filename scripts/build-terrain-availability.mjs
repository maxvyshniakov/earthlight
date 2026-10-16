// Public GLO-90 inventory; no credentials or remote writes.
import {writeFile} from 'node:fs/promises';
const response=await fetch('https://copernicus-dem-90m.s3.amazonaws.com/tileList.txt');
if(!response.ok)throw Error(`Inventory HTTP ${response.status}`);
const ids=[];
for(const line of (await response.text()).split(/\r?\n/)){
 const m=/Copernicus_DSM_COG_30_([NS])(\d{2})_00_([EW])(\d{3})_00_DEM/.exec(line);
 if(!m)continue;
 const lat=Number(m[2])*(m[1]==='S'?-1:1),lon=Number(m[4])*(m[3]==='W'?-1:1);
 ids.push((89-lat)*360+lon+180);
}
if(ids.length<10000)throw Error('Incomplete inventory');
await writeFile(new URL('../public/media/earthlight/terrain-tiles/copernicus.json',import.meta.url),JSON.stringify([...new Set(ids)].sort((a,b)=>a-b))+'\n');
console.log(`${ids.length} GLO-90 source tiles`);
