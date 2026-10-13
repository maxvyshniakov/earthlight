// Lattice values for the scene's value noise, precomputed once. Each texel
// holds the four corners of one lattice cell, so a noise sample needs two
// nearest-texel reads instead of eight permutation hashes. Values are the
// shader's latticeHash rounded to 8 bits; shared corners stay identical.
export const NOISE_TABLE_SIZE=289,NOISE_TABLE_UNIT=13;
const permute=(x:number)=>((34*x+1)*x)%NOISE_TABLE_SIZE;
export function latticeValue(x:number,y:number){return permute(permute(x)+y)/NOISE_TABLE_SIZE;}
export function noiseTableData(){
 const n=NOISE_TABLE_SIZE,data=new Uint8Array(n*n*4);
 for(let y=0;y<n;y++)for(let x=0;x<n;x++){
  const i=(y*n+x)*4,x1=(x+1)%n,y1=(y+1)%n;
  data[i]=Math.round(latticeValue(x,y)*255);data[i+1]=Math.round(latticeValue(x1,y)*255);
  data[i+2]=Math.round(latticeValue(x,y1)*255);data[i+3]=Math.round(latticeValue(x1,y1)*255);
 }
 return data;
}
export const noiseTableShader=`
uniform sampler2D noiseTable;
vec4 noiseCorners(vec2 q){
  q=mod(q,${NOISE_TABLE_SIZE}.);q-=${NOISE_TABLE_SIZE}.*step(${NOISE_TABLE_SIZE}.,q);
  return texture2D(noiseTable,(q+.5)/${NOISE_TABLE_SIZE}.);
}
float noise(vec3 p) {
  vec3 i=floor(p),f=fract(p);
  f=f*f*(3.-2.*f);
  vec2 q=i.xy+vec2(37.,17.)*i.z;
  vec4 a=noiseCorners(q),b=noiseCorners(q+vec2(37.,17.));
  return mix(mix(mix(a.x,a.y,f.x),mix(a.z,a.w,f.x),f.y),mix(mix(b.x,b.y,f.x),mix(b.z,b.w,f.x),f.y),f.z);
}
`;
