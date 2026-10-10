import assert from 'node:assert/strict';
import {spawn,execFileSync} from 'node:child_process';
import {createInterface} from 'node:readline';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));

export async function sceneDevice(browser,base){
let evaluate,navigate,close,capabilities,touchDrag,installInitScript,captureScreenshot;
if(browser==='safari-mcp'){
  const process=spawn('safaridriver',['--mcp']);let sequence=0;const pending=new Map();
  createInterface({input:process.stdout}).on('line',line=>{
    const reply=JSON.parse(line);const request=pending.get(reply.id);if(!request)return;
    clearTimeout(request.timer);pending.delete(reply.id);reply.error?request.reject(Error(JSON.stringify(reply.error))):request.resolve(reply.result);
  });
  const call=(method,params)=>new Promise((resolve,reject)=>{
    const id=++sequence,timer=setTimeout(()=>{pending.delete(id);reject(Error(`Safari MCP timeout: ${method}`));},180000);
    pending.set(id,{resolve,reject,timer});process.stdin.write(JSON.stringify({jsonrpc:'2.0',id,method,params})+'\n');
  });
  const tool=async(name,args)=>{
    const result=await call('tools/call',{name,arguments:args});const text=result.content.filter(x=>x.type==='text').map(x=>x.text).join('\n');
    if(result.isError)throw Error(text);try{return JSON.parse(text);}catch{return text;}
  };
  capabilities=await call('initialize',{protocolVersion:'2025-03-26',capabilities:{},clientInfo:{name:'orbit-validation',version:'1'}});
  process.stdin.write(JSON.stringify({jsonrpc:'2.0',method:'notifications/initialized'})+'\n');
  const {handle}=await tool('create_tab',{url:'about:blank'});
  await tool('set_viewport_size',{width:1440,height:900});
  navigate=url=>tool('navigate_to_url',{url,tab_uuid:handle});
  evaluate=source=>tool('evaluate_javascript',{expression:`return (${source});`});
  close=async()=>{try{await tool('close_tab',{handle});}finally{process.kill();}};
}else if(browser==='safari'){
  let id;
  const request=async(path,body,method=body?'POST':'GET')=>{
    const response=await fetch(`http://127.0.0.1:4348${path}`,{method,headers:{'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
    const {value}=await response.json();if(!response.ok)throw Error(JSON.stringify(value));return value;
  };
  const session=await request('/session',{capabilities:{alwaysMatch:{browserName:'safari'}}});id=session.sessionId;capabilities=session.capabilities;
  close=()=>request(`/session/${id}`,undefined,'DELETE');
  await request(`/session/${id}/timeouts`,{script:180000,pageLoad:90000});
  await request(`/session/${id}/window/rect`,{width:1440,height:1000});
  navigate=url=>request(`/session/${id}/url`,{url});
  evaluate=async source=>{
    const value=await request(`/session/${id}/execute/async`,{script:`const done=arguments[arguments.length-1];Promise.resolve().then(()=>(${source})).then(value=>done({value}),error=>done({error:String(error.stack||error)}));`,args:[]});
    if(value.error)throw Error(value.error);return value.value;
  };
}else{
  const info=await(await fetch('http://127.0.0.1:9223/json/version')).json();capabilities={browser:info.Browser};
  const socket=new WebSocket(info.webSocketDebuggerUrl);await new Promise((r,j)=>{socket.onopen=r;socket.onerror=j;});
  let sequence=0;const pending=new Map();
  socket.onmessage=event=>{const reply=JSON.parse(event.data);if(!reply.id)return;const waiter=pending.get(reply.id);if(!waiter)return;pending.delete(reply.id);clearTimeout(waiter.timer);reply.error?waiter.reject(Error(JSON.stringify(reply.error))):waiter.resolve(reply.result);};
  const call=(method,params={},sessionId)=>new Promise((resolve,reject)=>{
    const id=++sequence,timer=setTimeout(()=>{pending.delete(id);reject(Error(`CDP timeout: ${method}`));},180000);
    pending.set(id,{resolve,reject,timer});socket.send(JSON.stringify({id,method,params,...(sessionId?{sessionId}:{})}));
  });
  // Android Target.createTarget makes a WebContents without a visible native
  // Chrome tab. Its visibilityState can say visible while RAF never runs.
  const initial=`${base}/?device-test=${Date.now()}&motion=0`;
  const quotedInitial="'"+initial.replaceAll("'","'\\''")+"'";
  execFileSync('rtk',['proxy','adb','shell','am','start','-a','android.intent.action.VIEW','-d',quotedInitial,'-p','com.android.chrome'],{stdio:'ignore'});
  let target;
  for(let i=0;i<40&&!target;i++){target=(await call('Target.getTargets')).targetInfos.find(t=>t.url===initial);if(!target)await sleep(250);}
  assert.ok(target,'Android Chrome did not open the native test tab');
  const {targetId}=target;
  const {sessionId}=await call('Target.attachToTarget',{targetId,flatten:true});
  await call('Page.enable',{},sessionId);await call('Runtime.enable',{},sessionId);
  await call('Page.bringToFront',{},sessionId);
  close=async()=>{await call('Target.closeTarget',{targetId});socket.close();};
  navigate=async url=>{await call('Page.navigate',{url},sessionId);};
  installInitScript=source=>call('Page.addScriptToEvaluateOnNewDocument',{source},sessionId);
  captureScreenshot=async options=>(await call('Page.captureScreenshot',{format:'png',fromSurface:true,captureBeyondViewport:false,...options},sessionId)).data;
  evaluate=async source=>{const reply=await call('Runtime.evaluate',{expression:source,awaitPromise:true,returnByValue:true},sessionId);if(reply.exceptionDetails)throw Error(JSON.stringify(reply.exceptionDetails));return reply.result.value;};
  touchDrag=async(x,y,dx,dy)=>{
    const touch=(type,points)=>call('Input.dispatchTouchEvent',{type,touchPoints:points},sessionId);
    await touch('touchStart',[{x,y,id:0}]);
    for(let i=1;i<=8;i++){await touch('touchMove',[{x:x+dx*i/8,y:y+dy*i/8,id:0}]);await sleep(20);}
    await touch('touchEnd',[]);
  };
}

return {evaluate,navigate,close,capabilities,touchDrag,installInitScript,captureScreenshot};
}
