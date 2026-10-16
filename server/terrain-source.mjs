// A single public dataset, not an arbitrary URL proxy. Shared by local Vite
// and the Worker; the upstream bucket does not expose browser CORS headers.
export function terrainSource(pathname) {
  const match=/^\/media\/earthlight\/dem90\/([NS])(\d{2})([EW])(\d{3})\.tif$/.exec(pathname);
  if(!match)return null;
  const [,ns,lat,ew,lon]=match;
  const south=Number(lat)*(ns==='S'?-1:1),west=Number(lon)*(ew==='W'?-1:1);
  if(south < -90||south>=90||west < -180||west>=180||(ns==='S'&&lat==='00')||(ew==='W'&&lon==='000'))return null;
  const name=`Copernicus_DSM_COG_30_${ns}${lat}_00_${ew}${lon}_00_DEM`;
  return `https://copernicus-dem-90m.s3.amazonaws.com/${name}/${name}.tif`;
}
export async function terrainResponse(request,fetcher=fetch) {
  const url=terrainSource(new URL(request.url).pathname);
  if(!url)return new Response('Not found',{status:404});
  if(request.method!=='GET')return new Response('Method not allowed',{status:405,headers:{Allow:'GET'}});
  try{
    const upstream=await fetcher(url,{redirect:'manual',signal:request.signal});
    if(!upstream.ok){await upstream.body?.cancel();return new Response('Terrain unavailable',{status:upstream.status===404?404:502});}
    const length=Number(upstream.headers.get('content-length'));
    if(!Number.isInteger(length)||length<=0||length>16*1024*1024){await upstream.body?.cancel();return new Response('Invalid terrain size',{status:502});}
    return new Response(upstream.body,{headers:{'Content-Type':'image/tiff','Content-Length':String(length),'Cache-Control':'public, max-age=604800','X-Content-Type-Options':'nosniff'}});
  }catch{return new Response('Terrain unavailable',{status:502});}
}
