// Conservative regional terrain maxima for empty-space skipping. Every height
// a shader sample can return (global map, ETOPO tiles, DEM90 tiles, their mips
// and bilinear neighbours) is at most the stored value of its 3 x 3 window.
// Values only rise, so a stale or partial table is still a valid upper bound.
export const BOUND_COLUMNS=720,BOUND_ROWS=360,BOUND_METRES=40;
// Stored in the otherwise unused first atlas row, beside the page tables.
export const boundLevels=[[800,0,720,360],[800,360,360,180],[1160,360,180,90],[1340,360,90,45],[1430,360,45,23]] as const;
/** Byte code for a packed height (8 m units). Zero means unknown; 255 means
 * higher than the 9 km terrain shell, i.e. no useful bound. */
export function boundCode(units:number){return Math.min(255,Math.ceil(units*8/BOUND_METRES)+1);}
export function boundMetres(code:number){return code?(code-1)*BOUND_METRES:Infinity;}

/** Level-0 codes for the decoded global map. Rows count from the north, as in
 * the tile page tables; texture row y samples v=(y+.5)/height. */
export function terrainBoundGrid(data:Uint8Array,width:number,height:number,channels=3){
 const grid=new Uint8Array(BOUND_COLUMNS*BOUND_ROWS),columns=new Uint16Array(width);
 for(let x=0;x<width;x++)columns[x]=Math.floor((x+.5)/width*BOUND_COLUMNS);
 for(let y=0;y<height;y++){
  const row=Math.min(BOUND_ROWS-1,Math.floor((1-(y+.5)/height)*BOUND_ROWS))*BOUND_COLUMNS;
  for(let x=0,i=y*width*channels;x<width;x++,i+=channels){
   const code=boundCode(data[i]*256+data[i+1]),cell=row+columns[x];
   if(code>grid[cell])grid[cell]=code;
  }
 }
 return grid;
}
/** Highest packed height in the full-resolution square of a DEM90 patch,
 * including its gutters. Coarser mip squares are averages of these values. */
export function patchMaximum(pixels:Uint8Array,cell:number){
 let peak=0;
 for(let y=0;y<cell;y++)for(let x=0,i=y*cell*8;x<cell;x++,i+=4){const v=pixels[i]*256+pixels[i+1];if(v>peak)peak=v;}
 return peak;
}
/** Per-cell maxima of an ETOPO tile's full-resolution square (RGBA rows of
 * `cell` pixels). Each cell also covers one pixel of filter reach. */
export function tileCellMaxima(pixels:Uint8Array|Uint8ClampedArray,cell=572,interior=540,gutter=16,cells=18){
 const size=interior/cells,maxima=new Uint16Array(cells*cells);
 for(let cy=0;cy<cells;cy++)for(let cx=0;cx<cells;cx++){
  let peak=0;
  const x0=Math.max(0,gutter+cx*size-1),x1=Math.min(cell,gutter+(cx+1)*size+1);
  const y0=Math.max(0,gutter+cy*size-1),y1=Math.min(cell,gutter+(cy+1)*size+1);
  for(let y=y0;y<y1;y++)for(let x=x0,i=(y*cell+x)*4;x<x1;x++,i+=4){const v=pixels[i]*256+pixels[i+1];if(v>peak)peak=v;}
  maxima[cy*cells+cx]=peak;
 }
 return maxima;
}

/** Five max-pyramid levels, each stored after a 3 x 3 dilation. */
export class TerrainBound {
 readonly maxima=boundLevels.map(([,,w,h])=>new Uint8Array(w*h));
 readonly dilated=boundLevels.map(([,,w,h])=>new Uint8Array(w*h));
 private dirty=boundLevels.map(()=>[Infinity,-Infinity]);
 ready=false;
 cells=0;
 raise(column:number,row:number,code:number,level=0){
  if(level>=boundLevels.length)return;
  const [,,width,height]=boundLevels[level],cell=row*width+column;
  if(code<=this.maxima[level][cell])return;
  if(!level&&!this.maxima[0][cell])this.cells++;
  this.maxima[level][cell]=code;
  const dilated=this.dilated[level],dirty=this.dirty[level];
  for(let dy=-1;dy<=1;dy++){
   const y=row+dy;if(y<0||y>=height)continue;
   for(let dx=-1;dx<=1;dx++){const i=y*width+(column+dx+width)%width;if(code>dilated[i])dilated[i]=code;}
   dirty[0]=Math.min(dirty[0],y);dirty[1]=Math.max(dirty[1],y);
  }
  this.raise(column>>1,row>>1,code,level+1);
 }
 raiseGrid(grid:Uint8Array){
  for(let i=0;i<grid.length;i++)if(grid[i])this.raise(i%BOUND_COLUMNS,Math.floor(i/BOUND_COLUMNS),grid[i]);
  this.ready=true;this.invalidate();
 }
 /** A newly allocated atlas region is zero, which the shader treats as unknown. */
 invalidate(){for(const [level,[,,,height]] of boundLevels.entries())this.dirty[level]=[0,height-1];}
 /** Upload changed rows. Nothing is written before the global map supplies
 * its maxima: tiles alone are not an upper bound for their fallback. */
 flush(upload:(x:number,y:number,width:number,height:number,data:Uint8Array)=>void){
  if(!this.ready)return 0;
  let written=0;
  for(const [level,[x,y,width]] of boundLevels.entries()){
   const [first,last]=this.dirty[level];if(first>last)continue;
   const rows=last-first+1,data=new Uint8Array(width*rows*4),source=this.dilated[level];
   for(let i=0;i<width*rows;i++){data[i*4]=source[first*width+i];data[i*4+3]=255;}
   upload(x,y+first,width,rows,data);written+=width*rows;
   this.dirty[level]=[Infinity,-Infinity];
  }
  return written;
 }
}

const levelTable=boundLevels.map(([x,y,w,h],i)=>i<boundLevels.length-1?` if(level<${i}.5)return vec4(${x}.,${y}.,${w}.,${h}.);`:` return vec4(${x}.,${y}.,${w}.,${h}.);`).join('\n');
// Requires terrainTileAtlas/terrainTileLayout and earthUV. Returns the highest
// terrain (Earth radii) any sample within `margin` radians of the great-circle
// track a-b can read, or -1 when no conservative bound is available.
export const terrainBoundShader=`
vec4 terrainBoundLevel(float level){
${levelTable}
}
float terrainTrackBound(vec3 a,vec3 b,float margin){
 if(terrainTileLayout.x<1.)return -1.;
 vec3 m=normalize(a+b);
 float polar=max(max(abs(a.z),abs(b.z)),abs(m.z));
 if(polar>.98)return -1.;
 vec2 ua=earthUV(a),ub=earthUV(b),um=earthUV(m);
 float du=max(abs(fract(ub.x-ua.x+.5)-.5),abs(fract(um.x-ua.x+.5)-.5));
 float dv=max(abs(ub.y-ua.y),abs(um.y-ua.y));
 // Longitude cells narrow with latitude. A quarter cell absorbs the arc's
 // small poleward bulge and floating-point cell assignment at boundaries.
 float span=max((du+margin/(6.283185307*sqrt(1.-polar*polar)))*${BOUND_COLUMNS}.,(dv+margin/3.141592654)*${BOUND_ROWS}.)+.25;
 float level=ceil(log2(max(1.,span)));
 if(level>${boundLevels.length-1}.)return -1.;
 vec4 table=terrainBoundLevel(level);
 vec2 cell=min(floor(vec2(fract(ua.x),clamp(1.-ua.y,0.,.999999))*vec2(${BOUND_COLUMNS}.,${BOUND_ROWS}.)/exp2(level)),table.zw-1.);
 float code=floor(texture2D(terrainTileAtlas,(table.xy+cell+.5)/terrainTileLayout.x).r*255.+.5);
 return code<.5?-1.:(code-1.)*${BOUND_METRES}./6371000.;
}
`;
