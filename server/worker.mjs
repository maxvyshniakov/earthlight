import {terrainResponse} from './terrain-source.mjs';
export default {fetch(request,env){if(new URL(request.url).pathname.startsWith('/media/earthlight/dem90/'))return terrainResponse(request,(url,options)=>fetch(url,{...options,cf:{cacheEverything:true,cacheTtl:604800}}));return env.ASSETS.fetch(request);}};
