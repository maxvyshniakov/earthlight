export function modisStudyURL(base:string,view:'day'|'low'|'oblique'='day',mode='modis'){
  const url=new URL('/',base),rad=Math.PI/180;
  const lat=(view==='oblique'?-32:-29.5)*rad,lon=-83*rad,altitude=view==='oblique'?250:455;
  const radius=1+altitude/6371;
  const position=[Math.cos(lat)*Math.cos(lon),Math.cos(lat)*Math.sin(lon),Math.sin(lat)].map(x=>x*radius);
  const heading=[-Math.sin(lat)*Math.cos(lon),-Math.sin(lat)*Math.sin(lon),Math.cos(lat)];
  const settings={cloudStudy:mode,cloudShape:'texture',render:'compact',motion:'0',flight:'free',position:position.join(','),heading:heading.join(','),elevation:String((view==='oblique'?-35:-80)*rad),t:'0',epoch:view==='low'?'2025-06-01T22:00:00Z':'2025-06-01T17:00:00Z','exposure-mode':'manual','exposure-fixed':'0','look-grain':'0','look-chromatic':'0',aurora:'0'};
  for(const [key,value] of Object.entries(settings))url.searchParams.set(key,value);
  return url;
}
