import { equatorialFrame } from './celestial-sky.ts';
import { json2satrec, propagate, gstime, eciToEcf, eciToGeodetic } from 'satellite.js';
import elements from '../data/iss-orbit.json' with { type: 'json' };

export type Vec3 = [number,number,number];
export const EARTH_RADIUS_KM = 6371;
export const ISS_PERIOD_SECONDS = 86400 / elements.MEAN_MOTION;
export const START_DATE = new Date(Date.parse(elements.EPOCH+'Z')+3300_000);

// The Moon clears the limb around t=1043: about 4 seconds into 10x playback.
export const DEFAULT_SCENE_SECONDS = 1000;

/** Repeatable opening composition; explicit frame links retain their timestamp. */
export function initialSceneSeconds(params: URLSearchParams) {
  const value=params.get('t');
  const seconds=value?.trim() ? Number(value) : NaN;
  if(Number.isFinite(seconds) && Number.isFinite(new Date(START_DATE.getTime()+seconds*1000).getTime())) return seconds;
  return DEFAULT_SCENE_SECONDS;
}

export const dot = (a:Vec3,b:Vec3) => a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
export const scale = (a:Vec3,s:number):Vec3 => [a[0]*s,a[1]*s,a[2]*s];
export const add = (a:Vec3,b:Vec3):Vec3 => [a[0]+b[0],a[1]+b[1],a[2]+b[2]];
export const normalize = (a:Vec3):Vec3 => scale(a,1/Math.hypot(...a));
export const cross = (a:Vec3,b:Vec3):Vec3 => [a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const vector = (a:{x:number;y:number;z:number}):Vec3 => [a.x,a.y,a.z];
if (elements.EPHEMERIS_TYPE !== 0 || elements.CLASSIFICATION_TYPE !== 'U') throw new Error('ISS snapshot requires unclassified SGP4 mean elements');
const satrec = json2satrec({...elements,EPHEMERIS_TYPE:0,CLASSIFICATION_TYPE:'U'});

export type CameraView = { yaw:number; pitch:number };

function physicalFrame(seconds:number, limbHeight=.138, view?:CameraView, altitudeLift=0) {
  const date = new Date(START_DATE.getTime()+seconds*1000);
  const state = propagate(satrec,date);
  if (!state) throw new Error(`ISS propagation failed (${satrec.error})`);
  const radial = normalize(vector(state.position));
  const velocity = vector(state.velocity);
  const along = normalize(add(velocity,scale(radial,-dot(velocity,radial))));
  const orbitRight = normalize(cross(along,radial));
  // Yaw around local vertical keeps the horizon level even when looking aft.
  const yaw=(view?.yaw ?? 0)*Math.PI/180;
  const heading=add(scale(along,Math.cos(yaw)),scale(orbitRight,Math.sin(yaw)));
  const right=add(scale(orbitRight,Math.cos(yaw)),scale(along,-Math.sin(yaw)));
  // Camera pitch sets the central limb height while retaining the LVLH frame.
  const distance = Math.hypot(...vector(state.position))/EARTH_RADIUS_KM;
  const defaultPitch = Math.acos(1/distance)-Math.atan((.5-limbHeight)/1.25);
  const pitch=Math.max(-Math.PI/2,Math.min(Math.PI/2,defaultPitch-(view?.pitch ?? 0)*Math.PI/180));
  const forward = add(scale(heading,Math.cos(pitch)),scale(radial,-Math.sin(pitch)));
  const up = normalize(cross(right,forward));
  const gmst = gstime(date);
  const fixed = (v:Vec3) => vector(eciToEcf({x:v[0],y:v[1],z:v[2]},gmst));
  const {sun} = equatorialFrame(date);
  const camera = scale(vector(eciToEcf(state.position,gmst)),1/EARTH_RADIUS_KM);
  // Scroll moves the virtual observer, never the propagated ISS or its
  // attitude. Terrain, atmosphere and celestial occultation share this origin.
  const liftedCamera=scale(camera,1+Math.max(0,altitudeLift)/(distance*EARTH_RADIUS_KM));
  const cameraDistance=Math.hypot(...liftedCamera);
  const solar = dot(normalize(camera),sun);
  const location = eciToGeodetic(state.position,gmst);
  return {
    date, right, up, forward,
    camera:liftedCamera,
    cameraBasis: [...fixed(right),...fixed(up),...fixed(forward)],
    sun, solar,
    shadow: solar<-Math.sqrt(1-1/(cameraDistance*cameraDistance)) ? 1 : 0,
    latitude:location.latitude*180/Math.PI,longitude:location.longitude*180/Math.PI,
    altitude:location.height,
  };
}

export function issFrame(seconds:number, limbHeight=.138, view?:CameraView, altitudeLift=0) {
  const frame = physicalFrame(seconds,limbHeight,view,altitudeLift);
  const phase = frame.solar > .08 ? 'Day' : frame.solar < -.12 ? 'Night' :
    physicalFrame(seconds+10).solar > frame.solar ? 'Dawn' : 'Dusk';
  return {...frame,phase};
}
