/** On-disk tile geometry, shared by builders and runtime. No source photometry. */
export type SurfaceLayer='night'|'day'|'cloud'|'galaxy'|'terrain'|'terrainFine';
export type TileLayout=Readonly<{columns:number;rows:number;interior:number;gutter:number;cell:number}>;
const layout=(columns:number,rows:number,interior:number):TileLayout=>{const gutter=16;return Object.freeze({columns,rows,interior,gutter,cell:interior+2*gutter});};
const surface=layout(160,80,540),sky=layout(32,16,512);
const layouts:Record<SurfaceLayer,TileLayout>={night:surface,day:surface,cloud:sky,galaxy:sky,terrain:layout(40,20,540),terrainFine:layout(720,360,600)};
export const tileDimensions=(layer:SurfaceLayer)=>layouts[layer];
export const TILE_SIZE=surface.interior,TILE_CELL=surface.cell,TILE_COLUMNS=surface.columns,TILE_ROWS=surface.rows;
export const DAY_PYRAMID_DEPTH=3;
export type TileManifest={version:number;columns:number;rows:number;interior:number;gutter:number;mipmaps?:'packed';tiles:number[]};
export function tileManifest(layer:SurfaceLayer,tiles:number[],packed=false):TileManifest{
  const {columns,rows,interior,gutter}=tileDimensions(layer);
  return {version:packed?2:1,columns,rows,interior,gutter,...(packed?{mipmaps:'packed' as const}:{}),tiles};
}
export function validateTileManifest(data:unknown,layer:SurfaceLayer):TileManifest{
  if(!data||typeof data!=='object')throw new Error('Invalid surface tile manifest');
  const d=data as TileManifest,{columns,rows,interior,gutter}=tileDimensions(layer),packed=d.mipmaps==='packed';
  // Terrain's version 1 PNGs already contain numeric mip cells. Only galaxy
  // and the VNP46 night source declare the version 2 packed-image format.
  if(d.version!==(packed?2:1)||packed!==(layer==='galaxy'||layer==='night'&&packed)||d.interior!==interior||d.gutter!==gutter||d.columns!==columns||d.rows!==rows||!Array.isArray(d.tiles)||!d.tiles.every(id=>Number.isInteger(id)&&id>=0&&id<columns*rows))throw new Error('Invalid surface tile manifest');
  return d;
}
/** Geographic addressing: longitude wraps; latitude clamps at the poles. */
export function tileAddress(layout:TileLayout,x:number,y:number){return Math.max(0,Math.min(layout.rows-1,y))*layout.columns+((x%layout.columns)+layout.columns)%layout.columns;}
/** Packed mip squares use the same sizes in builders and atlas uploads. */
export const tileMipSizes=(cell:number)=>[cell/2,cell/4,Math.ceil(cell/8),Math.ceil(cell/16)];
