import {tileDimensions} from './tile-layout.ts';
const layout=tileDimensions('terrainFine');
export const DEM_CELL=layout.cell,DEM_INTERIOR=layout.interior,DEM_COLUMNS=layout.columns,DEM_ROWS=layout.rows;
export function parentTerrainTile(id:number){return Math.floor(Math.floor(id/720)/2)*360+Math.floor((id%720)/2);}
export function terrainSourceName(id:number){
 const lat=89-Math.floor(id/360),lon=id%360-180;
 return `${lat<0?'S':'N'}${String(Math.abs(lat)).padStart(2,'0')}${lon<0?'W':'E'}${String(Math.abs(lon)).padStart(3,'0')}`;
}
/** Regrid variable-longitude COG rows onto the atlas grid. Heights remain metres
 * until the last packing step, including all mip levels. */
export function packTerrainPatch(data:ArrayLike<number>,width:number,height:number,qx:number,qy:number){
 const cell=DEM_CELL,interior=DEM_INTERIOR;
 let values=new Float32Array(cell*cell);
 const sample=(x:number,y:number)=>{
  const ix=Math.max(0,Math.min(width-2,Math.floor(x))),iy=Math.max(0,Math.min(height-2,Math.floor(y)));
  // Continue the last local slope into the small outer gutter. Interior pixels
  // always use actual data; adjacent tiles select their own interior at seams.
  const fx=x-ix,fy=y-iy;
  const v=(data[iy*width+ix]*(1-fx)+data[iy*width+ix+1]*fx)*(1-fy)+(data[(iy+1)*width+ix]*(1-fx)+data[(iy+1)*width+ix+1]*fx)*fy;
  return Number.isFinite(v)?Math.max(0,Math.min(9000,v)):0;
 };
 for(let y=0;y<cell;y++)for(let x=0;x<cell;x++)values[y*cell+x]=sample((qx*interior+x-16+.5)/1200*width,(qy*interior+y-16+.5)/1200*height);
 const packed=new Uint8Array(cell*cell*2*4);let size=cell,offset=0;
 for(let level=0;level<=4;level++){
  for(let y=0;y<size;y++)for(let x=0;x<size;x++){
   const value=Math.round(values[y*size+x]/8),p=(y*cell*2+(level?cell+offset:0)+x)*4;
   packed[p]=value>>8;packed[p+1]=value&255;packed[p+3]=255;
  }
  if(level)offset+=size;
  if(level===4)break;
  const n=Math.ceil(size/2),next=new Float32Array(n*n);
  for(let y=0;y<n;y++)for(let x=0;x<n;x++){
   const x0=x*size/n,x1=(x+1)*size/n,y0=y*size/n,y1=(y+1)*size/n;let sum=0;
   for(let yy=Math.floor(y0);yy<Math.ceil(y1);yy++)for(let xx=Math.floor(x0);xx<Math.ceil(x1);xx++)sum+=values[yy*size+xx]*(Math.min(x1,xx+1)-Math.max(x0,xx))*(Math.min(y1,yy+1)-Math.max(y0,yy));
   next[y*n+x]=sum/((x1-x0)*(y1-y0));
  }values=next;size=n;
 }
 return packed;
}

export const terrainDetailShader=`
uniform sampler2D terrainTileAtlas;
uniform vec2 terrainTileLayout;
vec4 terrainEntry(vec2 uv,bool fine){
 vec2 grid=vec2(fract(uv.x),clamp(1.-uv.y,0.,.999999))* (fine?vec2(720.,360.):vec2(40.,20.));
 return texture2D(terrainTileAtlas,(floor(grid)+vec2(fine?0.:720.,0.)+.5)/terrainTileLayout.x);
}
float terrainSamplingWidthAt(vec2 uv){
 if(terrainTileLayout.x<1.)return terrainWidth;
 if(terrainEntry(uv,true).r>.0)return 432000.;
 return terrainEntry(uv,false).r>.0?21600.:terrainWidth;
}
vec3 terrainStreamLevel(vec2 local,float slot,float level,bool fine){
 float cell=fine?632.:572.,interior=fine?600.:540.;
 vec2 origin=vec2(mod(slot,terrainTileLayout.y),floor(slot/terrainTileLayout.y))*632.;float size=cell;
 if(level>.5){slot+=1.;origin=vec2(mod(slot,terrainTileLayout.y),floor(slot/terrainTileLayout.y))*632.;size=cell*.5;
  if(level>1.5){origin.x+=cell*.5;size=cell*.25;}
  if(level>2.5){origin.x+=cell*.25;size=ceil(cell*.125);}
  if(level>3.5){origin.x+=ceil(cell*.125);size=ceil(cell*.0625);}}
 return texture2D(terrainTileAtlas,(origin+(16.+local*interior)/cell*size)/terrainTileLayout.x).rgb;
}
vec3 terrainStreamSampleAt(vec4 entry,vec2 uv,float footprint,vec3 fallback,bool fine){
 float slot=floor(entry.r*255.+.5);
 if(slot<.5||footprint>=32.)return fallback;
 vec2 local=fract(vec2(fract(uv.x),clamp(1.-uv.y,0.,.999999))*(fine?vec2(720.,360.):vec2(40.,20.)));
 vec2 code=floor(entry.ba*255.+.5);
 vec4 neighbors=vec4(floor(code.x/16.),mod(code.x,16.),floor(code.y/16.),mod(code.y,16.))/15.;
 vec4 edge=vec4(local.x,1.-local.x,local.y,1.-local.y);
 vec4 fades=mix(neighbors,vec4(1.),smoothstep(vec4(0.),vec4(fine?.15:.03),edge));
 float fade=entry.g*fades.x*fades.y*fades.z*fades.w;
 float lod=clamp(log2(max(1.,footprint)),0.,4.);
 vec3 height=mix(terrainStreamLevel(local,slot,floor(lod),fine),terrainStreamLevel(local,slot,min(4.,floor(lod)+1.),fine),fract(lod));
 return mix(fallback,height,fade*(1.-smoothstep(20.,32.,footprint)));
}
vec3 terrainStreamSample(vec2 uv,float footprint,vec3 fallback,bool fine){
 return terrainStreamSampleAt(terrainEntry(uv,fine),uv,footprint,fallback,fine);
}
#ifdef SHARED_TERRAIN_ENTRY
// One read of each page table per height sample, shared by the sampling
// width, the coarse tile and the fine tile.
float terrainWidthFrom(vec4 fineEntry,vec4 coarseEntry){
 return fineEntry.r>0.?432000.:coarseEntry.r>0.?21600.:terrainWidth;
}
vec3 streamedTerrainEntries(vec2 uv,float footprint,vec3 fallback,vec4 fineEntry,vec4 coarseEntry,float width){
 vec3 coarse=terrainStreamSampleAt(coarseEntry,uv,footprint*21600./width,fallback,false);
 return terrainStreamSampleAt(fineEntry,uv,footprint*432000./width,coarse,true);
}
#endif
vec3 streamedTerrain(vec2 uv,float footprint,vec3 fallback){
 if(terrainTileLayout.x<1.)return fallback;
 float width=terrainSamplingWidthAt(uv);
 vec3 coarse=terrainStreamSample(uv,footprint*21600./width,fallback,false);
 return terrainStreamSample(uv,footprint*432000./width,coarse,true);
}
`;
