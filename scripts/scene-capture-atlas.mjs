// Verification-only resource placement. Async tile completion chooses atlas
// offsets; floating-point sampling at different offsets can differ by a few
// display bytes even for the same texels. Keep the real page-to-payload mapping
// and every texel, but place each resident pair in geographic page order.
export function captureAtlasPlan(layer,columns,table){
 if(!['day','night','cloud','galaxy','terrain'].includes(layer)||!Number.isInteger(columns)||columns<2||columns>16)throw Error('Unsupported capture atlas layout');
 const terrain=layer==='terrain',width=terrain?800:layer==='day'||layer==='night'?160:32;
 const rows=terrain?360:layer==='day'||layer==='night'?80:16,first=terrain?columns:1;
 if(table.length!==width*rows*(terrain?1:2)*4)throw Error('Unexpected atlas page table');
 const pages=new Uint8Array(table),entries=[],slots=new Set();
 for(let key=0;key<width*rows;key++){
  if(layer==='day'&&table[key*4+1])throw Error('Deep day atlas capture is unsupported');
  const slot=table[key*4];if(!slot)continue;
  if(terrain&&(key%800>=760||(key%800>=720&&Math.floor(key/800)>=20)))throw Error('Terrain page is outside the supported grids');
  const fade=table[(terrain?key:key+width*rows)*4+(terrain?1:0)];
  if(fade!==255)throw Error('Cannot capture a fading atlas tile');
  if((slot-first)%2!==0)throw Error('Atlas cell pair is misaligned');
  // These production layouts own one pair per page. An alias is unsupported,
  // not an opportunity to silently repair a malformed production table.
  if(slots.has(slot))throw Error('Atlas pages share a resident slot');slots.add(slot);
  const target=first+entries.length*2;
  if(slot<first||slot+1>=columns*columns||target+1>=columns*columns)throw Error('Atlas slot out of bounds');
  entries.push({key,from:slot,to:target});pages[key*4]=target;
 }
 return {width,height:rows*(terrain?1:2),pages,entries};
}

// Serialized into the isolated browser by verify-renderer-cleanup.mjs. Temporary
// RGBA8 copies preserve scalar atlas samples in .r and color/numeric samples in
// .rgba. No production loader, shader, time, exposure or pixel output is patched.
export function installCaptureAtlases(gl,plan,expected){
 const draw=gl.drawArrays,cache=new Map(),resources=[];
 const layouts={day:572,night:572,cloud:544,galaxy:544,terrain:632};
 function canonical(layer,original,edge,columns){
  const cell=layouts[layer];if(edge!==cell*columns)throw Error('Unexpected atlas dimensions');
  const active=gl.getParameter(gl.ACTIVE_TEXTURE),binding=gl.getParameter(gl.TEXTURE_BINDING_2D);
  const read=gl.getParameter(gl.READ_FRAMEBUFFER_BINDING),write=gl.getParameter(gl.DRAW_FRAMEBUFFER_BINDING);
  const pack=gl.getParameter(gl.PIXEL_PACK_BUFFER_BINDING),unpack=gl.getParameter(gl.PIXEL_UNPACK_BUFFER_BINDING);
  const stores=[gl.PACK_ALIGNMENT,gl.PACK_ROW_LENGTH,gl.PACK_SKIP_PIXELS,gl.PACK_SKIP_ROWS,
   gl.UNPACK_ALIGNMENT,gl.UNPACK_ROW_LENGTH,gl.UNPACK_SKIP_PIXELS,gl.UNPACK_SKIP_ROWS,gl.UNPACK_IMAGE_HEIGHT,gl.UNPACK_SKIP_IMAGES,
   gl.UNPACK_FLIP_Y_WEBGL,gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL,gl.UNPACK_COLORSPACE_CONVERSION_WEBGL].map(key=>[key,gl.getParameter(key)]);
  const scratch=gl.createFramebuffer();let texture=null;
  try{
   gl.bindBuffer(gl.PIXEL_PACK_BUFFER,null);gl.bindBuffer(gl.PIXEL_UNPACK_BUFFER,null);
   for(const [key] of stores)gl.pixelStorei(key,key===gl.PACK_ALIGNMENT||key===gl.UNPACK_ALIGNMENT?4:0);
   gl.bindFramebuffer(gl.FRAMEBUFFER,scratch);gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,original,0);
   if(gl.checkFramebufferStatus(gl.FRAMEBUFFER)!==gl.FRAMEBUFFER_COMPLETE)throw Error('Unreadable capture atlas');
   const terrain=layer==='terrain',width=terrain?800:layer==='day'||layer==='night'?160:32,rows=terrain?360:layer==='day'||layer==='night'?80:16;
   const table=new Uint8Array(width*rows*(terrain?1:2)*4);gl.readPixels(0,0,width,rows*(terrain?1:2),gl.RGBA,gl.UNSIGNED_BYTE,table);
   const cached=cache.get(original);
   if(cached){
    if(cached.layer!==layer||cached.edge!==edge||cached.table.some((value,i)=>value!==table[i]))throw Error('Atlas changed during fixed-residency capture');
    return cached.texture;
   }
   const layout=plan(layer,columns,table);
   if(layout.entries.length!==expected[layer])throw Error('Atlas page count does not match production residency');
   const filters=[gl.TEXTURE_WRAP_S,gl.TEXTURE_WRAP_T,gl.TEXTURE_MIN_FILTER,gl.TEXTURE_MAG_FILTER].map(key=>[key,gl.getTexParameter(gl.TEXTURE_2D,key)]);
   if(filters.some(([key,value])=>value!==(key===gl.TEXTURE_WRAP_S||key===gl.TEXTURE_WRAP_T?gl.CLAMP_TO_EDGE:gl.LINEAR)))throw Error('Unsupported capture atlas filtering');
   texture=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,texture);
   gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,edge,edge,0,gl.RGBA,gl.UNSIGNED_BYTE,null);
   for(const [key,value] of filters)gl.texParameteri(gl.TEXTURE_2D,key,value);
   let verifiedBytes=0;
   function copy(x,y,fromX,fromY,width,height){
    const data=new Uint8Array(width*height*4);gl.readPixels(fromX,fromY,width,height,gl.RGBA,gl.UNSIGNED_BYTE,data);
    gl.texSubImage2D(gl.TEXTURE_2D,0,x,y,width,height,gl.RGBA,gl.UNSIGNED_BYTE,data);
    gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,texture,0);
    const check=new Uint8Array(data.length);gl.readPixels(x,y,width,height,gl.RGBA,gl.UNSIGNED_BYTE,check);
    for(let i=0;i<data.length;i++)if(data[i]!==check[i])throw Error('Capture atlas texel changed');verifiedBytes+=data.length;
    gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,original,0);
   }
   // Keep all actual metadata, including terrain's conservative bounds. Only
   // the resident slot byte in each populated page changes; fades stay intact.
   copy(0,0,0,0,terrain?edge:cell,cell);
   for(const entry of layout.entries)for(let half=0;half<2;half++){
    const from=entry.from+half,to=entry.to+half;
    copy(to%columns*cell,Math.floor(to/columns)*cell,from%columns*cell,Math.floor(from/columns)*cell,cell,cell);
   }
   gl.texSubImage2D(gl.TEXTURE_2D,0,0,0,layout.width,layout.height,gl.RGBA,gl.UNSIGNED_BYTE,layout.pages);
   gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,texture,0);
   const copiedPages=new Uint8Array(layout.pages.length);gl.readPixels(0,0,layout.width,layout.height,gl.RGBA,gl.UNSIGNED_BYTE,copiedPages);
   if(copiedPages.some((value,i)=>value!==layout.pages[i]))throw Error('Capture atlas page table changed');
   const error=gl.getError();if(error)throw Error('Capture atlas WebGL error '+error);
   resources.push({layer,edge,columns,verifiedBytes,entries:layout.entries});cache.set(original,{texture,layer,edge,table});return texture;
  }catch(error){if(texture)gl.deleteTexture(texture);throw error;}
  finally{
   gl.bindFramebuffer(gl.READ_FRAMEBUFFER,read);gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER,write);gl.deleteFramebuffer(scratch);
   gl.bindTexture(gl.TEXTURE_2D,binding);gl.activeTexture(active);
   for(const [key,value] of stores)gl.pixelStorei(key,value);
   gl.bindBuffer(gl.PIXEL_PACK_BUFFER,pack);gl.bindBuffer(gl.PIXEL_UNPACK_BUFFER,unpack);
  }
 }
 gl.drawArrays=function(...args){
  const program=gl.getParameter(gl.CURRENT_PROGRAM),active=gl.getParameter(gl.ACTIVE_TEXTURE),restore=[];
  try{
   for(const layer of Object.keys(layouts)){
    const sampler=gl.getUniformLocation(program,layer+'TileAtlas'),layout=gl.getUniformLocation(program,layer+'TileLayout');if(!sampler||!layout)continue;
    const [edge,columns]=gl.getUniform(program,layout);if(edge<1)continue;
    const unit=gl.getUniform(program,sampler);gl.activeTexture(gl.TEXTURE0+unit);
    const original=gl.getParameter(gl.TEXTURE_BINDING_2D),texture=canonical(layer,original,edge,columns);
    restore.push({unit,original});gl.bindTexture(gl.TEXTURE_2D,texture);
   }
   gl.activeTexture(active);draw.apply(this,args);
  }finally{for(const {unit,original} of restore){gl.activeTexture(gl.TEXTURE0+unit);gl.bindTexture(gl.TEXTURE_2D,original);}gl.activeTexture(active);}
 };
 return {resources,dispose(){gl.drawArrays=draw;for(const {texture} of cache.values())gl.deleteTexture(texture);cache.clear();}};
}
