import { Body, GeoVector, Illumination, MoonPhase, MakeTime, RotateVector, Rotation_EQJ_EQD, Rotation_GAL_EQJ, SiderealTime, Vector } from 'astronomy-engine';

type Vec3 = [number,number,number];
const AU_KM = 149597870.7;
const EARTH_KM = 6371;
const planets = [Body.Mercury,Body.Venus,Body.Mars,Body.Jupiter,Body.Saturn];
const tuple = (v:{x:number;y:number;z:number}):Vec3 => [v.x,v.y,v.z];
const unit = (v:Vec3):Vec3 => v.map(x=>x/Math.hypot(...v)) as Vec3;
export const transform = (m:number[],v:Vec3):Vec3 => [
  m[0]*v[0]+m[3]*v[1]+m[6]*v[2],
  m[1]*v[0]+m[4]*v[1]+m[7]*v[2],
  m[2]*v[0]+m[5]*v[1]+m[8]*v[2],
];
const galacticRotation=Rotation_GAL_EQJ();
const j2000=MakeTime(new Date('2000-01-01T12:00:00Z'));
const galacticAxes=([ [1,0,0],[0,1,0],[0,0,1] ] as Vec3[]).map(axis=>
  tuple(RotateVector(galacticRotation,new Vector(...axis,j2000))));
export const galacticBasis=(starToFixed:number[])=>galacticAxes.flatMap(axis=>transform(starToFixed,axis));

const dot=(a:number[],b:number[])=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
const cross=(a:number[],b:number[]):Vec3=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];

let phaseMinute=NaN;
let phaseLight:Vec3=[0,0,0];
/** Transfer today's illuminated limb to the replay Moon, relative to celestial north.
 * Only lunar lighting uses wall time; the orbit, sky positions and sunrise stay in replay time.
 */
export function currentLunarLight(date:Date,moon:number[],starToFixed:number[]):Vec3 {
  const minute=Math.floor(date.getTime()/60000);
  if(minute!==phaseMinute){
    const illumination=Illumination(Body.Moon,new Date(minute*60000));
    const direction=unit(tuple(illumination.gc));
    const sunlight=unit(tuple(illumination.hc).map(x=>-x) as Vec3);
    const east=unit(cross([0,0,1],direction));
    const north=unit(cross(direction,east));
    phaseLight=[dot(sunlight,east),dot(sunlight,north),dot(sunlight,direction)];
    phaseMinute=minute;
  }
  const direction=moon.slice(0,3);
  const pole=transform(starToFixed,[0,0,1]);
  const east=unit(cross(pole,direction));
  const north=unit(cross(direction,east));
  return unit(direction.map((v,i)=>east[i]*phaseLight[0]+north[i]*phaseLight[1]+v*phaseLight[2]) as Vec3);
}

export const currentLunarPhase = (date:Date) => MoonPhase(date);
/** User-controlled phase cycle: new -> waxing -> full -> waning -> new.
 * Only the illumination changes; position, angular radius and occultation stay fixed.
 */
export function lunarPhaseLight(degrees:number,moon:number[],starToFixed:number[]):Vec3 {
  const direction=unit(moon.slice(0,3) as Vec3);
  const east=unit(cross(transform(starToFixed,[0,0,1]),direction));
  const angle=degrees*Math.PI/180;
  return direction.map((v,i)=>v*Math.cos(angle)-east[i]*Math.sin(angle)) as Vec3;
}

export const LUNAR_SAMPLE_COUNT=128;
export function lunarSamples(moon:number[],sun:Vec3,basis:number[],camera:Vec3) {
  const direction=moon.slice(0,3),right=basis.slice(0,3);
  const tangent=unit(right.map((x,i)=>x-direction[i]*dot(right,direction)) as Vec3);
  const up=unit(cross(direction,tangent));
  const samples:number[]=[];
  for(let i=0;i<LUNAR_SAMPLE_COUNT;i++){
    const radius=Math.sqrt((i+.5)/LUNAR_SAMPLE_COUNT),angle=i*2.399963229728653;
    const x=radius*Math.cos(angle),y=radius*Math.sin(angle),z=Math.sqrt(1-radius*radius);
    const normal=tangent.map((v,k)=>v*x+up[k]*y-direction[k]*z);
    const ray=unit(direction.map((v,k)=>v+(tangent[k]*x+up[k]*y)*moon[3]) as Vec3);
    const b=dot(camera,ray),blocked=b<0&&b*b-dot(camera,camera)+1>0;
    samples.push(...ray,blocked?0:Math.max(0,dot(normal,sun))/LUNAR_SAMPLE_COUNT);
  }
  return samples;
}

// Catalog stars are J2000; SGP4 is TEME. Convert each through its own sidereal
// convention into Earth-fixed coordinates, rather than equating the two frames.
const frameCache = new Map<number,{starToFixed:number[];sun:Vec3}>();
export function equatorialFrame(date:Date) {
  const key=date.getTime(),cached=frameCache.get(key);
  if(cached)return cached;
  const time=MakeTime(date);
  const rotation=Rotation_EQJ_EQD(time);
  const angle=SiderealTime(date)*Math.PI/12; // Greenwich apparent sidereal time
  const c=Math.cos(angle),s=Math.sin(angle);
  const starToFixed=[ [1,0,0],[0,1,0],[0,0,1] ].flatMap(axis=>{
    const v=RotateVector(rotation,new Vector(axis[0],axis[1],axis[2],time));
    return [c*v.x+s*v.y,-s*v.x+c*v.y,v.z];
  });
  const sun=unit(transform(starToFixed,tuple(GeoVector(Body.Sun,date,true))));
  const frame={starToFixed,sun};
  if(frameCache.size>=4)frameCache.delete(frameCache.keys().next().value!);
  frameCache.set(key,frame);
  return frame;
}

let ephemerisTime=NaN;
let ephemerides:{vector:Vec3;magnitude:number}[]=[];
export function celestialFrame(date:Date,camera:Vec3) {
  const {starToFixed,sun}=equatorialFrame(date);
  // Planetary motion within a second is far below a pixel; observer position
  // and terrestrial rotation still update every rendered frame.
  const second=Math.floor(date.getTime()/1000);
  if(second!==ephemerisTime){
    ephemerisTime=second;
    const sample=new Date(second*1000);
    ephemerides=[Body.Moon,...planets].map(body=>({
      vector:tuple(GeoVector(body,sample,true)),magnitude:Illumination(body,sample).mag,
    }));
  }
  const objects=ephemerides.map(({vector,magnitude})=>{
    const fixed=transform(starToFixed,vector);
    const relative=fixed.map((x,i)=>x-camera[i]*EARTH_KM/AU_KM) as Vec3;
    return {direction:unit(relative),distance:Math.hypot(...relative)*AU_KM,magnitude};
  });
  const moon=objects[0];
  return {
    starToFixed,sun,galacticBasis:galacticBasis(starToFixed),
    yearsSinceJ2000:(date.getTime()-Date.UTC(2000,0,1,12))/(365.25*86400_000),
    moon:[...moon.direction,Math.asin(1737.4/moon.distance)],
    planets:objects.slice(1).flatMap(body=>[...body.direction,body.magnitude]),
  };
}
