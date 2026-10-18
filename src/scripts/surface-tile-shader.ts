import {tileDimensions as dimensions,type SurfaceLayer as Layer} from './tile-layout.ts';

/** VNP46 tile codes store the Black Marble display value divided by this range. */
export const VNP46_DISPLAY_RANGE=2.88;

function tileShader(layer:Layer){
  const {columns,rows,interior,cell}=dimensions(layer);
  const valueType=layer==='day'||layer==='galaxy'||layer==='terrain'?'vec3':'float';
  const channel=layer==='day'||layer==='galaxy'||layer==='terrain'?'rgb':'r';
  // Terrain packs height bytes, and clouds are sampled along every view ray.
  const magnify=layer==='night'||layer==='day'||layer==='galaxy';
  // Emits code for the tile texels per independent source sample: 2 for the
  // 30" Black Marble 2016 plates (see the note below), 1 for VNP46A4 radiance
  // (lab, nightDetail=vnp46), which has independent 15" samples.
  const spaced=(code:(spacing:number)=>string)=>layer==='night'?`\n#ifdef NIGHT_VNP46\n${code(1)}\n#else\n${code(2)}\n#endif\n`:code(1);
  // Code only the measured clouds (cloudStudy=global) compile; the plates' cloud
  // tiles keep their bilinear magnification.
  const measured=(code:string)=>layer==='cloud'?`\n#ifdef CLOUD_PROPERTIES\n${code}\n#endif\n`:'';
  const smoothSource=`${valueType} ${layer}Smooth(vec2 local,float slot){
  ${spaced(spacing=>`vec2 t=${spacing>1?`${layer}Origin(slot+1.)+vec2(8.)+local*${interior/2}.`:`${layer}Origin(slot)+vec2(16.)+local*${interior}.`}-.5;`)}
  vec2 i=floor(t),f=t-i,g=f*f,c=g*f;
  vec2 w0=(1.-3.*f+3.*g-c)/6.,w1=(4.-6.*g+3.*c)/6.,w3=c/6.;
  vec2 a=w0+w1,b=1.-a;
  vec2 p0=(i-.5+w1/a)/${layer}TileLayout.x,p1=(i+1.5+w3/b)/${layer}TileLayout.x;
  return a.y*(a.x*texture2D(${layer}TileAtlas,p0).${channel}+b.x*texture2D(${layer}TileAtlas,vec2(p1.x,p0.y)).${channel})
        +b.y*(a.x*texture2D(${layer}TileAtlas,vec2(p0.x,p1.y)).${channel}+b.x*texture2D(${layer}TileAtlas,p1).${channel});
}
`;
  return `
uniform sampler2D ${layer}TileAtlas;
uniform vec2 ${layer}TileLayout;
vec2 ${layer}Origin(float slot){return vec2(mod(slot,${layer}TileLayout.y),floor(slot/${layer}TileLayout.y))*${cell}.;}
float ${layer}Fade(vec2 key){
  key=vec2(mod(key.x+${columns}.,${columns}.),clamp(key.y,0.,${rows-1}.));
  return texture2D(${layer}TileAtlas,(key+vec2(.5,${rows+.5}))/${layer}TileLayout.x).r;
}
${valueType} ${layer}Level(vec2 local,float slot,float level){
  vec2 origin=${layer}Origin(slot);
  float size=${cell}.;
  if(level>.5){
    origin=${layer}Origin(slot+1.);
    size=${cell/2}.;
    if(level>1.5){origin.x+=${cell/2}.;size=${cell/4}.;}
    if(level>2.5){origin.x+=${cell/4}.;size=${Math.ceil(cell/8)}.;}
    if(level>3.5){origin.x+=${Math.ceil(cell/8)}.;size=${Math.ceil(cell/16)}.;}
  }
  vec2 p=origin+(vec2(16.)+local*${interior}.)/${cell}.*size;
  return texture2D(${layer}TileAtlas,p/${layer}TileLayout.x).${channel};
}
${magnify?`
// Magnified source grid as a cubic B-spline from four bilinear taps. A
// bilinear ramp between contrasting texels, through the tone curve and the
// camera's clip, reads as a square. The kernel is positive and sums to one:
// no ringing around clipped city cores, no detail beyond the source's own
// resolution. Black Marble's 15" plates repeat each 30" value in 2 x 2 blocks
// aligned to the tile, so night lights interpolate their level 1 instead;
// VNP46A4 tiles (lab) have independent 15" samples and use level 0.
${smoothSource}`:measured(`// Measured clouds (cloudStudy=global) magnify their 2.4 km opacity the same
// way: bilinear ramps between texels read as squares through -log(1 - R)
// and the lighting once a texel spans tens of pixels.
${smoothSource}`)}
// Explicit trilinear filtering of isolated mip levels; magnify > 0 only while
// magnifying, where lod is zero.
${valueType} ${layer}Sample(vec2 local,float slot,float lod,float magnify){
  ${valueType} light=magnify<1.?${layer}Level(local,slot,floor(lod)):${valueType}(0.);
  ${magnify?`if(magnify>0.)light=mix(light,${layer}Smooth(local,slot),magnify);`:measured(`  if(magnify>0.)light=mix(light,${layer}Smooth(local,slot),magnify);`)}
  if(fract(lod)>0.)light=mix(light,${layer}Level(local,slot,min(4.,floor(lod)+1.)),fract(lod));
  return light;
}
${layer==='day'||layer==='cloud'?`
${valueType} ${layer}Neighbor(vec2 key,vec2 local,float lod,float magnify,${valueType} fallback){
 if(key.y<0.||key.y>=${rows}.)return fallback;
 key=vec2(mod(key.x+${columns}.,${columns}.),clamp(key.y,0.,${rows-1}.));
 float slot=floor(texture2D(${layer}TileAtlas,(key+.5)/${layer}TileLayout.x).r*255.+.5);
 if(slot<.5||${layer}Fade(key)<=0.)return fallback;
 return ${layer}Sample(local,slot,lod,magnify);
}
`:''}
${layer==='night'?`#ifdef NIGHT_VNP46
// Lab, nightDetail=vnp46: tiles carry VNP46A4 radiance L (nW cm^-2 sr^-1) on
// Black Marble 2016's display scale, which the overview, uplight and city curve
// expect: e = 0.357 ln(1 + (L/1.564)^4.567)/4.567, fitted to co-located 30"
// blocks of all 540 granules (scripts/vnp46-transfer.py), stored as e/2.88.
// That is a soft toe and then 0.357 ln(L/1.564), 1 near 26 nW where the 2016
// plates saturate, and up to ~5000 nW for nightRange=extended. Interpolating
// a log radiance code instead drew dark gaps as hard-edged holes: the toe
// keeps half of a dark-to-lit ramp black. The prepacked mips are area means
// of the value with the 2016 ceiling, as is the overview.
float nightVnp46Encoded(float code){
  float encoded=code*${VNP46_DISPLAY_RANGE};
#ifdef NIGHT_VNP46_EXTENDED
  return encoded;
#else
  return min(1.,encoded);
#endif
}
#endif
`:''}
${valueType} detailed${layer==='night'?'Night':layer==='day'?'Day':layer==='galaxy'?'Galaxy':layer==='terrain'?'Terrain':'Cloud'}(vec2 uv,float footprint,${valueType} fallback) {
  if(${layer}TileLayout.x<1. || footprint>=${layer==='cloud'||layer==='galaxy'?'4.':'32.'})return fallback;
  vec2 grid=vec2(fract(uv.x),clamp(1.-uv.y,0.,.999999))*vec2(${columns}.,${rows}.);
  vec2 key=floor(grid);
  float slot=floor(texture2D(${layer}TileAtlas,(key+.5)/${layer}TileLayout.x).r*255.+.5);
  if(slot<.5)return fallback;
  float fade=${layer}Fade(key);
  vec2 local=fract(grid);
  // Each shared edge uses the same pair of fades on both sides. A single
  // minimum over all neighbours creates seams when an unrelated edge is empty.
  vec2 edge=smoothstep(vec2(0.),vec2(.03),min(local,1.-local));
  vec2 stepTo=vec2(local.x<.5?-1.:1.,local.y<.5?-1.:1.);
  if(edge.x<1.)fade*=mix(${layer}Fade(key+vec2(stepTo.x,0.)),1.,edge.x);
  if(edge.y<1.)fade*=mix(${layer}Fade(key+vec2(0.,stepTo.y)),1.,edge.y);
  // At corners all four tiles must agree, including the diagonal neighbour.
  if(edge.x<1.&&edge.y<1.)fade*=mix(${layer}Fade(key+stepTo),1.,max(edge.x,edge.y));
  float lod=clamp(log2(max(1.,footprint*${layer==='cloud'||layer==='galaxy'||layer==='terrain'?'1.':'.5'})),0.,4.);
  // At four source texels the cloud overview resolves this footprint already.
  // Mip gutters contain actual neighboring geography, including across the
  // NASA source plates. Smoothing reaches full weight at two pixels per
  // source sample.
  ${magnify?spaced(spacing=>`float magnify=1.-smoothstep(${(spacing*.5).toFixed(1)},${spacing.toFixed(1)},footprint);`):layer==='cloud'?'\n#ifdef CLOUD_PROPERTIES\n  float magnify=1.-smoothstep(.5,1.,footprint);\n#else\n  float magnify=0.;\n#endif\n':'float magnify=0.;'}
  ${valueType} light=${layer}Sample(local,slot,lod,magnify);
  ${layer==='day'||layer==='cloud'?`
  // Independently compressed photos disagree even when both tiles are loaded.
  // Average the SAME geography from their existing overlap, symmetrically at
  // edges/corners. Keep the filter inside the coarsest sampled mip's gutter.
  float band=(16.-.5*exp2(ceil(lod)))/${interior}.;
  vec2 blend=.5*(1.-smoothstep(vec2(0.),vec2(band),min(local,1.-local)));
  if(blend.x>0.||blend.y>0.){
    ${valueType} horizontal=light,vertical=light,diagonal=light;
    if(blend.x>0.)horizontal=${layer}Neighbor(key+vec2(stepTo.x,0.),local-vec2(stepTo.x,0.),lod,magnify,light);
    if(blend.y>0.)vertical=${layer}Neighbor(key+vec2(0.,stepTo.y),local-vec2(0.,stepTo.y),lod,magnify,light);
    if(blend.x>0.&&blend.y>0.)diagonal=${layer}Neighbor(key+stepTo,local-stepTo,lod,magnify,light);
    light=mix(mix(light,horizontal,blend.x),mix(vertical,diagonal,blend.x),blend.y);
  }
  `:''}
  ${layer==='night'?'#ifdef NIGHT_VNP46\n  light=nightVnp46Encoded(light);\n#endif':''}
  return mix(fallback,light,fade*(1.-smoothstep(${layer==='cloud'||layer==='galaxy'?'2.5,4.':'20.,32.'},footprint)));
}
`;
}
export const terrainTileShader=tileShader('terrain');
export const galaxyTileShader=tileShader('galaxy');
export const nightTileShader=tileShader('night');
export const dayTileShader=tileShader('day');
export const cloudTileShader='#ifdef CLOUD_TILES\n'+tileShader('cloud')+'\n#else\nfloat detailedCloud(vec2 uv,float footprint,float fallback){return fallback;}\n#endif\n';
