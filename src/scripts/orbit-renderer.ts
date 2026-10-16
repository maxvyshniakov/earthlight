import {cropTextureBitmap} from './texture-bitmap.ts';
import {assetURL,type SceneSources} from './asset-location';
import {shaderDerivatives,shaderLod,textureImage2D,textureSubImage2D} from './webgl-context.ts';
import {ShaderProgramBatch} from './shader-programs';
import {textureProfile} from './texture-profile';
import {CloudBuffer} from './cloud-buffer';
import {CloudLightingAtlas, cloudLightingSource} from './cloud-lighting';
import {OceanField,oceanPrototype,oceanPrototypeSource} from './ocean-prototype';
import {WorldBuffer} from './world-buffer';
import { SceneWork, scenePriority } from './scene-work';
import { Aurora } from './aurora';
import { stormLights } from './storm-light';
import { SOLAR_RADIUS } from './solar-light';
import { CameraFinish } from './camera-finish';
import { issFrame } from './iss-orbit';
import { celestialFrame, currentLunarLight, lunarSamples } from './celestial-sky';
import { CatalogStars } from './catalog-stars';
import { decodeStarCatalog } from './star-pack';
import { optics } from './optical-psf';
import { SurfaceTiles } from './night-tiles';
import { TerrainStream } from './terrain-stream';
import type { decodeTerrain } from './earth-terrain';
import { visibleSourceDisk } from './lens-reflections';
import { configureSceneColor } from './scene-color';
import { PointReflections } from './point-reflections';
import { SceneTimer } from './scene-quality';
import { sceneProfile } from './scene-profile';
import {auroraEnabled,auroraMode,cloudMode} from './scene-effects';
import { SceneAssets, sceneAssetPlan, type AssetPlan } from './scene-assets';
import { sceneBufferSize, compactSurfaceOverview } from './scene-viewport';
import { NOISE_TABLE_SIZE, NOISE_TABLE_UNIT, noiseTableData } from './noise-table';
import { TemporalClouds, temporalCloudMain, temporalResolveFragment, temporalCompositeShader, TEMPORAL_FRESH_UNITS, TEMPORAL_HISTORY_UNITS, TEMPORAL_PREVIOUS_UNIT, TEMPORAL_RESOLVED_UNITS } from './cloud-temporal';
import { vertexSource, fragmentSource, sourceTransmissionFragment, volumeFragment, halfCloudFragment, halfCloudVolumeFragment } from './orbital-shader';

export type SceneLook={galaxy:number;grain:number;chromatic:number;ghosts:number;exposure:number;manualExposure?:number|null};
/** Owns the WebGL resources and passes; never reads or mutates page controls. */
export function createOrbitRenderer(gl:WebGLRenderingContext,canvas:HTMLCanvasElement,params:URLSearchParams,notify:()=>void,sources:SceneSources={}) {
    const base=sources.assetBaseURL;
    const background=!!sources.background;
    // Opt-in terrain inspection, independent of photographic exposure/effects.
    const terrainView=['clay','color','albedo'].indexOf(params.get('terrainView')??'')+1;
    const terrainSun=(params.get('terrainSun')??'').split(',').map(Number);
    const diagnosticSun=terrainSun.length===2&&terrainSun.every(Number.isFinite)
      ?terrainSun.map((v,i)=>i?Math.max(-90,Math.min(90,v)):((v%360)+360)%360):null;
    const terrainHeader=terrainView?`#define TERRAIN_VIEW ${terrainView}\n${diagnosticSun?`#define TERRAIN_SUN vec2(${diagnosticSun.map(v=>v.toFixed(4)).join(',')})\n`:''}`:'';
    const profile=sceneProfile(params);
    const clouds=cloudMode(params);
    const requestedOcean=oceanPrototype(params);
    const oceanMode=requestedOcean&&OceanField.supported(gl)?requestedOcean:null;
    let oceanField:OceanField|null=null;
    const compactWorld=['compact','clouds-half'].includes(profile.name);
    const separateVolume=!terrainView&&['split','compact','clouds-half'].includes(profile.name)&&WorldBuffer.supported(gl,compactWorld);
    const textureLighting=clouds!=='off'&&separateVolume&&profile.name==='compact'&&params.get('cloudLighting')!=='raymarch'
      &&!['photo','modis'].includes(params.get('cloudStudy')??'')&&CloudLightingAtlas.supported(gl);
    let cloudLighting:CloudLightingAtlas|null=null;
    let cloudBuffer:CloudBuffer|null=null,cloudProgram:WebGLProgram|null=null;
    // Lab switch: integrate clouds for alternate columns and reuse clamped history.
    let temporal:TemporalClouds|null=null,temporalCloudProgram:WebGLProgram|null=null,temporalResolveProgram:WebGLProgram|null=null;
    let temporalCloudPosition=0,temporalResolvePosition=0,disableTemporal=false;
    const temporalCloudUniforms:Record<string,WebGLUniformLocation|null>={},temporalResolveUniforms:Record<string,WebGLUniformLocation|null>={};
    let cloudPosition=0;
    let disableHalfClouds=false;
    let fallbackVolumeProgram:WebGLProgram|null=null,fallbackVolumePosition=0;
    const fallbackVolumeUniforms:Record<string,WebGLUniformLocation|null>={};
    const cloudUniforms:Record<string,WebGLUniformLocation|null>={};
    let worldBuffer:WorldBuffer|null=null,volumeProgram:WebGLProgram|null=null;
    let volumePosition=0;
    const volumeUniforms:Record<string,WebGLUniformLocation|null>={};
    const sharedLighting=profile.name==='lighting';
    const state:Record<string,string>={};
    const pointReflections=new PointReflections();
    let disposed=false,lost=false,initialized=false;
    let startupAbort:AbortController|null=null;
    let initialization:Promise<boolean>|null=null;
    let assetLoadStarted=false;
    let scenePosition=0;
    let resolution:WebGLUniformLocation|null=null,time:WebGLUniformLocation|null=null;
    const orbitUniforms:Record<string,WebGLUniformLocation|null>={};
    let program: WebGLProgram | null = null;
    let buffer: WebGLBuffer | null = null;
    let textures: WebGLTexture[] = [];
    let catalog:CatalogStars|null=null;
    let finish:CameraFinish|null=null;
    let aurora:Aurora|null=null;
    const wantsAurora=auroraEnabled(params,matchMedia('(hover: none) and (pointer: coarse)').matches);
    const supportsAurora=wantsAurora&&gl.getParameter(gl.MAX_TEXTURE_IMAGE_UNITS)>11
      &&gl.getParameter(gl.MAX_TEXTURE_SIZE)>=2048&&shaderLod(gl);
    let nightTiles:SurfaceTiles|null=null;
    let dayTiles:SurfaceTiles|null=null;
    let cloudTiles:SurfaceTiles|null=null;
    let galaxyTiles:SurfaceTiles|null=null;
    let terrainTiles:SurfaceTiles|TerrainStream|null=null;
    const saveData=(navigator as Navigator&{connection?:{saveData?:boolean}}).connection?.saveData??false;
    const streamDetail=!background&&!saveData&&gl.getParameter(gl.MAX_TEXTURE_SIZE)>=4096;
    const modisStudy=['photo','modis'].includes(params.get('cloudStudy')??'')&&gl.getParameter(gl.MAX_TEXTURE_IMAGE_UNITS)>9;
    let modisTexture:WebGLTexture|null=null;
    const supportsTerrain=!background&&gl.getParameter(gl.MAX_TEXTURE_IMAGE_UNITS)>8 && gl.getParameter(gl.MAX_TEXTURE_SIZE)>=4096;
    const supportsTerrainTiles=supportsTerrain&&streamDetail&&gl.getParameter(gl.MAX_TEXTURE_IMAGE_UNITS)>15&&params.get('terrain')!=='0'&&params.get('terrainDetail')!=='0';
    // Lab prototypes borrow the detailed galaxy sampler; its overview remains.
    const supportsGalaxyTiles=!oceanMode&&streamDetail&&gl.getParameter(gl.MAX_TEXTURE_IMAGE_UNITS)>14&&params.get('galaxyDetail')!=='0';
    const supportsCloudTiles=clouds!=='off'&&!modisStudy&&streamDetail&&gl.getParameter(gl.MAX_TEXTURE_IMAGE_UNITS)>9&&params.get('cloudDetail')!=='0';
    let starData:Float32Array|null=null;
    let psfData:Uint8Array|null=null;
    let psfTexture:WebGLTexture|null=null;
    let galaxyTexture:WebGLTexture|null=null;
    let terrainTexture:WebGLTexture|null=null;
    let noiseTexture:WebGLTexture|null=null;
    // The half-resolution cloud passes use unit 13 for cloud depth.
    const noiseTable=params.get('noise')!=='hash'&&profile.name!=='clouds-half'&&gl.getParameter(gl.MAX_TEXTURE_IMAGE_UNITS)>NOISE_TABLE_UNIT;
    const noiseHeader=noiseTable?'#define NOISE_TABLE 1\n':'';
    const supportsSourceAttenuation=gl.getParameter(gl.MAX_TEXTURE_IMAGE_UNITS)>10;
    const supportsSolarTransmission=gl.getParameter(gl.MAX_TEXTURE_IMAGE_UNITS)>12;
    let sourceTexture:WebGLTexture|null=null,sourceTarget:WebGLFramebuffer|null=null;
    let sourceProgram:WebGLProgram|null=null;
    let sourcePosition=0;
    const sourceUniforms:Record<string,WebGLUniformLocation|null>={};
    const work=new SceneWork(notify);
    // Tile constructors enqueue optional manifests before assets.start(). Keep
    // those requests from occupying every connection ahead of the previews.
    const releasePreviewNetwork=work.network.holdBelow(scenePriority.preview);
    let uploadAbort=new AbortController();
    let generation=0;
    let timer:SceneTimer|null=null;
    // Shutter fraction for camera motion blur in the explorer; `motionBlur=0`
    // turns it off and `skyBlur=0` keeps the sky sharp while Earth streaks.
    // The background camera only follows the orbit.
    const motionShutter=background?0:params.has('motionBlur')?Math.max(0,Math.min(1,Number(params.get('motionBlur'))||0)):.75;
    const skyShutter=params.get('skyBlur')!=='0';
    let previousPose:{camera:number[];basis:number[];focal:number;at:number}|null=null;
    let seededScale=1;
    const imageWidths:Record<string,number>={};
    const terrainDecodes=new Set<()=>void>();
    // Accepted work reductions; each keeps a switch back to the old path.
    const terrainBound=params.get('terrainBound')==='off'?'off':'regional';
    const decodeTerrainAsync=(blob:Blob)=>new Promise<{data:ReturnType<typeof decodeTerrain>;bound?:Uint8Array}|null>((resolve,reject)=>{
      const worker=new Worker(new URL('./terrain-decoder.worker.ts',import.meta.url),{type:'module'});
      const finish=()=>{worker.terminate();terrainDecodes.delete(cancel);};
      const cancel=()=>{finish();resolve(null);};
      terrainDecodes.add(cancel);
      worker.onmessage=event=>{finish();if(event.data.error)reject(Error(event.data.error));else resolve({data:event.data.data,bound:event.data.bound});};
      worker.onerror=event=>{finish();reject(Error(event.message||'Terrain decoding failed'));};
      worker.postMessage({blob,bound:terrainBound==='regional'});
    });
    const release = () => {
      initialized=false;startupAbort?.abort();startupAbort=null;
      uploadAbort.abort();uploadAbort=new AbortController();
      for(const cancel of terrainDecodes)cancel();
      timer?.dispose();timer=null;
      aurora?.dispose();aurora=null;
      cloudBuffer?.dispose();cloudBuffer=null;
      temporal?.dispose();temporal=null;
      if(temporalCloudProgram)gl.deleteProgram(temporalCloudProgram);temporalCloudProgram=null;
      if(temporalResolveProgram)gl.deleteProgram(temporalResolveProgram);temporalResolveProgram=null;
      cloudLighting?.dispose();cloudLighting=null;
      oceanField?.dispose();oceanField=null;
      if(fallbackVolumeProgram)gl.deleteProgram(fallbackVolumeProgram);fallbackVolumeProgram=null;
      if(cloudProgram)gl.deleteProgram(cloudProgram);cloudProgram=null;
      worldBuffer?.dispose();worldBuffer=null;
      if(volumeProgram)gl.deleteProgram(volumeProgram);volumeProgram=null;
      if(sourceProgram)gl.deleteProgram(sourceProgram);sourceProgram=null;
      if(sourceTexture)gl.deleteTexture(sourceTexture);sourceTexture=null;
      if(sourceTarget)gl.deleteFramebuffer(sourceTarget);sourceTarget=null;
      nightTiles?.dispose();nightTiles=null;
      dayTiles?.dispose();dayTiles=null;
      cloudTiles?.dispose();cloudTiles=null;
      if(modisTexture)gl.deleteTexture(modisTexture);modisTexture=null;
      galaxyTiles?.dispose();galaxyTiles=null;
      terrainTiles?.dispose();terrainTiles=null;
      if(psfTexture)gl.deleteTexture(psfTexture);
      psfTexture=null;
      if(galaxyTexture)gl.deleteTexture(galaxyTexture);
      galaxyTexture=null;
      if(terrainTexture)gl.deleteTexture(terrainTexture);
      terrainTexture=null;
      if(noiseTexture)gl.deleteTexture(noiseTexture);
      noiseTexture=null;
      finish?.dispose();
      finish=null;
      catalog?.dispose();
      catalog=null;
      textures.forEach(texture => gl.deleteTexture(texture));
      textures = [];
      if (buffer) gl.deleteBuffer(buffer);
      if (program) gl.deleteProgram(program);
      buffer = null;
      program = null;
      work.resetMotion();
    };
    const upload=async(asset:AssetPlan,blob:Blob)=>{
      const current=generation,signal=uploadAbort.signal;
      const priority=asset.preview?scenePriority.preview:scenePriority.overview;
      const submit=(job:()=>void)=>work.upload(priority,signal,job);
      try{await work.decode.run(priority,signal,async()=>{
        if(asset.key==='modis'){
          const image=await createImageBitmap(blob,{imageOrientation:'flipY',premultiplyAlpha:'none',colorSpaceConversion:'none'});
          try{
            if(disposed||lost||current!==generation||!modisTexture)return;
            await submit(()=>{
              gl.activeTexture(gl.TEXTURE9);gl.bindTexture(gl.TEXTURE_2D,modisTexture);
              textureImage2D(gl,gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,image);
              gl.generateMipmap(gl.TEXTURE_2D);
              gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR_MIPMAP_LINEAR);
              for(const pass of [program,sourceProgram,volumeProgram,cloudProgram,fallbackVolumeProgram])if(pass){
                gl.useProgram(pass);gl.uniform1f(gl.getUniformLocation(pass,'modisReady'),1);
              }
              state.modisReady='1';
            });
          }finally{image.close();}
          return;
        }
        if(asset.key==='stars'){
          const data=asset.url.endsWith('-v2.bin')?await decodeStarCatalog(blob):new Float32Array(await blob.arrayBuffer());
          if(!data.length||data.length%8||!data.every(Number.isFinite))throw Error('Invalid star catalog');
          if(disposed||lost||current!==generation)return;
          await submit(()=>{starData=data;pointReflections.upload(data);catalog?.upload(data);state.starsReady='';});return;
        }
        if(asset.key==='psf'){
          const data=new Uint8Array(await new Response(asset.url.endsWith('-v2.bin')?blob.stream().pipeThrough(new DecompressionStream('gzip')):blob).arrayBuffer());
          if(data.length!==optics.size*optics.size*optics.states*3)throw Error('Invalid optical PSF');
          if(disposed||lost||current!==generation)return;
          await submit(()=>{psfData=data;uploadPsf();});return;
        }
        if(asset.key==='terrain'){
          const decoded=await decodeTerrainAsync(blob),data=decoded?.data;
          if(!data||disposed||lost||current!==generation||!program||!terrainTexture)return;
          // Global maxima are published before this map can become ready.
          if(decoded.bound&&terrainTiles instanceof TerrainStream)terrainTiles.setGlobalBound(decoded.bound);
          for(const [i,level] of data.levels.entries()){
            await submit(()=>{
              gl.activeTexture(gl.TEXTURE8);gl.bindTexture(gl.TEXTURE_2D,terrainTexture);
              textureImage2D(gl,gl.TEXTURE_2D,i,gl.RGB,level.width,level.height,0,gl.RGB,gl.UNSIGNED_BYTE,null);
            });
            for(let y=0;y<level.height;y+=128){
              const rows=Math.min(128,level.height-y);
              await submit(()=>{
                gl.activeTexture(gl.TEXTURE8);gl.bindTexture(gl.TEXTURE_2D,terrainTexture);
                gl.pixelStorei(gl.UNPACK_ALIGNMENT,1);
                textureSubImage2D(gl,gl.TEXTURE_2D,i,0,y,level.width,rows,gl.RGB,gl.UNSIGNED_BYTE,level.data.subarray(y*level.width*3,(y+rows)*level.width*3));
                gl.pixelStorei(gl.UNPACK_ALIGNMENT,4);
              });
            }
          }
          gl.useProgram(program);gl.activeTexture(gl.TEXTURE8);gl.bindTexture(gl.TEXTURE_2D,terrainTexture);
          gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR_MIPMAP_LINEAR);
          gl.uniform1f(gl.getUniformLocation(program,'terrainWidth'),data.width);
          gl.uniform1f(gl.getUniformLocation(program,'terrainReady'),params.get('terrain')==='0'?0:1);
          state.terrainReady='';return;
        }
        const limit=gl.getParameter(gl.MAX_TEXTURE_SIZE);
        const image=await createImageBitmap(blob,{imageOrientation:'flipY'});
        try{
          if(disposed||lost||current!==generation||!program)return;
          if(image.width>limit||image.height>limit)throw Error('Texture exceeds device limit');
          if(image.width<(imageWidths[asset.key]??0))return;
          const unit={day:0,night:1,clouds:2,galaxy:5}[asset.key];
          const format=asset.key==='night'||asset.key==='clouds'?gl.LUMINANCE:gl.RGBA;
          if(!asset.preview&&image.width>=4096){
            // Convert/upload bounded strips while the existing overview stays
            // visible. A single 8K bitmap upload can block the main thread >60 ms.
            const replacement=gl.createTexture();
            if(!replacement)throw Error('Cannot allocate refined map');
            let committed=false;
            try{
              await submit(()=>{
                gl.activeTexture(gl.TEXTURE0+unit);gl.bindTexture(gl.TEXTURE_2D,replacement);
                textureImage2D(gl,gl.TEXTURE_2D,0,format,image.width,image.height,0,format,gl.UNSIGNED_BYTE,null);
                gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.REPEAT);
                gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
                gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
              });
              for(let y=0;y<image.height;y+=256){
                if(disposed||lost||current!==generation)return;
                const strip=await cropTextureBitmap(image,0,y,image.width,Math.min(256,image.height-y));
                try{
                  if(disposed||lost||current!==generation)return;
                  await submit(()=>{
                    gl.activeTexture(gl.TEXTURE0+unit);gl.bindTexture(gl.TEXTURE_2D,replacement);
                    textureSubImage2D(gl,gl.TEXTURE_2D,0,0,y,format,gl.UNSIGNED_BYTE,strip);
                  });
                }finally{strip.close();}
              }
              await submit(()=>{
                gl.activeTexture(gl.TEXTURE0+unit);gl.bindTexture(gl.TEXTURE_2D,replacement);
                gl.generateMipmap(gl.TEXTURE_2D);
              });
              const previous=unit===5?galaxyTexture:textures[unit];
              if(unit===5)galaxyTexture=replacement;else textures[unit]=replacement;
              committed=true;if(previous)gl.deleteTexture(previous);
            }finally{if(!committed)gl.deleteTexture(replacement);}
          }else{
            await submit(()=>{
              gl.activeTexture(gl.TEXTURE0+unit);
              gl.bindTexture(gl.TEXTURE_2D,unit===5?galaxyTexture:textures[unit]);
              textureImage2D(gl,gl.TEXTURE_2D,0,format,format,gl.UNSIGNED_BYTE,image);gl.generateMipmap(gl.TEXTURE_2D);
            });
          }
          gl.useProgram(program);gl.activeTexture(gl.TEXTURE0+unit);
          gl.bindTexture(gl.TEXTURE_2D,unit===5?galaxyTexture:textures[unit]);
          gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR_MIPMAP_LINEAR);
          if(maxAnisotropy&&unit!==5)gl.texParameterf(gl.TEXTURE_2D,TEXTURE_MAX_ANISOTROPY_EXT,maxAnisotropy);
          if(unit===1)gl.uniform2f(gl.getUniformLocation(program,'nightMapResolution'),image.width,image.height);
          if(unit===2)gl.uniform1f(gl.getUniformLocation(program,'cloudMapWidth'),image.width);
          if(unit===5){gl.uniform1f(gl.getUniformLocation(program,'galaxyMapWidth'),image.width);state.galaxyMapWidth=String(image.width);}
          gl.uniform1f(gl.getUniformLocation(program,'mapsReady'),1);
          imageWidths[asset.key]=image.width;
          if(asset.key==='day')state.dayMapWidth=String(image.width);
          state[asset.key==='galaxy'?'galaxyReady':'surfaceReady']='';
        }finally{image.close();}
      });}catch(error){if(!signal.aborted)throw error;}
    };
    const TEXTURE_MAX_ANISOTROPY_EXT=0x84FE;let maxAnisotropy=0;
    const uploadPsf=()=>{
      if(!psfTexture||!psfData||gl.isContextLost())return;
      gl.activeTexture(gl.TEXTURE4);gl.bindTexture(gl.TEXTURE_2D,psfTexture);
      textureImage2D(gl,gl.TEXTURE_2D,0,gl.RGB,optics.size,optics.size*optics.states,0,gl.RGB,gl.UNSIGNED_BYTE,psfData);
    };
    const initialize = async(started=performance.now()):Promise<boolean> => {
      // Query once, while the GPU queue is still empty. Asked after each map
      // upload, getParameter waited for that upload's mipmaps: seconds of
      // blocked main thread under software GL (Lighthouse, SwiftShader).
      const anisotropy=gl.getExtension('EXT_texture_filter_anisotropic');
      maxAnisotropy=anisotropy?Math.min(8,gl.getParameter(anisotropy.MAX_TEXTURE_MAX_ANISOTROPY_EXT)):0;
      const current=generation,controller=new AbortController();
      startupAbort=controller;
      const batch=new ShaderProgramBatch(gl);
      state.shaderStartup='compiling';state.shaderMode=batch.parallel?'parallel':'synchronous';state.textureProfile=textureProfile(params);
      state.shaderCompileMs='0';
      state.cloudShape=modisStudy||params.get('cloudShape')==='texture'?'texture':'current';
      state.clouds=clouds;
      state.cloudStudy=modisStudy?params.get('cloudStudy')!:'off';
      state.modisReady='0';
      state.terrainWork=params.get('terrainWork')==='legacy'?'legacy':'bounded';
      state.terrainRefinement=params.get('terrainRefinement')==='full'?'full':'pixel';
      state.cloudSteps=params.get('cloudSteps')==='full'?'full':'balanced';
      state.shaderWork=params.get('shaderWork')==='legacy'?'legacy':'lean';
      state.noise=noiseTable?'table':'hash';
      state.terrainFetch=params.get('terrainFetch')==='separate'?'separate':'shared';
      state.terrainBound=supportsTerrainTiles&&params.get('terrainDetail')!=='coarse'?terrainBound:'off';
      notify();
      try {
        if(!disableHalfClouds&&profile.name==='clouds-half'&&separateVolume&&CloudBuffer.supported(gl)){
          try{cloudBuffer=new CloudBuffer(gl);}
          catch(error){console.warn('Half-resolution clouds unavailable; retaining compact rendering.',error);}
        }
        delete state.cloudBuffer;
        if(!disableTemporal&&params.get('cloudReuse')!=='off'&&profile.name==='compact'&&separateVolume&&compactWorld&&clouds!=='off'&&TemporalClouds.supported(gl)){
          try{temporal=new TemporalClouds(gl);}
          catch(error){console.warn('Temporal clouds unavailable; retaining compact rendering.',error);}
        }
        state.cloudReuse=temporal?'temporal':'off';
        state.cloudPass=cloudBuffer?'half':profile.name==='clouds-half'?(separateVolume?'compact-fallback':'inline-fallback'):'inline';
        const cloudLod=shaderLod(gl);
        const oceanPlan=oceanMode?OceanField.prepare(batch,oceanMode):null;
        const skyGrad=cloudLod&&shaderDerivatives(gl);
        const cloudHeader=(cloudLod?'#extension GL_EXT_shader_texture_lod : enable\n#define CLOUD_EXPLICIT_LOD 1\n':'')
          +(skyGrad?'#extension GL_OES_standard_derivatives : enable\n#define SKY_EXPLICIT_GRAD 1\n':'')
          // Implicit-LOD fallbacks still need derivatives at the date line.
          +(shaderDerivatives(gl)?(skyGrad?'':'#extension GL_OES_standard_derivatives : enable\n')+'#define SKY_DERIVATIVES 1\n':'')
          +(compactWorld?'#define COMPACT_WORLD_PASS 1\n':'')
          +(sharedLighting?'#define SHARED_CLOUD_LIGHTING 1\n':'')
          +(state.terrainWork==='bounded'?'#define BOUNDED_RAY_WORK 1\n':'')
          +(state.terrainRefinement==='pixel'?'#define PIXEL_TERRAIN_REFINEMENT 1\n':'')
          +(state.cloudSteps==='balanced'?'#define BALANCED_CLOUD_STEPS 1\n':'')
          +(state.shaderWork==='lean'?'#define LEAN_SHADER_WORK 1\n':'')
          +(state.terrainFetch==='shared'?'#define SHARED_TERRAIN_ENTRY 1\n':'')
          +(clouds==='balanced'?'#define BALANCED_CLOUDS 1\n':clouds==='off'?'#define CLOUDS_DISABLED 1\n':'')
          +(modisStudy?'#define MODIS_PATCH 1\n'+(params.get('cloudStudy')==='modis'?'#define MODIS_GUIDANCE 1\n':''):'')
          +(modisStudy||params.get('cloudShape')==='texture'?'#define TEXTURE_SHAPED_CLOUDS 1\n':'');
        const skyProgram=batch.add('Orbital scene',vertexSource,cloudHeader+noiseHeader+terrainHeader+(supportsTerrainTiles?(params.get('terrainDetail')==='coarse'?'#define TERRAIN_TILES 1\n':'#define TERRAIN_STREAM 1\n'+(state.terrainBound==='regional'?'#define TERRAIN_BOUND 1\n':'')):'')+(supportsGalaxyTiles?'#define GALAXY_TILES 1\n':'')+(supportsSolarTransmission?'#define SOLAR_TRANSMISSION 1\n':'')+(supportsAurora?'#define AURORA 1\n':'')+(supportsSourceAttenuation?'#define SOURCE_ATTENUATION 1\n#define CAMERA_PUPIL_STATE 1\n':'')+(supportsCloudTiles?'#define CLOUD_TILES 1\n':'')+(supportsTerrain?'#define TERRAIN_MAP 1\n':'')+(separateVolume?'#define SEPARATE_WORLD_PASS 1\n':'')+(oceanMode?oceanPrototypeSource(fragmentSource):fragmentSource));
        const attenuationProgram=supportsSourceAttenuation?batch.add('Source transmission',vertexSource,cloudHeader+noiseHeader+(supportsCloudTiles?'#define CLOUD_TILES 1\n':'')+sourceTransmissionFragment):null;
        const lightingPlan=textureLighting?CloudLightingAtlas.prepare(batch,cloudHeader+noiseHeader+(supportsCloudTiles?'#define CLOUD_TILES 1\n':'')):null;
        const volumePlans=new Map<string,WebGLProgram>();
        const volumePasses=cloudBuffer?['cloud','volume','fallback']:temporal?['temporalCloud','volume']:['volume'];
        const temporalComposite=volumeFragment.replace('uniform sampler2D worldScene;','uniform sampler2D worldScene;\n'+temporalCompositeShader)
          .replace('color=cloudVolume(earthRay,groundDistance,color,atmosphereDistance)','color=temporalClouds(uv,earthRay,groundDistance,color,atmosphereDistance)');
        const temporalCloudSource=fragmentSource.slice(0,fragmentSource.indexOf('void main()'))+temporalCloudMain;
        const resolvePlan=temporal?batch.add('Temporal cloud resolve',vertexSource,temporalResolveFragment):null;
        if(separateVolume)for(const pass of volumePasses){
          const cloudPass=pass==='cloud',fallbackPass=pass==='fallback',temporalPass=pass==='temporalCloud';
          const header=cloudPass?'#extension GL_EXT_draw_buffers : require\n#define HALF_CLOUD_PASS 1\n':temporalPass?'#extension GL_EXT_draw_buffers : require\n':'';
          const source=cloudPass?halfCloudFragment:temporalPass?(textureLighting?cloudLightingSource(temporalCloudSource):temporalCloudSource)
            :cloudBuffer&&!fallbackPass?halfCloudVolumeFragment:temporal?temporalComposite:textureLighting?cloudLightingSource(volumeFragment):volumeFragment;
          volumePlans.set(pass,batch.add(`Orbital ${pass}`,vertexSource,header+cloudHeader+noiseHeader+(supportsSourceAttenuation?'#define CAMERA_PUPIL_STATE 1\n':'')+(supportsSolarTransmission?'#define SOLAR_TRANSMISSION 1\n':'')+(supportsAurora?'#define AURORA 1\n':'')+(supportsCloudTiles?'#define CLOUD_TILES 1\n':'')+source));
        }
        const catalogPrograms=CatalogStars.prepare(batch),cameraPrograms=CameraFinish.prepare(batch);
        const auroraPrograms=supportsAurora?Aurora.prepare(gl,batch,state.shaderWork==='lean'):undefined;
        await batch.wait(controller.signal);
        if(disposed||lost||current!==generation||controller.signal.aborted)return false;
        state.shaderCompileMs=(performance.now()-started).toFixed(2);
        state.shaderStartup='preparing';
        program=batch.take(skyProgram);
        gl.useProgram(program);
        buffer = gl.createBuffer();
        if (!buffer) throw new Error('Cannot allocate sky geometry');
        gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 3,-1, -1,3]), gl.STATIC_DRAW);
        const position = gl.getAttribLocation(program, 'position');
        gl.enableVertexAttribArray(position);
        gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
        scenePosition=gl.getAttribLocation(program,'position');
        resolution = gl.getUniformLocation(program, 'resolution');
        time = gl.getUniformLocation(program, 'time');
        for (const name of ['zoomExcess','cameraPosition','cameraBasis','sunDirection','solarTransmission','solarVisibility','moon','planets[0]','galacticBasis','pixelRatio','moonSamples[0]','starsLinear','galaxyAmount','lunarIrradiance','cameraState','stormSources[0]']) orbitUniforms[name] = gl.getUniformLocation(program,name);
        gl.uniform1f(gl.getUniformLocation(program, 'surfaceEnabled'),params.get('surface') === '0' ? 0 : 1);
        gl.uniform2f(gl.getUniformLocation(program,'nightMapResolution'),1,1);
        ['surfaceMap','nightMap','cloudMap'].forEach((name,index) => {
          const texture = gl.createTexture();
          if (!texture) throw new Error('Cannot allocate Earth map');
          textures.push(texture);
          gl.activeTexture(gl.TEXTURE0+index);
          gl.bindTexture(gl.TEXTURE_2D,texture);
          textureImage2D(gl,gl.TEXTURE_2D,0,gl.RGBA,1,1,0,gl.RGBA,gl.UNSIGNED_BYTE,new Uint8Array([0,0,0,255]));
          gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.REPEAT);
          gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
          gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);
          gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
          gl.uniform1i(gl.getUniformLocation(program!,name),index);
        });
        gl.uniform1i(gl.getUniformLocation(program,'dayTileAtlas'),0);
        if(supportsCloudTiles)gl.uniform1i(gl.getUniformLocation(program,'cloudTileAtlas'),0);
        gl.uniform1i(gl.getUniformLocation(program,'starMap'),3);
        gl.uniform1i(gl.getUniformLocation(program,'opticalPsf'),4);
        psfTexture=gl.createTexture();
        if(!psfTexture)throw new Error('Cannot allocate optical PSF');
        gl.activeTexture(gl.TEXTURE4);gl.bindTexture(gl.TEXTURE_2D,psfTexture);
        textureImage2D(gl,gl.TEXTURE_2D,0,gl.RGB,1,1,0,gl.RGB,gl.UNSIGNED_BYTE,new Uint8Array([0,0,0]));
        for(const axis of [gl.TEXTURE_WRAP_S,gl.TEXTURE_WRAP_T])gl.texParameteri(gl.TEXTURE_2D,axis,gl.CLAMP_TO_EDGE);
        for(const filter of [gl.TEXTURE_MIN_FILTER,gl.TEXTURE_MAG_FILTER])gl.texParameteri(gl.TEXTURE_2D,filter,gl.LINEAR);
        if(!psfData){
          psfData=new Uint8Array(optics.size*optics.size*optics.states*3);
          for(let state=0;state<optics.states;state++)for(let y=0;y<optics.size;y++)for(let x=0;x<optics.size;x++){
            const r2=((x-optics.size/2)*optics.span/optics.size)**2+((y-optics.size/2)*optics.span/optics.size)**2;
            const value=Math.round(Math.max(0,Math.min(1,(Math.log2(Math.exp(-r2/2)+2**-24)+24)/26))*255);
            psfData.fill(value,((state*optics.size+y)*optics.size+x)*3,((state*optics.size+y)*optics.size+x)*3+3);
          }
        }
        uploadPsf();
        gl.uniform1i(gl.getUniformLocation(program,'milkyWayMap'),5);
        gl.uniform1f(gl.getUniformLocation(program,'galaxyMapWidth'),1);
        galaxyTexture=gl.createTexture();
        if(!galaxyTexture)throw new Error('Cannot allocate Milky Way map');
        gl.activeTexture(gl.TEXTURE5);gl.bindTexture(gl.TEXTURE_2D,galaxyTexture);
        textureImage2D(gl,gl.TEXTURE_2D,0,gl.RGB,1,1,0,gl.RGB,gl.UNSIGNED_BYTE,new Uint8Array([0,0,0]));
        gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.REPEAT);
        gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
        for(const filter of [gl.TEXTURE_MIN_FILTER,gl.TEXTURE_MAG_FILTER])gl.texParameteri(gl.TEXTURE_2D,filter,gl.LINEAR);
        if(supportsTerrain){
          terrainTexture=gl.createTexture();
          if(!terrainTexture)throw Error('Cannot allocate terrain');
          gl.activeTexture(gl.TEXTURE8);gl.bindTexture(gl.TEXTURE_2D,terrainTexture);
          textureImage2D(gl,gl.TEXTURE_2D,0,gl.RGB,1,1,0,gl.RGB,gl.UNSIGNED_BYTE,new Uint8Array([0,0,0]));
          gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.REPEAT);
          gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
          for(const filter of [gl.TEXTURE_MIN_FILTER,gl.TEXTURE_MAG_FILTER])gl.texParameteri(gl.TEXTURE_2D,filter,gl.LINEAR);
          gl.uniform1i(gl.getUniformLocation(program,'terrainMap'),8);
        }
        if(supportsSourceAttenuation){
          sourceProgram=batch.take(attenuationProgram!);
          sourcePosition=gl.getAttribLocation(sourceProgram,'position');
          for(const name of ['zoomExcess','resolution','time','cameraPosition','cameraBasis','sunDirection','moon','pointGhosts[0]','cloudMapWidth','cloudTileLayout'])sourceUniforms[name]=gl.getUniformLocation(sourceProgram,name);
          gl.useProgram(sourceProgram);gl.uniform1i(gl.getUniformLocation(sourceProgram,'cloudMap'),2);
          if(supportsCloudTiles)gl.uniform1i(gl.getUniformLocation(sourceProgram,'cloudTileAtlas'),9);
          gl.useProgram(program);
          sourceTexture=gl.createTexture();sourceTarget=gl.createFramebuffer();
          if(!sourceTexture||!sourceTarget)throw Error('Cannot allocate source attenuation target');
          gl.activeTexture(gl.TEXTURE0+10);gl.bindTexture(gl.TEXTURE_2D,sourceTexture);
          textureImage2D(gl,gl.TEXTURE_2D,0,gl.RGBA,5,1,0,gl.RGBA,gl.UNSIGNED_BYTE,null);
          for(const axis of [gl.TEXTURE_WRAP_S,gl.TEXTURE_WRAP_T])gl.texParameteri(gl.TEXTURE_2D,axis,gl.CLAMP_TO_EDGE);
          for(const filter of [gl.TEXTURE_MIN_FILTER,gl.TEXTURE_MAG_FILTER])gl.texParameteri(gl.TEXTURE_2D,filter,gl.NEAREST);
          gl.bindFramebuffer(gl.FRAMEBUFFER,sourceTarget);gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,sourceTexture,0);
          if(gl.checkFramebufferStatus(gl.FRAMEBUFFER)!==gl.FRAMEBUFFER_COMPLETE)throw Error('Incomplete source attenuation target');
          gl.bindFramebuffer(gl.FRAMEBUFFER,null);
        }
        if(separateVolume){
          const uniformNames=['zoomExcess','resolution','cloudResolution','time','cameraPosition','cameraBasis','sunDirection','moon','lunarIrradiance','galacticBasis','pixelRatio','stormSources[0]','galaxyAmount','solarVisibility','cloudMapWidth','galaxyMapWidth','nightMapResolution','mapsReady','surfaceEnabled','cloudTileLayout','nightTileLayout','sceneLinear','displayP3'];
          const samplers={surfaceMap:0,nightMap:1,cloudMap:2,opticalPsf:4,milkyWayMap:5,nightTileAtlas:7,cloudTileAtlas:9,auroraMap:11,solarTransmission:12,worldScene:14,cameraState:10,cloudRadiance:6,cloudDepth:13,noiseTable:NOISE_TABLE_UNIT,temporalRadiance:TEMPORAL_RESOLVED_UNITS[0],temporalDepth:TEMPORAL_RESOLVED_UNITS[1]};
          for(const pass of volumePasses){
            const cloudPass=pass==='cloud';
            const fallbackPass=pass==='fallback',temporalPass=pass==='temporalCloud';
            const passProgram=batch.take(volumePlans.get(pass)!);
            if(cloudPass)cloudProgram=passProgram;else if(fallbackPass)fallbackVolumeProgram=passProgram;else if(temporalPass)temporalCloudProgram=passProgram;else volumeProgram=passProgram;
            const uniforms=cloudPass?cloudUniforms:fallbackPass?fallbackVolumeUniforms:temporalPass?temporalCloudUniforms:volumeUniforms;
            if(fallbackPass)fallbackVolumePosition=gl.getAttribLocation(passProgram,'position');
            else if(cloudPass)cloudPosition=gl.getAttribLocation(passProgram,'position');
            else if(temporalPass)temporalCloudPosition=gl.getAttribLocation(passProgram,'position');else volumePosition=gl.getAttribLocation(passProgram,'position');
            for(const name of [...uniformNames,'cloudParity'])uniforms[name]=gl.getUniformLocation(passProgram,name);
            gl.useProgram(passProgram);
            for(const [name,unit] of Object.entries(samplers))gl.uniform1i(gl.getUniformLocation(passProgram,name),unit);
          }
          if(resolvePlan){
            temporalResolveProgram=batch.take(resolvePlan);temporalResolvePosition=gl.getAttribLocation(temporalResolveProgram,'position');
            for(const name of ['resolution','freshResolution','cloudParity','historyValid','zoomExcess','previousFocal','cameraPosition','previousCamera','cameraBasis','previousBasis'])temporalResolveUniforms[name]=gl.getUniformLocation(temporalResolveProgram,name);
            gl.useProgram(temporalResolveProgram);
            for(const [name,unit] of [['freshRadiance',TEMPORAL_FRESH_UNITS[0]],['freshDepth',TEMPORAL_FRESH_UNITS[1]],['historyRadiance',TEMPORAL_HISTORY_UNITS[0]],['historyDepth',TEMPORAL_HISTORY_UNITS[1]],['previousResolved',TEMPORAL_PREVIOUS_UNIT],['worldScene',14]] as const)
              gl.uniform1i(gl.getUniformLocation(temporalResolveProgram,name),unit);
          }
          worldBuffer=new WorldBuffer(gl,compactWorld);gl.useProgram(program);
        }
        state.volumePass=separateVolume?'separate':'inline';
        state.cloudLighting='raymarch';
        if(lightingPlan){
          const bakeProgram=batch.take(lightingPlan);
          gl.useProgram(bakeProgram);gl.uniform1i(gl.getUniformLocation(bakeProgram,'noiseTable'),NOISE_TABLE_UNIT);
          try{cloudLighting=new CloudLightingAtlas(gl,bakeProgram,notify,params.get('cloudBake')==='budget'?'budget':'fixed');state.cloudLighting='texture';}
          catch(error){gl.deleteProgram(bakeProgram);console.warn('Cloud lighting atlas unavailable; retaining traced lighting.',error);}
        }
        if(modisStudy){
          modisTexture=gl.createTexture();if(!modisTexture)throw Error('Cannot allocate MODIS patch');
          gl.activeTexture(gl.TEXTURE9);gl.bindTexture(gl.TEXTURE_2D,modisTexture);
          textureImage2D(gl,gl.TEXTURE_2D,0,gl.RGBA,1,1,0,gl.RGBA,gl.UNSIGNED_BYTE,new Uint8Array(4));
          for(const axis of [gl.TEXTURE_WRAP_S,gl.TEXTURE_WRAP_T])gl.texParameteri(gl.TEXTURE_2D,axis,gl.CLAMP_TO_EDGE);
          for(const filter of [gl.TEXTURE_MIN_FILTER,gl.TEXTURE_MAG_FILTER])gl.texParameteri(gl.TEXTURE_2D,filter,gl.LINEAR);
          for(const pass of [program,sourceProgram,volumeProgram,cloudProgram,fallbackVolumeProgram])if(pass){
            gl.useProgram(pass);gl.uniform1i(gl.getUniformLocation(pass,'modisPatch'),9);
          }
          gl.useProgram(program);
        }
        if(noiseTable){
          noiseTexture=gl.createTexture();if(!noiseTexture)throw Error('Cannot allocate noise table');
          gl.activeTexture(gl.TEXTURE0+NOISE_TABLE_UNIT);gl.bindTexture(gl.TEXTURE_2D,noiseTexture);
          textureImage2D(gl,gl.TEXTURE_2D,0,gl.RGBA,NOISE_TABLE_SIZE,NOISE_TABLE_SIZE,0,gl.RGBA,gl.UNSIGNED_BYTE,noiseTableData());
          for(const axis of [gl.TEXTURE_WRAP_S,gl.TEXTURE_WRAP_T])gl.texParameteri(gl.TEXTURE_2D,axis,gl.CLAMP_TO_EDGE);
          for(const filter of [gl.TEXTURE_MIN_FILTER,gl.TEXTURE_MAG_FILTER])gl.texParameteri(gl.TEXTURE_2D,filter,gl.NEAREST);
          for(const pass of [program,sourceProgram])if(pass){gl.useProgram(pass);gl.uniform1i(gl.getUniformLocation(pass,'noiseTable'),NOISE_TABLE_UNIT);}
        }
        catalog=new CatalogStars(gl,catalogPrograms);
        const wideGamut=configureSceneColor(gl);
        finish=new CameraFinish(gl,wideGamut,cameraPrograms);
        if(supportsAurora){aurora=new Aurora(gl,auroraPrograms);orbitUniforms.auroraMap=gl.getUniformLocation(program,'auroraMap');}
        state.aurora=supportsAurora?'volume':wantsAurora?'unsupported':'off';
        state.auroraMode=auroraMode(params);
        timer=params.get('quality')==='fixed'?null:new SceneTimer(gl);
        if(timer)timer.quality.scale=seededScale;
        gl.useProgram(program);
        gl.uniform1f(gl.getUniformLocation(program,'displayP3'),wideGamut?1:0);
        gl.uniform1f(gl.getUniformLocation(program,'sceneLinear'),finish.linear?1:0);
        state.colorSpace=wideGamut?'display-p3':'srgb';
        if(streamDetail&&params.get('nightDetail')!=='0'){
          try{nightTiles=new SurfaceTiles(gl,canvas.clientWidth<1000,notify,'night',work,base);}
          catch(error){console.warn('Detailed night map unavailable; retaining the global map.',error);}
        }
        // Unit 6 is reused across passes. CameraFinish rebinds its target only
        // after this scene has finished, so no framebuffer feedback is sampled.
        if(streamDetail&&params.get('dayDetail')!=='0'){
          try{dayTiles=new SurfaceTiles(gl,canvas.clientWidth<1000,notify,'day',work,base);}
          catch(error){console.warn('Detailed day map unavailable; retaining the global map.',error);}
        }
        if(supportsCloudTiles&&params.get('cloudDetail')!=='0')cloudTiles=new SurfaceTiles(gl,canvas.clientWidth<1000,notify,'cloud',work,base);
        if(supportsTerrainTiles){const mobile=canvas.clientWidth<1000||matchMedia('(pointer: coarse)').matches;terrainTiles=params.get('terrainDetail')==='coarse'?new SurfaceTiles(gl,mobile,notify,'terrain',work,base):new TerrainStream(gl,mobile,notify,work,base,sources.terrainBaseURL,params.get('terrainUpload')==='tile'?'tile':'strips',params.get('terrainCache')==='small'?'small':'working',params.get('terrainDecoder')==='pool'?'pool':'single',params.get('terrainSource')==='packed'?'packed':'tiff',state.terrainBound==='regional'?'regional':'off');}
        if(supportsGalaxyTiles)galaxyTiles=new SurfaceTiles(gl,canvas.clientWidth<1000||matchMedia('(pointer: coarse)').matches,notify,'galaxy',work,base);
        if(starData)catalog.upload(starData);
        if(oceanPlan){gl.bindBuffer(gl.ARRAY_BUFFER,buffer);oceanField=new OceanField(gl,batch.take(oceanPlan),params.get('oceanResolution')==='1024'?1024:2048,oceanMode==='regions'?1:oceanMode==='advected'?8:4);}
        state.ocean=oceanMode??'original';state.oceanBytes=String(oceanField?.bytes??0);state.oceanWidth=String(oceanField?.width??0);
        initialized=true;state.shaderStartup='ready';
        return true;
      } catch (error) {
        if(disposed||lost||gl.isContextLost()||current!==generation||controller.signal.aborted)return false;
        const retryCompact=!!cloudBuffer&&!disableHalfClouds,retryTemporal=!!temporal&&!disableTemporal;
        release();
        if(retryTemporal){
          disableTemporal=true;
          console.warn('Temporal cloud shaders unavailable; retaining compact rendering.',error);
          return initialize(started);
        }
        if(retryCompact){
          disableHalfClouds=true;
          console.warn('Half-resolution cloud shaders unavailable; retaining compact rendering.',error);
          return initialize(started);
        }
        state.shaderStartup='failed';state.shaderCompileMs=(performance.now()-started).toFixed(2);notify();
        console.warn('Orbital sky uses its static fallback.', error);
        return false;
      } finally {
        batch.dispose();
      }
    };



    const render=(orbit:ReturnType<typeof issFrame>&{focal?:number},width:number,height:number,cssHeight:number,sceneTime:number,grainIndex:number,look:SceneLook,focusRadius=0,playbackRate=10,inspection=false)=>{
      if(disposed||lost||!initialized||!program||!catalog||!finish)return null;
      // Upgrade only after a real viewport expansion, with margin at the tier
      // boundary. Quality changes never trigger repeated downloads/downgrades.
      if(!background&&imageWidths.day===2048&&Math.max(width,height)>1408&&assets.settled)
        void assets.refine({key:'day',url:assetURL('earth-day-bmng.avif',base)});
      // Loading-only optical work must not lower the settled scene's quality.
      if(focusRadius===0&&!inspection)timer?.begin();
      const sky = celestialFrame(orbit.date,orbit.camera);
      // The lens: focal length in viewport heights, 1.25 at 1×; a wide angle goes below it.
      const focal=orbit.focal??1.25,zoomExcess=focal/1.25-1;
      gl.activeTexture(gl.TEXTURE4);gl.bindTexture(gl.TEXTURE_2D,psfTexture);
      catalog.render(width,height,height/Math.max(1,cssHeight),sky.starToFixed,orbit.cameraBasis,sky.yearsSinceJ2000,finish.exposureTexture,focal);
      aurora?.render(width,height,orbit.camera,orbit.cameraBasis,orbit.sun,sceneTime,focal);
      finish.begin(width,height);
      // Every pass binds what it owns; no reliance on uploads leaving GL state.
      textures.forEach((texture,i)=>{gl.activeTexture(gl.TEXTURE0+i);gl.bindTexture(gl.TEXTURE_2D,texture);});
      if(modisTexture){gl.activeTexture(gl.TEXTURE9);gl.bindTexture(gl.TEXTURE_2D,modisTexture);}
      gl.activeTexture(gl.TEXTURE3);gl.bindTexture(gl.TEXTURE_2D,catalog.texture);
      gl.activeTexture(gl.TEXTURE4);gl.bindTexture(gl.TEXTURE_2D,psfTexture);
      gl.activeTexture(gl.TEXTURE5);gl.bindTexture(gl.TEXTURE_2D,galaxyTexture);
      if(terrainTexture){gl.activeTexture(gl.TEXTURE8);gl.bindTexture(gl.TEXTURE_2D,terrainTexture);}
      // Shared by the bake, source, world and volume passes of this frame.
      if(noiseTexture){gl.activeTexture(gl.TEXTURE0+NOISE_TABLE_UNIT);gl.bindTexture(gl.TEXTURE_2D,noiseTexture);}
      gl.useProgram(program);
      if(aurora){gl.activeTexture(gl.TEXTURE11);gl.bindTexture(gl.TEXTURE_2D,aurora.texture);gl.uniform1i(orbitUniforms.auroraMap,11);}
      if(supportsSourceAttenuation){
        gl.activeTexture(gl.TEXTURE10);gl.bindTexture(gl.TEXTURE_2D,finish.exposureTexture);
        gl.uniform1i(orbitUniforms.cameraState,10);
      }
      gl.bindBuffer(gl.ARRAY_BUFFER,buffer);
      const position=scenePosition;
      gl.enableVertexAttribArray(position);gl.vertexAttribPointer(position,2,gl.FLOAT,false,0,0);
      gl.uniform4fv(orbitUniforms.moon,sky.moon);
      const lunarLight=currentLunarLight(orbit.date,sky.moon,sky.starToFixed);
      const phaseCosine=Math.max(-1,Math.min(1,-sky.moon.slice(0,3).reduce((sum,x,i)=>sum+x*lunarLight[i],0)));
      const phaseAngle=Math.acos(phaseCosine);
      gl.uniform1f(orbitUniforms.lunarIrradiance,(Math.sin(phaseAngle)+(Math.PI-phaseAngle)*phaseCosine)/Math.PI);
      const moonSamples=lunarSamples(sky.moon,lunarLight,orbit.cameraBasis,orbit.camera);
      gl.uniform4fv(orbitUniforms['moonSamples[0]'],moonSamples);
      let lunarFlux=0;
      for(let i=3;i<moonSamples.length;i+=4)lunarFlux+=moonSamples[i];
      const points=pointReflections.update(
        sky.starToFixed,orbit.cameraBasis,orbit.camera,sky.yearsSinceJ2000,sky.planets,
        width/height,height,sceneTime,cssHeight,focal);
      work.observeView(orbit.camera,orbit.cameraBasis,performance.now());
      state.streamingMotion=work.moving?'deferred':'ready';
      galaxyTiles?.update({...orbit,galacticBasis:sky.galacticBasis},width,height,program);
      terrainTiles?.update(orbit,width,height,program);
      gl.uniformMatrix3fv(orbitUniforms.galacticBasis,false,sky.galacticBasis);
      gl.uniform1f(orbitUniforms.pixelRatio,height/Math.max(1,cssHeight));
      gl.uniform1f(orbitUniforms.starsLinear,catalog.linear?1:0);
      gl.uniform4fv(orbitUniforms['planets[0]'],sky.planets);
      gl.uniform2f(resolution, width, height);
      gl.uniform1f(time, sceneTime);
      gl.uniform1f(orbitUniforms.zoomExcess,zoomExcess);
      const storms=params.get('lightning')==='0'?new Float32Array(32):stormLights(sceneTime,playbackRate,orbit.camera,orbit.cameraBasis,width/height,profile.fps,focal);
      gl.uniform4fv(orbitUniforms['stormSources[0]'],storms);
      gl.uniform1f(orbitUniforms.galaxyAmount,look.galaxy);
      gl.uniform3fv(orbitUniforms.cameraPosition,orbit.camera);
      gl.uniformMatrix3fv(orbitUniforms.cameraBasis,false,orbit.cameraBasis);
      gl.uniform3fv(orbitUniforms.sunDirection,orbit.sun);
      gl.uniform1f(orbitUniforms.solarVisibility,visibleSourceDisk(orbit.camera,orbit.sun,SOLAR_RADIUS));
      if(params.get('surface')!=='0')nightTiles?.update(orbit,width,height,program);
      if(params.get('surface')!=='0')dayTiles?.update(terrainView?{...orbit,sun:orbit.camera}:orbit,width,height,program);
      if(params.get('surface')!=='0'&&cloudTiles){
        const angle=sceneTime*.000008,c=Math.cos(angle),s=Math.sin(angle);
        const rotate=(v:number[])=>[c*v[0]+s*v[1],-s*v[0]+c*v[1],v[2]];
        cloudTiles.update({...orbit,camera:rotate(orbit.camera),cameraBasis:[0,3,6].flatMap(i=>rotate(orbit.cameraBasis.slice(i,i+3)))},width,height,program);
      }
      if(cloudLighting){
        const stats=cloudTiles?.stats();
        cloudLighting.update(orbit.camera,orbit.sun,sceneTime,width,height,imageWidths.clouds??1,cloudTiles?.layout(),
          JSON.stringify([imageWidths.clouds,stats?.revision]),!work.moving&&assets.settled&&(!stats||(stats.pending===0&&stats.fading===0)),state);
        finish.resume();gl.useProgram(program);
        gl.enableVertexAttribArray(scenePosition);gl.vertexAttribPointer(scenePosition,2,gl.FLOAT,false,0,0);
      }


      const light = Math.max(0,Math.min(1,(orbit.solar+.25)/.4));
      const sceneDaylight=light*light*(3-2*light);
      if(sourceTarget&&sourceTexture&&sourceProgram){
        gl.useProgram(sourceProgram);
        gl.uniform2f(sourceUniforms.resolution,width,height);gl.uniform1f(sourceUniforms.time,sceneTime);gl.uniform1f(sourceUniforms.zoomExcess,zoomExcess);
        gl.uniform3fv(sourceUniforms.cameraPosition,orbit.camera);gl.uniformMatrix3fv(sourceUniforms.cameraBasis,false,orbit.cameraBasis);
        gl.uniform3fv(sourceUniforms.sunDirection,orbit.sun);gl.uniform4fv(sourceUniforms.moon,sky.moon);
        gl.uniform4fv(sourceUniforms['pointGhosts[0]'],points);gl.uniform1f(sourceUniforms.cloudMapWidth,imageWidths.clouds??1);
        if(cloudTiles)gl.uniform2fv(sourceUniforms.cloudTileLayout,cloudTiles.layout());
        gl.enableVertexAttribArray(sourcePosition);gl.vertexAttribPointer(sourcePosition,2,gl.FLOAT,false,0,0);
        gl.bindFramebuffer(gl.FRAMEBUFFER,sourceTarget);gl.viewport(0,0,5,1);gl.drawArrays(gl.TRIANGLES,0,3);
        finish.resume();gl.useProgram(program);
        gl.enableVertexAttribArray(scenePosition);gl.vertexAttribPointer(scenePosition,2,gl.FLOAT,false,0,0);
      }
      if(supportsSolarTransmission&&sourceTexture){
        gl.activeTexture(gl.TEXTURE12);gl.bindTexture(gl.TEXTURE_2D,sourceTexture);
        gl.uniform1i(orbitUniforms.solarTransmission,12);
      }
      // RGBE stores numerical mantissas and an exponent, not display colors.
      const dither=gl.isEnabled(gl.DITHER);
      if(!finish.linear)gl.disable(gl.DITHER);
      if(terrainView){gl.bindFramebuffer(gl.FRAMEBUFFER,null);gl.viewport(0,0,width,height);}
      if(worldBuffer)worldBuffer.begin(width,height);
      oceanField?.bind(program);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      // Shared state for every screen-sized volume program in this frame.
      const linearScene=finish.linear;
      const drawVolumePass=(passProgram:WebGLProgram,uniforms:Record<string,WebGLUniformLocation|null>,passPosition:number)=>{
        gl.useProgram(passProgram);
        cloudLighting?.bind(passProgram);
        gl.activeTexture(gl.TEXTURE14);gl.bindTexture(gl.TEXTURE_2D,worldBuffer!.texture);
        gl.uniform2f(uniforms.cloudResolution,Math.ceil(width/2),Math.ceil(height/2));
        gl.uniform2f(uniforms.resolution,width,height);gl.uniform1f(uniforms.time,sceneTime);gl.uniform1f(uniforms.zoomExcess,zoomExcess);
        gl.uniform3fv(uniforms.cameraPosition,orbit.camera);gl.uniformMatrix3fv(uniforms.cameraBasis,false,orbit.cameraBasis);
        gl.uniform3fv(uniforms.sunDirection,orbit.sun);gl.uniform4fv(uniforms.moon,sky.moon);
        gl.uniform1f(uniforms.lunarIrradiance,(Math.sin(phaseAngle)+(Math.PI-phaseAngle)*phaseCosine)/Math.PI);
        gl.uniformMatrix3fv(uniforms.galacticBasis,false,sky.galacticBasis);
        gl.uniform1f(uniforms.pixelRatio,height/Math.max(1,cssHeight));
        gl.uniform4fv(uniforms['stormSources[0]'],storms);
        gl.uniform1f(uniforms.galaxyAmount,look.galaxy);
        gl.uniform1f(uniforms.solarVisibility,visibleSourceDisk(orbit.camera,orbit.sun,SOLAR_RADIUS));
        gl.uniform1f(uniforms.cloudMapWidth,imageWidths.clouds??1);
        gl.uniform1f(uniforms.galaxyMapWidth,imageWidths.galaxy??1);
        gl.uniform2f(uniforms.nightMapResolution,imageWidths.night??1,(imageWidths.night??2)/2);
        gl.uniform1f(uniforms.mapsReady,Object.keys(imageWidths).length?1:0);
        gl.uniform1f(uniforms.surfaceEnabled,params.get('surface')==='0'?0:1);
        if(cloudTiles)gl.uniform2fv(uniforms.cloudTileLayout,cloudTiles.layout());
        if(nightTiles)gl.uniform2fv(uniforms.nightTileLayout,nightTiles.layout());
        gl.uniform1f(uniforms.sceneLinear,linearScene?1:0);
        gl.uniform1f(uniforms.displayP3,state.colorSpace==='display-p3'?1:0);
        if(uniforms.cloudParity)gl.uniform1f(uniforms.cloudParity,temporal?.parity??0);
        gl.enableVertexAttribArray(passPosition);gl.vertexAttribPointer(passPosition,2,gl.FLOAT,false,0,0);
        gl.drawArrays(gl.TRIANGLES,0,3);
      };
      if(worldBuffer&&volumeProgram&&temporal&&temporalCloudProgram&&temporalResolveProgram){
        // Half the columns are integrated; the resolve rebuilds the rest.
        const [freshWidth,freshHeight]=temporal.beginFresh(width,height);
        state.cloudBuffer=`${freshWidth}x${freshHeight}`;
        drawVolumePass(temporalCloudProgram,temporalCloudUniforms,temporalCloudPosition);
        temporal.beginResolve();
        gl.activeTexture(gl.TEXTURE14);gl.bindTexture(gl.TEXTURE_2D,worldBuffer.texture);
        gl.useProgram(temporalResolveProgram);
        const u=temporalResolveUniforms,before=previousPose;
        gl.uniform2f(u.resolution,width,height);gl.uniform2f(u.freshResolution,freshWidth,freshHeight);
        gl.uniform1f(u.cloudParity,temporal.parity);gl.uniform1f(u.historyValid,temporal.historyValid&&before?1:0);
        gl.uniform1f(u.zoomExcess,zoomExcess);gl.uniform3fv(u.cameraPosition,orbit.camera);gl.uniformMatrix3fv(u.cameraBasis,false,orbit.cameraBasis);
        if(before){gl.uniform1f(u.previousFocal,before.focal);gl.uniform3fv(u.previousCamera,before.camera);gl.uniformMatrix3fv(u.previousBasis,false,before.basis);}
        gl.enableVertexAttribArray(temporalResolvePosition);gl.vertexAttribPointer(temporalResolvePosition,2,gl.FLOAT,false,0,0);
        gl.drawArrays(gl.TRIANGLES,0,3);
        // The resolve borrowed the noise and galaxy units.
        if(noiseTexture){gl.activeTexture(gl.TEXTURE0+NOISE_TABLE_UNIT);gl.bindTexture(gl.TEXTURE_2D,noiseTexture);}
        gl.activeTexture(gl.TEXTURE0+TEMPORAL_PREVIOUS_UNIT);gl.bindTexture(gl.TEXTURE_2D,galaxyTexture);
      }
      if(worldBuffer&&volumeProgram){
        for(const cloudPass of cloudBuffer&&cloudProgram?[true,false]:[false]){
          const passProgram=cloudPass?cloudProgram!:volumeProgram;
          const uniforms=cloudPass?cloudUniforms:volumeUniforms;
          const passPosition=cloudPass?cloudPosition:volumePosition;
          if(cloudPass){
            try{
              const size=cloudBuffer!.begin(width,height);
              state.cloudBuffer=`${size[0]}x${size[1]}`;
            }catch(error){
              // A small capability probe can succeed while a full allocation
              // fails. Keep the already compiled full-resolution volume pass.
              cloudBuffer!.dispose();cloudBuffer=null;
              gl.deleteProgram(cloudProgram);cloudProgram=null;
              gl.deleteProgram(volumeProgram);volumeProgram=fallbackVolumeProgram!;fallbackVolumeProgram=null;
              volumePosition=fallbackVolumePosition;
              Object.assign(volumeUniforms,fallbackVolumeUniforms);
              disableHalfClouds=true;state.cloudPass='compact-fallback';delete state.cloudBuffer;
              console.warn('Half-resolution cloud allocation failed; retaining compact rendering.',error);
              continue;
            }
          }else{finish.resume();cloudBuffer?.bind();temporal?.bindResolved();}
          drawVolumePass(passProgram,uniforms,passPosition);
        }
        temporal?.advance();
      }
      if(dither&&!finish.linear)gl.enable(gl.DITHER);
      // Image sliders are relative to the accepted photographic baseline.
      const project=(direction:ArrayLike<number>,energy:number):[number,number,number]=>{
        const component=(i:number)=>direction[0]*orbit.cameraBasis[i]+direction[1]*orbit.cameraBasis[i+1]+direction[2]*orbit.cameraBasis[i+2];
        const z=component(6);
        return [focal*component(0)/Math.max(.001,z),focal*component(3)/Math.max(.001,z),z>0?energy:0];
      };
      const now=performance.now(),pose={camera:Array.from(orbit.camera),basis:Array.from(orbit.cameraBasis),focal,at:now};
      // Blur only between consecutive animated frames; a stale pose would smear a jump.
      const motion=motionShutter>0&&previousPose&&!inspection&&focusRadius===0&&now-previousPose.at<200
        ?{shutter:motionShutter,sky:skyShutter,camera:pose.camera,basis:pose.basis,previousCamera:previousPose.camera,previousBasis:previousPose.basis,previousFocal:previousPose.focal}:null;
      previousPose=pose;
      if(!terrainView)finish.render(height/Math.max(1,cssHeight),grainIndex,look.grain*1.3,look.chromatic*.8,focusRadius,{
        motion,
        moon:project(sky.moon,lunarFlux*Math.PI*(sky.moon[3]*focal)**2*18*look.ghosts),
        moonRadius:sky.moon[3],
        glare:params.get('glare')!=='off',
        fieldReflections:params.get('fieldReflections')!=='off',
        sun:project(orbit.sun,visibleSourceDisk(orbit.camera,orbit.sun,SOLAR_RADIUS)),
        points,pointAmount:look.ghosts,attenuation:sourceTexture,sunReflections:look.ghosts,focal,
      },look.exposure,look.manualExposure);

      timer?.end();
      return {scale:(timer?.quality.scale??1)*profile.scale,daylight:sceneDaylight,state,night:nightTiles?.stats(),day:dayTiles?.stats(),cloud:cloudTiles?.stats(),galaxy:galaxyTiles?.stats(),terrain:terrainTiles?.stats()};
    };
    const bounds=canvas.getBoundingClientRect();
    const target=sceneBufferSize(bounds.width,bounds.height,devicePixelRatio,profile.scale);
    const compactSurface=compactSurfaceOverview(target.width,target.height,streamDetail);
    const plan=sceneAssetPlan(!background&&canvas.clientWidth>=1000,gl.getParameter(gl.MAX_TEXTURE_SIZE),supportsTerrain&&params.get('terrain')!=='0',saveData,background||compactSurface,background||textureProfile(params)==='compact',base);
    if(modisStudy)plan.push({key:'modis',url:assetURL('modis-demo/orbit-patch.png',base),preview:true});
    if(supportsCloudTiles)for(const asset of plan)if(asset.key==='clouds'&&!asset.preview)asset.url=assetURL('earth-clouds-nasa-4096.avif',base);
    // Streamed 1.85 km and 92 m tiles replace global heights wherever a pixel
    // spans less than ~59 km. DEM3 keeps the full-resolution coastline mask
    // and every mip, but rebuilds level-0 heights from level 1: 8.4 -> 3.4 MB.
    // terrainMap=v2 keeps the previous file for comparisons.
    if(supportsTerrainTiles&&params.get('terrainMap')!=='v2')for(const asset of plan)if(asset.key==='terrain')asset.url=asset.url.replace(/-v2\.dem$/,'-v3.dem');
    const assets=new SceneAssets(plan,upload,()=>{if(assets.previewSettled)releasePreviewNetwork();state.assetPhase=assets.settled?'settled':assets.previewSettled?'detail':'preview';state.assetFailures=String(assets.failures.length);notify();},work);
    const start=(restoring=false)=>{
      if(disposed||lost)return Promise.resolve(false);
      if(initialization)return initialization;
      const current=generation;
      initialization=initialize().then(ready=>{
        if(!ready||disposed||lost||current!==generation)return false;
        // Upload callbacks use linked programs and allocated fallback textures.
        if(restoring)void assets.restore();
        // A context can be lost while its first shader batch is still pending.
        // restore() reactivates uploads, but has no cached plan to replay then.
        if(!assetLoadStarted){assetLoadStarted=true;void assets.start();}
        notify();return true;
      });
      return initialization;
    };
    return {render,state,assets,
      observeAnimationFrame(now:number,cadenceFactor=1){timer?.observeAnimationFrame(now,cadenceFactor);},
      /** Start adaptation from a previously settled scale; it still adapts. */
      seedScale(scale:number){seededScale=scale;if(timer)timer.quality.scale=scale;},
      get adaptive(){return !!timer;},
      resetCadence(){timer?.resetCadence();},
      observeCadence(milliseconds:number,now:number,allowUpscale=true){timer?.observeCadence(milliseconds,now,allowUpscale);},
      setCadence(target:number,refresh:number,headroom:boolean){timer?.setCadence(target,refresh,headroom);},
      load(){void start();},
      contextLost(){lost=true;generation++;initialization=null;assets.suspend();release();for(const k of Object.keys(state))delete state[k];for(const k of Object.keys(imageWidths))delete imageWidths[k];},
      contextRestored(){if(disposed)return Promise.resolve(false);lost=false;return start(true);},
      dispose(){disposed=true;generation++;assets.dispose();starData=null;psfData=null;release();releasePreviewNetwork();},
    };
}
