float cloudBaseDensity(vec3 point,float footprint,bool detailed){
  float height=(length(point)-1.)*6371.;
  if(height<.6 || height>12.)return 0.;
  float coverage=cloudCoverage(point,footprint,detailed);
  if(coverage<.001)return 0.;
  // Coverage is observed; cloud families and heights are illustrative. Blend
  // regional regimes rather than stamping the same vertical bell everywhere.
  vec3 material=cloudCoordinates(point),horizontal=normalize(material);
  float regional=filteredCloudNoise(horizontal+vec3(17.,31.,9.)/38.,38.,footprint);
  float neighborhood=regional>.46?cloudCoverage(point,max(footprint,.0025),false):coverage;
  float convection=smoothstep(.57,.78,regional)*smoothstep(.64,.90,neighborhood);
  float sheet=1.-smoothstep(.34,.60,regional);
  float ice=smoothstep(.46,.70,regional)*(1.-smoothstep(.45,.82,neighborhood));
  if(height>6.5 && convection+ice<.001)return 0.;
#ifdef TEXTURE_SHAPED_CLOUDS
  // Keep observed fine structure. Only the broad regime is illustrative;
  // brightness is not a measured cloud genus or a retrieved cloud height.
  // No extra texture, no fine 3D noise and no holes carved into dense decks.
  float lowBase=.7+.45*regional,lowTop=1.9+.8*coverage;
  float deck=smoothstep(lowBase,lowBase+.5,height)
    *(1.-smoothstep(lowTop-.35,lowTop+.35,height));
  float rise=convection*smoothstep(.20,.95,coverage);
  float base=1.15+.35*regional,top=2.3+2.9*smoothstep(.12,.90,coverage);
  top+=rise*(3.5+2.*coverage);
  float cumulus=smoothstep(base,base+.5+rise*.1,height)
    *(1.-smoothstep(top-.65-rise*.55,top+.25+rise*.3,height));
  float cirrus=exp(-.5*pow((height-9.5)/.65,2.));
  float density=sheet*deck*.65+(1.-sheet)*cumulus*mix(.55,.65,rise)
    +ice*cirrus*.09;
  return pow(coverage,1.35)*density*.925*(1.-smoothstep(11.5,12.,height));
#else
  // Rotate the cellular domain and mix scales so value-noise grid axes do not
  // become rows of identical puffs when viewed straight down.
  vec3 cellPoint=vec3(dot(horizontal,vec3(.36,.48,-.8)),
    dot(horizontal,vec3(-.8,.6,0.)),dot(horizontal,vec3(.48,.64,.6)));
  float coarse=filteredCloudNoise(cellPoint,1200.,footprint);
  float fine=filteredCloudNoise(material*vec3(.45,1.,.8),3600.,footprint);
  float cells=.75*coarse+.25*fine;
  // The photograph owns horizontal breaks, including partial coverage.
  // Thresholding lattice noise through the whole column made digital-camo
  // holes unrelated to the observed cloud. Noise only shapes the top here.
  float connected=smoothstep(.32,.78,min(coverage,neighborhood));
  float topCells=mix(cells,.5+(cells-.5)*.45,connected*(1.-convection));

  // Low decks have shallow, cellular tops. Broken cumulus has a common base
  // and separate rounded tops; coverage still prevents invented cloud at sea.
  float lowBase=.7+.45*regional,lowTop=1.8+.9*topCells;
  float deck=smoothstep(lowBase,lowBase+.5,height)
    *(1.-smoothstep(lowTop-.35,lowTop+.35,height));
  // Deep clouds grow from the same textured body. A separate opaque tower
  // plus a fixed-height anvil turned the broad regime mask into smooth lids.
  // Vary height continuously with observed coverage and the existing cells;
  // keep that structure in both the crown and its shadows, without new noise.
  float rise=convection*smoothstep(.20,.95,coverage);
  float base=1.15+.35*regional,top=2.6+3.1*topCells*smoothstep(.12,.80,coverage);
  top+=rise*(3.5+2.*topCells);
  float cumulus=smoothstep(base,base+.5+rise*.1,height)
    *(1.-smoothstep(top-.65-rise*.55,top+.25+rise*.3,height));

  // A translucent ice veil can still coexist with the continuous deep body.
  float cirrus=exp(-.5*pow((height-9.5)/.65,2.))*(.45+.55*fine);
  float density=sheet*deck*.65+(1.-sheet)*cumulus*mix(.55,.65,rise)
    +ice*cirrus*.12;
  return pow(coverage,1.35)*density*(.85+.15*fine)*(1.-smoothstep(11.5,12.,height));
#endif
}
