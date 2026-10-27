'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {createRequire}=require('node:module');
const {createHand,act,publicHand,legalActions}=require('../miniprogram/lib/engine');
const {tableView}=require('../miniprogram/lib/presentation');
const fixture=require('../docs/fixtures/shuffle-v1.json');
const {scenario}=require('./scenarios');

function apiModule(wx,config={apiBase:'http://127.0.0.1:8787',development:true}){
  const context={wx,module:{exports:{}},require:()=>config,setTimeout,clearTimeout};
  vm.runInNewContext(fs.readFileSync('miniprogram/lib/api.js','utf8'),context);
  return context.module.exports;
}
function page(name,api={},wx={},config,timers={}){
  const filename=path.resolve('miniprogram/pages/'+name+'/index.js');
  const nativeRequire=createRequire(filename);
  let definition;
  vm.runInNewContext(fs.readFileSync(filename,'utf8'),{Page(value){definition=value;},wx,setTimeout,clearTimeout,setInterval,clearInterval,...timers,require(target){return target==='../../lib/api'?api:target==='../../config'&&config?config:nativeRequire(target);}});
  return {...definition,data:JSON.parse(JSON.stringify(definition.data)),setData(patch,callback){for(const [path,value] of Object.entries(patch)){const keys=path.split(/[.\[\]]/).filter(Boolean),last=keys.pop();keys.reduce((target,key)=>target[key],this.data)[last]=value===undefined?null:JSON.parse(JSON.stringify(value));}if(callback)callback();}};
}
function nativeCanvas(){
  const harness={operations:[],frames:new Map(),ready:true,queries:0,defer:false,anchors:Array.from({length:4},(_,seat)=>({left:100*seat,top:80,width:50,height:58}))};let serial=0;
  const context=new Proxy({createLinearGradient:()=>({addColorStop(){}}),createRadialGradient:()=>({addColorStop(){}})},{get(target,key){return key in target?target[key]:(...args)=>harness.operations.push({method:key,args});}});
  harness.node={getContext:type=>{assert.equal(type,'2d');return context;},requestAnimationFrame(fn){const id=++serial;harness.frames.set(id,fn);return id;},cancelAnimationFrame(id){harness.frames.delete(id);}};
  harness.frame=()=>{const [id,fn]=harness.frames.entries().next().value;harness.frames.delete(id);fn();};
  harness.wx={getWindowInfo:()=>({windowWidth:844,windowHeight:390,pixelRatio:2,safeArea:{left:44,right:800,top:0,bottom:370}}),createSelectorQuery(){const selectors=[];return {select(selector){selectors.push(selector);return this;},fields(){return this;},boundingClientRect(){return this;},exec(callback){if(selectors.includes('#interaction-canvas'))harness.queries++;const deliver=()=>callback(selectors.map(selector=>selector==='#interaction-canvas'?harness.ready?{node:harness.node,width:844,height:390}:null:harness.anchors[Number(selector.replace('#interaction-avatar-',''))]));if(harness.defer&&selectors.includes('#interaction-canvas'))harness.deliver=deliver;else deliver();}};}};
  return harness;
}
function roomView(hand,seat){return {code:'ABCD1234',seat,ownerId:'user0',revision:1,ready:[false,false,false,false],settings:{handsPerMatch:1},seats:Array.from({length:4},(_,i)=>({id:'user'+i,name:'Friend '+i,online:true})),match:{id:hand.matchId,status:hand.phase==='finished'?'complete':'active',settings:{handsPerMatch:1},seats:Array.from({length:4},(_,i)=>({playerId:'user'+i,name:'Friend '+i})),continueReady:[false,false,false,false],hand:publicHand(hand,seat)}};}
function handWithDraw(){
  let hand=createHand({...fixture});
  for(let seat=0;seat<4;seat++)hand=act(hand,seat,{id:'motion-ack'+seat,kind:'ack',code:hand.wallCode});
  hand=act(hand,hand.actor,{id:'motion-first-discard',...legalActions(hand,hand.actor).find(action=>action.kind==='discard')});
  if(hand.phase==='responses')for(let seat=0;seat<4;seat++)if(hand.pending.responses[seat]===null)hand=act(hand,seat,{id:'motion-pass'+seat,kind:'pass'});
  return hand;
}
function browser(timers={}){
  const elements=new Map();
  const context=vm.createContext({
    MahjongCosmetics:require('../miniprogram/lib/cosmetics'),
    MahjongLayout:require('../miniprogram/lib/layout'),
    URLSearchParams,location:{origin:'http://127.0.0.1:8787',pathname:'/dev',search:''},history:{replaceState(){}},
    document:{getElementById(id){if(!elements.has(id))elements.set(id,{value:'',textContent:'',innerHTML:'',insertAdjacentHTML(position,html){this.innerHTML+=html;},remove(){this.innerHTML='';}});return elements.get(id);},querySelector(){return null;},querySelectorAll(){return [];}},
    sessionStorage:{getItem(){return null;}},localStorage:{getItem(){return null;}},crypto:{randomUUID:()=> 'test'},setTimeout,clearTimeout,...timers,
  });
  const source=/<script>([\s\S]*?)<\/script>/.exec(fs.readFileSync('tools/dev.html','utf8'))[1];
  vm.runInContext(source,context);
  return {context,elements};
}

test('all four client perspectives separate the current draw without exposing opponent tile identities or river labels',()=>{
  const hand=handWithDraw();
  for(let seat=0;seat<4;seat++){
    const snapshot=roomView(hand,seat),view=tableView(snapshot),drawing=view.players[hand.actor];
    assert.equal(drawing.hand.filter(face=>face.last).length,1);assert.equal(drawing.hand.at(-1).last,true);
    if(seat!==hand.actor)assert.ok(drawing.hand.every(face=>face.id===null));
    const {context,elements}=browser();context.snapshot=snapshot;
    vm.runInContext("user={id:'user'+snapshot.seat};room=snapshot;render()",context);
    const html=elements.get('room').innerHTML;
    const position=['bottom','right','top','left'][(hand.actor-seat+4)%4];
    const rack=html.split('class="rack '+position+'" data-seat="'+hand.actor+'">')[1].split('</div></div>')[0];
    assert.equal((rack.match(/class="tile [^"]*latest/g)||[]).length,1);
    assert.doesNotMatch(html,/class="discard-kind"|class="tile [^"]*(?:handcut|tsumogiri)/);
    const tableWxml=fs.readFileSync('miniprogram/pages/table/index.wxml','utf8');assert.doesNotMatch(tableWxml,/cut-mark|river-cell/);
  }
});

test('native hand cuts leave a closing slot with immediate river tiles and stable drag indexes in every view',()=>{
  const hand=handWithDraw(),choice=legalActions(hand,hand.actor).find(action=>action.kind==='discard'&&action.tile!==hand.lastDraw);
  const afterHand=act(hand,hand.actor,{id:'native-close',...choice});
  for(let seat=0;seat<4;seat++){
    const before=roomView(hand,seat),after={...roomView(afterHand,seat),revision:2},timers=[];
    const view=page('table',{watchRoom:()=>()=>{}},{createSelectorQuery(){throw new Error('Hand closing needs no flight geometry');}},undefined,{setTimeout(fn,ms){timers.push({fn,ms});return timers.length;},clearTimeout(){}});
    view.accept(before);view.accept(after);
    const faces=view.data.vm.players[hand.actor].hand,gap=faces.find(face=>face.gap);
    assert.ok(gap);assert.equal(gap.style,'animation-delay:0ms');
    assert.equal(faces.filter(face=>!face.gap).length,afterHand.players[hand.actor].hand.length);
    assert.deepEqual(faces.filter(face=>!face.gap).map(face=>face.handIndex),Array.from({length:afterHand.players[hand.actor].hand.length},(_,i)=>i));
    assert.equal(view.data.vm.players[hand.actor].discards.at(-1).id,choice.tile);
    assert.equal(view.data.vm.players[hand.actor].discards.at(-1).inFlight,undefined,'river tile is never hidden');
    assert.equal(timers.length,1);assert.equal(timers[0].ms,480);
    view.render();view.accept(after);assert.equal(timers.length,1);assert.equal(view.data.vm.players[hand.actor].hand.find(face=>face.gap).style,gap.style);
    timers[0].fn();assert.ok(view.data.vm.players[hand.actor].hand.every(face=>!face.gap));
    view.onHide();view.data.room=before;view.onShow();view.accept(after);
    assert.ok(view.data.vm.players[hand.actor].hand.every(face=>!face.gap));assert.equal(timers.length,1,'returning establishes a fresh baseline');view.onHide();
  }
});

test('native draw cuts animate the separated draw slot for every perspective',()=>{
  const hand=handWithDraw(),afterHand=act(hand,hand.actor,{id:'native-direct-cut',kind:'discard',tile:hand.lastDraw});
  for(let seat=0;seat<4;seat++){
    const timers=[],view=page('table',{}, {},undefined,{setTimeout(fn){timers.push(fn);return timers.length;},clearTimeout(){}});
    view.accept(roomView(hand,seat));view.accept({...roomView(afterHand,seat),revision:2});
    const faces=view.data.vm.players[hand.actor].hand;
    assert.ok(faces.some(face=>face.gap),'draw cut keeps a closing slot at the drawn-tile position');
    assert.equal(timers.length,1);
    assert.equal(view.data.vm.players[hand.actor].discards.at(-1).id,hand.lastDraw);
    timers[0]();assert.ok(view.data.vm.players[hand.actor].hand.every(face=>!face.gap));
    view.onHide();
  }
  assert.doesNotMatch(fs.readFileSync('miniprogram/pages/table/index.wxml','utf8'),/cut-mark|river-cell|discard-flight|discardEffects|in-flight/);
});

test('browser shows the discard immediately and resumes its closing gap through repeated renders',()=>{
  const hand=handWithDraw(),choice=legalActions(hand,hand.actor).find(action=>action.kind==='discard'&&action.tile!==hand.lastDraw);
  const before=roomView(hand,0),after={...roomView(act(hand,hand.actor,{id:'browser-close',...choice}),0),revision:2};
  const timers=[],{context,elements}=browser({setTimeout(fn,ms){timers.push({fn,ms});return timers.length;},clearTimeout(){}});
  context.before=before;context.after=after;
  vm.runInContext("user={id:'user0'};room=before;render();updateRoom(after)",context);
  let html=elements.get('room').innerHTML;assert.match(html,/class="tile discard-gap"/);
  assert.match(html,new RegExp('data-tile-id="'+choice.tile+'"'));
  assert.doesNotMatch(html,/discard-flight|in-flight/);assert.equal(timers.length,1);
  vm.runInContext('render();updateRoom(after)',context);assert.equal(timers.length,1);
  assert.match(elements.get('room').innerHTML,/animation-delay:-?\d+ms/);
  timers[0].fn();assert.doesNotMatch(elements.get('room').innerHTML,/discard-gap/);
  const cold=browser({setTimeout(){throw new Error('Cold entry must not close an old gap');}});cold.context.after=after;vm.runInContext('room=after;render()',cold.context);assert.doesNotMatch(cold.elements.get('room').innerHTML,/discard-gap/);
});

test('replay perspectives preserve the drawn gap and describe cut types on the timeline instead of the river',()=>{
  const hand=handWithDraw(),view=page('replays');
  view.data.match={id:hand.matchId,hands:[hand],settings:{handsPerMatch:1},seats:Array.from({length:4},(_,seat)=>({playerId:'user'+seat,name:'玩家'+seat}))};
  view.data.eventIndex=hand.events.length;view.data.perspective=(hand.actor+1)%4;view.render();
  const drawing=view.data.vm.players[hand.actor];assert.equal(drawing.hand.at(-1).last,true);assert.ok(drawing.hand.every(face=>face.id===null));
  view.data.eventIndex=hand.events.findIndex(event=>event.kind==='discard')+1;view.render();assert.match(view.data.eventLabel,/手切/);
  assert.doesNotMatch(fs.readFileSync('miniprogram/pages/replays/index.wxml','utf8'),/replay-cut|face\.tsumogiri/);
});

test('native partial updates use a supported POST transport without changing their body',async()=>{
  const sent=[];
  const api=apiModule({getStorageSync:()=> 'native-session',request(options){sent.push(options);options.success({statusCode:200,data:{ok:true}});}});
  await api.request('/api/rooms/ABCD1234/controls','PATCH',{autoWin:true});
  await api.request('/api/me','PATCH',{name:'微信昵称'});
  await api.request('/api/me');
  assert.deepEqual(sent.map(request=>request.method),['POST','POST','GET']);
  assert.equal(sent[0].data.autoWin,true);assert.equal(sent[1].data.name,'微信昵称');
  assert.equal(sent[0].header.Authorization,'Bearer native-session');
});

test('native connection errors identify the configured local server and distinguish domain rejection',async()=>{
  let failure;
  const wx={getStorageSync(){},request(options){options.fail(failure);}};
  const local=apiModule(wx);
  await assert.rejects(local.request('/api/me'),error=>error.message.includes('http://127.0.0.1:8787')&&error.message.includes('npm run dev'));
  failure={errMsg:'request:fail url not in domain list'};
  await assert.rejects(local.request('/api/me'),/合法域名/);
  const production=apiModule(wx,{apiBase:'https://mahjong.example',development:false});
  await assert.rejects(production.request('/api/me'),error=>error.message.includes('合法域名')&&!error.message.includes('关闭域名校验'));
  failure={errMsg:'request:fail connection refused'};
  await assert.rejects(production.request('/api/me'),error=>error.message.includes('无法连接游戏服务器')&&!error.message.includes('npm run dev'));
});

test('native WeChat login exchanges a fresh code and stores the selected nickname and session',async()=>{
  const storage=new Map(),sent=[];let codes=0;
  const api=apiModule({
    getStorageSync:key=>storage.get(key),setStorageSync:(key,value)=>storage.set(key,value),
    login({success}){success({code:'one-use-'+ ++codes});},
    request(options){sent.push(options);options.success({statusCode:200,data:{token:'app-session',user:{id:'wx-user',name:'微信昵称'}}});},
  },{development:false,apiBase:'https://mahjong.example'});
  const user=await api.login('微信昵称');
  assert.equal(sent[0].url,'https://mahjong.example/api/login/wechat');
  assert.equal(sent[0].data.code,'one-use-1');assert.equal(sent[0].data.name,'微信昵称');
  assert.equal(storage.get('sessionToken'),'app-session');assert.equal(storage.get('user').id,user.id);
  await api.login();assert.equal(sent[1].data.code,'one-use-2');assert.equal(sent[1].data.name,undefined);
  await api.command({code:'ABCD1234',revision:7,matchId:'completed-match',match:null,settings:{handsPerMatch:8}},{kind:'ready',ready:true});
  assert.equal(sent[2].data.matchId,'completed-match');assert.equal(sent[2].data.handsPerMatch,8);
});

test('an invite survives first-login failure and joins automatically after retry with the submitted nickname',async()=>{
  const storage=new Map([['invitedRoom','ABCD1234']]),names=[],navigations=[];let full=true,watching=0;
  const room=roomView(createHand({...fixture}),0);
  const wx={getStorageSync:key=>storage.get(key),setStorageSync:(key,value)=>storage.set(key,value),removeStorageSync:key=>storage.delete(key),navigateTo:value=>navigations.push(value.url)};
  const api={
    actionId:()=> 'invite-join',watchRoom(){watching++;return ()=>{};},
    async login(name){names.push(name);storage.set('sessionToken','wx-session');},
    async request(path){if(path==='/api/me')return {user:{id:'user0',name:names[0]},rooms:[]};assert.equal(path,'/api/rooms/ABCD1234/join');if(full)throw Object.assign(new Error('房间已满'),{status:409});return room;},
  };
  const view=page('lobby',api,wx,{development:false});view.onLoad({room:'abcd1234'});await view.onShow();
  assert.equal(view.data.user,null);assert.equal(view.data.joinCode,'ABCD1234');
  view.data.name='stale input';await view.login({detail:{value:{nickname:'微信昵称'}}});
  assert.deepEqual(names,['微信昵称']);assert.match(view.data.error,/房间已满/);
  assert.equal(view.invite,'ABCD1234');assert.equal(storage.get('invitedRoom'),'ABCD1234');
  full=false;await view.onShow();
  assert.equal(names.length,1);assert.equal(view.invite,null);assert.equal(storage.has('invitedRoom'),false);
  assert.equal(view.data.room.code,'ABCD1234');assert.deepEqual(navigations,['/pages/table/index?room=ABCD1234']);assert.equal(watching,1);
  view.onHide();
});

test('a warm WeChat invitation restores expired identity and rejoins without losing the room',async()=>{
  const storage=new Map([['sessionToken','expired']]);let app,calls=0,restored=0;
  const wx={getStorageSync:key=>storage.get(key),setStorageSync:(key,value)=>storage.set(key,value),removeStorageSync:key=>storage.delete(key),navigateTo(){}};
  vm.runInNewContext(fs.readFileSync('miniprogram/app.js','utf8'),{App(value){app=value;},wx});
  app.onShow({query:{room:'abcd1234'}});app.onShow({query:{room:'../invalid'}});
  const room=roomView(createHand({...fixture}),0);
  const api={
    actionId:()=> 'warm-join',watchRoom:()=>()=>{},
    async login(name){assert.equal(name,undefined);restored++;storage.set('sessionToken','renewed');},
    async request(path){if(path==='/api/me'){if(++calls===1)throw Object.assign(new Error('登录已过期'),{status:401});return {user:{id:'user0',name:'已存昵称'},rooms:[]};}assert.equal(path,'/api/rooms/ABCD1234/join');return room;},
  };
  const view=page('lobby',api,wx,{development:false});view.onLoad({});await view.onShow();
  assert.equal(restored,1);assert.equal(view.data.user.name,'已存昵称');assert.equal(view.data.room.code,'ABCD1234');
  assert.equal(storage.has('invitedRoom'),false);assert.equal(view.onShareAppMessage().path,'/pages/lobby/index?room=ABCD1234');
  view.onHide();
});

test('lobby restores identity while cloud image URLs are still loading',async t=>{
  let resolveAssets,reads=0,finished=false;
  const assets=new Promise(resolve=>{resolveAssets=resolve;});
  t.after(()=>resolveAssets());
  t.mock.method(require('../miniprogram/lib/cloud-assets'),'ensure',()=>assets);
  const view=page('lobby',{async request(path){assert.equal(path,'/api/me');reads++;return {user:{id:'user0',name:'Player'},rooms:[]};}},
    {getStorageSync:key=>key==='sessionToken'?'session':null},{development:false});
  const showing=view.onShow().then(()=>{finished=true;});
  assert.equal(reads,1,'identity restore must not wait for four image URL lookups');
  await new Promise(setImmediate);assert.equal(view.data.user.id,'user0');assert.equal(finished,false);
  resolveAssets();await showing;assert.equal(finished,true);view.onHide();
});

test('browser invites take precedence over saved rooms and join after first login or with an existing session',async()=>{
  for(const signedIn of [false,true]){
    const storage=new Map(signedIn?[['token','existing'],['user',JSON.stringify({id:'user0',name:'牌友'})],['room','OTHER123']]:[]),requests=[];
    const room={...roomView(createHand({...fixture}),0),match:null};
    const {context,elements}=browser({
      location:{origin:'http://127.0.0.1:8787',pathname:'/dev',search:'?room=abcd1234'},
      sessionStorage:{getItem:key=>storage.get(key)||null,setItem:(key,value)=>storage.set(key,value)},
      async fetch(path,options){requests.push({path,options});if(options.method==='GET')return new Promise(()=>{});return {ok:true,json:async()=>path==='/api/login/dev'?{token:'new-session',user:{id:'user0',name:'牌友'}}:room};},
    });
    if(!signedIn){assert.equal(elements.get('code').value,'ABCD1234');await elements.get('login').onclick();}
    else await new Promise(setImmediate);
    assert.ok(requests.some(item=>item.path==='/api/rooms/ABCD1234/join'));
    assert.ok(!requests.some(item=>item.path.includes('OTHER123')));
    assert.equal(vm.runInContext('room.code',context),'ABCD1234');assert.equal(vm.runInContext('invitedRoom',context),'');
  }
});

test('shared and role stickers render on both clients, and native sends use the same room endpoint',async()=>{
  let hand=createHand({...fixture});for(let seat=0;seat<4;seat++)hand=act(hand,seat,{id:'emote-ready'+seat,kind:'ack',code:hand.wallCode});
  const snapshot=roomView(hand,2);snapshot.characters=['ironclad','silent','defect','watcher'];
  snapshot.emotes=[{emote:'common_laugh',character:'watcher',expiresAt:new Date(Date.now()+3000).toISOString()},{emote:'joy',character:'silent',expiresAt:new Date(Date.now()+3000).toISOString()},null,null];
  const projection=tableView(snapshot);assert.equal(projection.players[0].emote.emoji,'😂');assert.match(projection.players[1].emote.sheet,/silent-sheet/);assert.equal(projection.emoteChoices.length,5);assert.equal(projection.commonEmotes.length,8);
  const {context,elements}=browser({setTimeout:()=>0,clearTimeout(){}});context.snapshot=snapshot;
  vm.runInContext("user={id:'user2'};room=snapshot;panel='emotes';emotePack='common';render();",context);
  const html=elements.get('room').innerHTML;assert.match(html,/通用表情/);assert.equal((html.match(/data-emote=/g)||[]).length,8);assert.match(html,/common_laugh/);assert.match(html,/aria-label="发送笑哭表情"/);assert.match(html,/😂/);assert.doesNotMatch(html,/NaN/);
  let sent,calls=0;
  const view=page('table',{actionId:()=> 'native-shared',async request(path,method,body){calls++;sent={path,method,body};const next=JSON.parse(JSON.stringify(snapshot));next.revision++;next.emotes[2]={...next.emotes[0],emote:body.emote};return next;}});
  try{
    view.onLoad({room:snapshot.code});view.accept(snapshot);view.toggleEmotes();assert.equal(view.data.emoteOpen,true);await view.emote({currentTarget:{dataset:{emote:'common_like'}}});
    assert.equal(sent.path,'/api/rooms/ABCD1234/emotes');assert.equal(sent.body.emote,'common_like');assert.equal(sent.body.id,'native-shared');
    assert.equal(view.data.vm.self.emote.emoji,'👍');assert.equal(view.data.emoteOpen,false);
    await view.emote({currentTarget:{dataset:{emote:'joy'}}});assert.equal(calls,1,'native blocks another pack during the shared cooldown');
    view.data.room.emotes[2].expiresAt=new Date(0).toISOString();view.render();
    await view.emote({currentTarget:{dataset:{emote:'common_think'}}});assert.equal(calls,2,'native re-enables sending after expiry');
    const expired=JSON.parse(JSON.stringify(snapshot));expired.emotes[0].expiresAt=new Date(0).toISOString();assert.equal(tableView(expired).players[0].emote,null);
  }finally{view.onHide();}
});

test('browser blocks pending and cooling emotes across packs, then allows sending after expiry',async()=>{
  const snapshot=roomView(handWithDraw(),0),timers=[],{context,elements}=browser({setTimeout(fn,ms){timers.push({fn,ms});return timers.length;},clearTimeout(){}});
  let resolvePost,calls=0;
  context.snapshot=snapshot;context.post=()=>{calls++;return new Promise(resolve=>{resolvePost=resolve;});};
  vm.runInContext("room=snapshot;user={id:'user0'};panel='emotes';request=()=>post();render()",context);
  const sending=vm.runInContext("sendEmote('joy')",context);
  assert.equal(vm.runInContext('emotePending',context),true);assert.equal(calls,1);
  await vm.runInContext("sendEmote('common_like')",context);assert.equal(calls,1,'pending request is locked across packs');
  assert.equal((elements.get('room').innerHTML.match(/aria-label="发送[^"]+表情" disabled/g)||[]).length,5);
  const accepted=JSON.parse(JSON.stringify(snapshot));accepted.revision++;
  accepted.emotes=[{id:'new-emote',emote:'joy',character:'ironclad',sentAt:new Date().toISOString(),expiresAt:new Date(Date.now()+3000).toISOString()},null,null,null];
  resolvePost(accepted);await sending;
  assert.equal(vm.runInContext('emotePending',context),false);
  vm.runInContext("panel='emotes';emotePack='common';render()",context);
  assert.equal((elements.get('room').innerHTML.match(/aria-label="发送[^"]+表情" disabled/g)||[]).length,8);
  await vm.runInContext("sendEmote('common_like')",context);assert.equal(calls,1,'cooldown prevents another network request');
  const deadline=accepted.emotes[0].expiresAt;
  vm.runInContext('render();selectedTile=room.match.hand.actions.find(a=>a.kind===\'discard\')?.tile;render()',context);
  assert.equal(accepted.emotes[0].expiresAt,deadline,'hand selection cannot extend the original display time');
  accepted.emotes[0].expiresAt=new Date(0).toISOString();vm.runInContext('render()',context);
  assert.equal(vm.runInContext('canSendEmote()',context),true);
  assert.equal((elements.get('room').innerHTML.match(/aria-label="发送[^"]+表情" disabled/g)||[]).length,0);
  vm.runInContext("request=async()=>{throw new Error('连接失败')}",context);
  await assert.rejects(vm.runInContext("sendEmote('common_like')",context),/连接失败/);
  assert.equal(vm.runInContext('emotePending',context),false,'failed sends release the pending lock');
});

test('interaction picker selects another player, locks pending sends and stops at the shared quota',async()=>{
  const snapshot=roomView(handWithDraw(),0);snapshot.interactionRemaining=1;
  snapshot.emotes=[{id:'ordinary',emote:'joy',character:'ironclad',expiresAt:new Date(Date.now()+3000).toISOString()},null,null,null];
  const {context,elements}=browser({setTimeout:()=>0,clearTimeout(){}});let calls=0,sent;
  context.snapshot=snapshot;context.post=async(path,method,body)=>{calls++;sent={path,method,body};return {...snapshot,revision:2,interactionRemaining:0,interactions:[]};};
  vm.runInContext("user={id:'user0'};room=snapshot;panel='emotes';emotePack='interaction';request=(path,method,body)=>post(path,method,body);render()",context);
  const html=elements.get('room').innerHTML;assert.match(html,/本局剩余 1 \/ 50 次/);assert.equal((html.match(/data-interaction-target=/g)||[]).length,3);assert.equal((html.match(/data-interaction=/g)||[]).length,2);
  vm.runInContext('interactionTarget=2',context);const sending=vm.runInContext("sendInteraction('tomato')",context);
  await vm.runInContext("sendInteraction('water')",context);await sending;
  assert.equal(calls,1);assert.equal(sent.path,'/api/rooms/ABCD1234/interactions');assert.equal(sent.method,'POST');assert.equal(sent.body.target,2);assert.equal(sent.body.effect,'tomato');assert.equal(sent.body.matchId,snapshot.match.id);assert.equal(sent.body.handNo,snapshot.match.hand.handNo);
  assert.equal(vm.runInContext('interactionPending',context),false);assert.equal((elements.get('room').innerHTML.match(/data-interaction="[^"]+"[^>]*disabled/g)||[]).length,2);
  await vm.runInContext("sendInteraction('water')",context);assert.equal(calls,1);
  assert.equal(vm.runInContext('room.emotes[0].expiresAt',context),snapshot.emotes[0].expiresAt,'interactions do not restart ordinary emotes');
});

test('clicking an opponent avatar opens a focused interaction menu for that player',()=>{
  const snapshot=roomView(handWithDraw(),0);snapshot.seats[2].name='朋友<二>';
  const {context,elements}=browser();context.snapshot=snapshot;vm.runInContext("room=snapshot;user={id:'user0'};render()",context);
  assert.equal((elements.get('room').innerHTML.match(/data-avatar-target=/g)||[]).length,3);
  vm.runInContext('openInteraction(0)',context);assert.equal(vm.runInContext('panel',context),'');
  vm.runInContext('openInteraction(2)',context);assert.equal(vm.runInContext('interactionTarget',context),2);assert.equal(vm.runInContext('panel',context),'interaction');
  const html=elements.get('room').innerHTML;assert.match(html,/与朋友&lt;二&gt;互动/);assert.equal((html.match(/data-interaction=/g)||[]).length,2);assert.doesNotMatch(html,/data-interaction-target=/);
});

test('browser settlement shows all four hands, deltas and final scores, with a one-time streak effect',()=>{
  const hand=scenario({hands:[[0,1,2,9,10,11,18,19,20,26,26]]}),before=roomView(hand,0),after={...roomView(act(hand,0,{id:'streak-result',kind:'win'}),0),revision:2};after.match.winStreak={seat:0,count:3};
  const timers=[],{context,elements}=browser({setTimeout(fn,ms){timers.push({fn,ms});return timers.length;},clearTimeout(){}});context.before=before;context.after=after;
  vm.runInContext("room=before;user={id:'user0'};render();updateRoom(after)",context);assert.match(elements.get('win-effects').innerHTML,/三连胜/);assert.match(elements.get('win-effects').innerHTML,/Triple Kill/);assert.equal(timers[0].ms,2200);
  timers[0].fn();let html=elements.get('room').innerHTML;assert.match(html,/大局结束 · 最终分数/);assert.equal((html.match(/class="settlement-player"/g)||[]).length,4);assert.equal((html.match(/本局 [+-]/g)||[]).length,4);
  const result=html.split('class="settlement-players"')[1].split('class="settlement-actions"')[0];assert.doesNotMatch(result,/class="tile [^"]*hidden/);
  vm.runInContext('updateRoom(after);render()',context);assert.equal(timers.length,1);
  after.match.status='active';vm.runInContext('render()',context);html=elements.get('room').innerHTML;assert.match(html,/小局结算/);assert.doesNotMatch(html,/大局结束 · 最终分数/);
});

test('native settlement reveals every hand and keeps streak effects out of cold reconnections',()=>{
  const hand=scenario({hands:[[0,1,2,9,10,11,18,19,20,26,26]]}),before=roomView(hand,1),won=act(hand,0,{id:'native-streak-result',kind:'win'}),after={...roomView(won,1),revision:2};after.match.winStreak={seat:0,count:2};
  const timers=[],view=page('table',{}, {},undefined,{setTimeout(fn,ms){timers.push({fn,ms});return timers.length;},clearTimeout(){}});
  view.accept(before);assert.equal(view.data.vm.result,null);view.accept(after);assert.equal(view.data.winEffect.badge.english,'Double Kill');assert.equal(timers[0].ms,2200);assert.equal(view.data.vm.result.complete,true);
  assert.equal(view.data.vm.result.scores.length,4);for(const row of view.data.vm.result.scores){assert.deepEqual(row.hand.map(face=>face.id),won.players[row.seat].hand.slice().sort((a,b)=>a-b));assert.equal(row.delta,(won.result.deltas[row.seat]>0?'+':'')+won.result.deltas[row.seat]/2);}
  timers[0].fn();view.accept(after);assert.equal(timers.length,1);view.onHide();
  const cold=page('table',{}, {},undefined,{setTimeout(){throw new Error('Cold settlement must not replay a streak');}});cold.accept(after);assert.equal(cold.data.winEffect,null);assert.equal(cold.data.vm.result.streak.label,'双连胜');cold.onHide();
});

test('native settlement includes all four physical tiles of added and concealed Kongs',()=>{
  const hand=scenario({hands:[[0,1,2,9,10,11,18,19,20,26,26]]}),snapshot=roomView(act(hand,0,{id:'settlement-kongs',kind:'win'}),0);
  const melds=[{kind:'addedKong',from:1,tiles:[0,1,2,3]},{kind:'concealedKong',from:0,tiles:[40,41,42,43]}];
  snapshot.match.hand.players[0].melds=melds;
  const view=tableView(snapshot);assert.equal(view.players[0].melds[0].tiles.length,3,'the table stacks the fourth tile');
  assert.deepEqual(view.result.scores[0].melds.map(meld=>meld.tiles.map(face=>face.id)),melds.map(meld=>meld.tiles),'settlement lays out every revealed tile');
});

test('native interaction sends close the picker and paint once without changing the quota fence',async()=>{
  const snapshot=roomView(handWithDraw(),0);snapshot.interactionRemaining=50;
  const canvas=nativeCanvas();let sent,calls=0;
  const api={actionId:()=> 'native-throw',async request(path,method,body){calls++;sent={path,method,body};return {...snapshot,revision:2,interactionRemaining:49,interactions:[{id:body.id,playerId:'user0',from:0,target:body.target,effect:body.effect,sentAt:new Date().toISOString(),expiresAt:new Date(Date.now()+3000).toISOString()}]};}};
  const view=page('table',api,canvas.wx);
  view.onLoad({room:snapshot.code});view.accept(snapshot);view.openInteraction({currentTarget:{dataset:{seat:2}}});
  await view.interaction({currentTarget:{dataset:{effect:'water'}}});
  assert.equal(view.data.emoteOpen,false);assert.equal(sent.path,'/api/rooms/ABCD1234/interactions');assert.equal(sent.body.target,2);assert.equal(sent.body.matchId,snapshot.match.id);assert.equal(sent.body.handNo,snapshot.match.hand.handNo);assert.equal(view.data.vm.interactionRemaining,49);
  assert.equal(view.interactionMotions.size,1);assert.equal(view.data.interactionEffects.length,1);assert.ok(canvas.operations.some(op=>op.method==='fill'),'the first frame draws actual shapes');assert.equal(canvas.node.width,1688);assert.equal(canvas.node.height,780);
  view.render();view.renderInteractions(view.data.room);assert.equal(canvas.frames.size,1,'one frame loop survives polls and selections');assert.equal(canvas.queries,1);
  for(const {motion} of view.interactionMotions.values())motion.expiresAt=0;
  canvas.frame();assert.equal(view.interactionMotions.size,0);assert.equal(view.data.interactionEffects[0].active,false);assert.equal(canvas.frames.size,0);
  view.renderInteractions(view.data.room);assert.equal(view.interactionMotions.size,0,'expired drawings do not restart');
  view.data.room.interactions[0].id='delayed-geometry';canvas.defer=true;view.renderInteractions(view.data.room);view.clearInteractions();canvas.deliver();assert.equal(view.interactionMotions.size,0,'a delayed node query cannot revive a cleared interaction');
  view.data.room.interactionRemaining=0;view.render();await view.interaction({currentTarget:{dataset:{effect:'tomato'}}});assert.equal(calls,1);view.onHide();
});

test('native canvas waits for mount, falls back from missing avatar rects and handles bursts without animation APIs',()=>{
  const snapshot=roomView(handWithDraw(),0),now=Date.now(),canvas=nativeCanvas(),timers=[];
  snapshot.interactions=[{id:'retry-effect',playerId:'user0',from:0,target:2,effect:'water',sentAt:new Date(now).toISOString(),expiresAt:new Date(now+3000).toISOString()}];
  canvas.ready=false;canvas.anchors=[];
  const view=page('table',{},canvas.wx,undefined,{setTimeout(fn){timers.push(fn);return timers.length;},clearTimeout(){}});
  view.accept(snapshot);assert.equal(view.interactionSeen.size,0);assert.equal(view.interactionMotions.size,0);assert.equal(timers.length,1);
  canvas.ready=true;timers[0]();assert.equal(view.interactionMotions.size,1,'missing avatar rectangles cannot silently discard the accepted effect');assert.equal(canvas.frames.size,1);
  const water=view.interactionMotions.values().next().value.motion;assert.ok([water.x,water.y,water.dx,water.dy].every(Number.isFinite));
  view.render();view.accept(snapshot);assert.equal(view.interactionMotions.values().next().value.motion,water);assert.equal(canvas.frames.size,1);
  snapshot.interactions=Array.from({length:200},(_,index)=>({...snapshot.interactions[0],id:'burst-'+index,effect:'tomato'}));view.accept({...snapshot,revision:2});
  assert.equal(view.interactionMotions.size,201);assert.equal(canvas.frames.size,1);assert.ok(Buffer.byteLength(JSON.stringify(view.data.interactionEffects))<128*1024,'only small accessibility/static metadata crosses the data bridge');
  canvas.frame();assert.ok(canvas.operations.some(op=>op.method==='ellipse'),'the shared loop paints tomatoes as well');
  const markup=fs.readFileSync('miniprogram/pages/table/index.wxml','utf8');assert.match(markup,/<canvas id="interaction-canvas" type="2d"/);assert.match(markup,/id="interaction-avatar-\{\{player.seat\}\}"/);assert.doesNotMatch(markup,/item.animations/);
  view.onHide();assert.equal(canvas.frames.size,0);assert.equal(view.interactionMotions.size,0);assert.equal(view.data.interactionEffects.length,0);
});

test('failed native emote and interaction sends keep the picker open for retry',async()=>{
  for(const method of ['emote','interaction']){
    const view=page('table',{actionId:()=> 'failed-send',async request(){throw new Error('连接失败');}});
    view.onLoad({room:'ABCD1234'});view.accept(roomView(handWithDraw(),0));view.toggleEmotes();
    await view[method]({currentTarget:{dataset:{emote:'joy',effect:'water'}}});
    assert.equal(view.data.emoteOpen,true);assert.equal(view.data.busy,false);assert.match(view.data.error,/连接失败/);view.onHide();
  }
});

test('completed results offer rematch readiness while unfinished matches keep next-hand continuation',async()=>{
  const snapshot=roomView(createHand({...fixture}),2);snapshot.match.hand.phase='finished';snapshot.match.status='complete';snapshot.match.hand.result={kind:'draw',deltas:[0,0,0,0]};
  const {context,elements}=browser();context.snapshot=snapshot;vm.runInContext("user={id:'user2'};room=snapshot;render();",context);
  assert.match(elements.get('room').innerHTML,/再来一局/);assert.match(elements.get('room').innerHTML,/已准备 0 \/ 4/);
  let sent;
  const view=page('table',{async command(room,input){sent=input;const next=JSON.parse(JSON.stringify(room));next.revision++;next.ready[2]=true;return next;}});
  view.accept(snapshot);await view.restart();assert.equal(sent.kind,'ready');assert.equal(sent.ready,true);assert.equal(view.data.vm.readyCount,1);
  snapshot.ready[2]=true;vm.runInContext('render()',context);assert.match(elements.get('room').innerHTML,/取消准备/);assert.match(elements.get('room').innerHTML,/已准备 1 \/ 4/);
  snapshot.match.status='active';vm.runInContext('render()',context);assert.match(elements.get('room').innerHTML,/data-kind="continue"/);assert.doesNotMatch(elements.get('room').innerHTML,/再来一局/);
});

test('both clients expose solo creation and end a test without logging the player out',async()=>{
  let hand=createHand({...fixture});for(let seat=0;seat<4;seat++)hand=act(hand,seat,{id:'solo-ui-ack'+seat,kind:'ack',code:hand.wallCode});
  const snapshot=roomView(hand,0);snapshot.testMode=true;
  const waiting={...snapshot,match:null,matchId:null,ready:[false,true,true,true]};
  snapshot.seats.slice(1).forEach((player,i)=>{player.bot=true;player.name='机器人'+'一二三'[i]+'号';snapshot.match.seats[i+1].name=player.name;});
  let created,navigated,ended=false;
  const wx={setStorageSync(){},getStorageSync(){},removeStorageSync(){},navigateTo(value){navigated=value.url;},reLaunch(value){assert.equal(value.url,'/pages/lobby/index');ended=true;}};
  const lobby=page('lobby',{async request(path,method,body){created={path,method,body};return waiting;},async command(room,input){assert.equal(input.kind,'ready');return snapshot;},watchRoom:()=>()=>{}},wx);
  await lobby.testMode();assert.equal(created.body.testMode,true);assert.equal(navigated,undefined);assert.equal(lobby.data.room.match,null);
  await lobby.ready();assert.equal(navigated,'/pages/table/index?room=ABCD1234');assert.equal(lobby.onShareAppMessage().path,'/pages/lobby/index');
  const native=page('table',{async command(room,input){assert.equal(input.kind,'leave');return {left:true};}},wx);native.accept(snapshot);await native.exitTest();assert.equal(ended,true);
  const storage=new Map([['token','local-session']]),sent=[];
  const {context,elements}=browser({
    sessionStorage:{getItem:key=>storage.get(key)||null,setItem:(key,value)=>storage.set(key,value),removeItem:key=>storage.delete(key)},
    async fetch(path,options){if(options.method==='GET')return new Promise(()=>{});const body=JSON.parse(options.body);sent.push({path,body});return {ok:true,json:async()=>body.kind==='leave'?{left:true}:body.testMode?waiting:{...snapshot,revision:2}};},
  });
  vm.runInContext("user={id:'user0'};render()",context);context.document.getElementById('hands').value='1';await elements.get('test-mode').onclick();
  assert.equal(sent[0].body.testMode,true);assert.match(elements.get('room').innerHTML,/单人测试/);assert.equal(elements.get('exit-test').hidden,false);
  assert.equal(vm.runInContext('room.match',context),null);assert.match(elements.get('room').innerHTML,/data-room-settings/);
  await vm.runInContext("send({kind:'ready',ready:true})",context);assert.equal(vm.runInContext('room.match.status',context),'active');
  await elements.get('exit-test').onclick();assert.equal(sent.at(-1).body.kind,'leave');assert.equal(vm.runInContext('room',context),null);assert.equal(storage.get('token'),'local-session');assert.equal(storage.has('room'),false);
});

test('table projection separates every latest draw on the right and keeps existing hand order',()=>{
  let hand=createHand({...fixture});
  for(let seat=0;seat<4;seat++)hand=act(hand,seat,{id:'view-ack'+seat,kind:'ack',code:hand.wallCode});
  const seat=2,wildcard=hand.wildcardType*4;
  hand.players[seat].hand[0]=wildcard;hand.lastDraw=wildcard;
  let vm=tableView(roomView(hand,seat),{sortEnabled:true});
  assert.equal(vm.self.hand[vm.self.hand.length-1].id,wildcard,'a drawn wildcard also stays on the right');
  assert.equal(vm.self.hand[vm.self.hand.length-1].last,true);
  const draw=hand.players[seat].hand[1];hand.lastDraw=draw;
  vm=tableView(roomView(hand,seat),{sortEnabled:true});
  assert.equal(vm.self.hand[vm.self.hand.length-1].id,draw,'new non-wildcard draw stays on the right');
  assert.equal(vm.self.hand[vm.self.hand.length-1].last,true);
  const order=[hand.players[seat].hand[2],hand.players[seat].hand[0]];
  vm=tableView(roomView(hand,seat),{sortEnabled:false,handOrder:order});
  assert.deepEqual(vm.self.hand.slice(0,2).map(face=>face.id),order,'sorting off respects manual order');
});

test('client retains commitments only when actually observed before dealing',()=>{
  const storage=new Map();
  const api=apiModule({getStorageSync:key=>storage.get(key),setStorageSync:(key,value)=>storage.set(key,value)});
  const hand={matchId:'m',handNo:1,wallCode:fixture.expected.wallCode,phase:'finished'};
  assert.equal(api.rememberCommitment(hand),null);assert.equal(storage.size,0);
  assert.equal(api.rememberCommitment({...hand,phase:'commit'}),hand.wallCode);
  assert.equal(api.observedCode(hand),hand.wallCode);
  assert.throws(()=>api.rememberCommitment({...hand,wallCode:'changed',phase:'commit'}),/牌山校验码发生变化/);
});

test('subscription cancels on page hide and clears expired sessions',()=>{
  const requests=[],removed=[];let aborted=0,received=0;
  const api=apiModule({getStorageSync:()=>'',removeStorageSync:key=>removed.push(key),request(options){requests.push(options);return {abort(){aborted++;}};}});
  const stop=api.watchRoom('ABCD1234',()=>received++,()=>{});
  requests[0].success({statusCode:200,data:{revision:1}});assert.equal(received,1);assert.equal(requests.length,2);
  stop();requests[1].success({statusCode:200,data:{revision:2}});assert.equal(received,1);assert.equal(aborted,1);
  api.watchRoom('ABCD1234',()=>{},()=>{});
  requests[2].success({statusCode:401,data:{error:'Expired'}});
  assert.deepEqual(removed,['sessionToken','user']);
});

test('native table selection requires confirmation; accepted command updates the projection',async()=>{
  let hand=createHand({...fixture});
  for(let seat=0;seat<4;seat++)hand=act(hand,seat,{id:'ack'+seat,kind:'ack',code:hand.wallCode});
  const seat=2;let sent=0;
  const api={async command(room,input){sent++;hand=act(hand,seat,{id:'clicked'+sent,...input});return roomView(hand,seat);}};
  const view=page('table',api);view.accept(roomView(hand,seat));
  const choice=legalActions(hand,seat).find(a=>a.kind==='discard');
  view.select({detail:{id:choice.tile}});
  assert.equal(sent,0);assert.equal(view.data.selected,choice.tile);assert.equal(view.data.selectedAction.kind,'discard');
  const other=legalActions(hand,seat).find(a=>a.kind==='discard'&&a.tile!==choice.tile);
  view.select({detail:{id:other.tile}});assert.equal(sent,0);assert.equal(view.data.selected,other.tile);
  await view.select({detail:{id:other.tile}});
  assert.equal(sent,1);assert.equal(view.data.room.match.hand.players[seat].discards.at(-1).id,other.tile);assert.equal(view.data.selected,null);
});

test('browser second-click confirmation and control toggles send different requests',async()=>{
  let hand=createHand({...fixture});for(let seat=0;seat<4;seat++)hand=act(hand,seat,{id:'two-tap-ack'+seat,kind:'ack',code:hand.wallCode});
  const seat=2,snapshot=roomView(hand,seat),sent=[];snapshot.controls={autoWin:false,skipCalls:false,autoCut:false};
  const {context,elements}=browser({async fetch(path,options){
    const body=JSON.parse(options.body);sent.push({path,method:options.method,body});let next;
    if(options.method==='PATCH')next={...snapshot,controls:{...snapshot.controls,...body},revision:2};
    else{hand=act(hand,seat,{...body,id:'two-tap-discard'});next={...roomView(hand,seat),revision:3};}
    return {ok:true,json:async()=>next};
  }});
  context.snapshot=snapshot;vm.runInContext("user={id:'user2'};room=snapshot;render()",context);
  await vm.runInContext("toggleControl('autoCut')",context);
  assert.equal(sent.length,1);assert.equal(sent[0].method,'PATCH');assert.equal(sent[0].body.autoCut,true);
  assert.match(elements.get('room').innerHTML,/data-control="autoCut"[^>]*aria-pressed="true"/);
  const options=legalActions(hand,seat).filter(action=>action.kind==='discard');context.first=options[0].tile;context.second=options[1].tile;
  await vm.runInContext('selectTile(first)',context);assert.equal(sent.length,1);
  await vm.runInContext('selectTile(second)',context);assert.equal(sent.length,1);
  await vm.runInContext('selectTile(second)',context);assert.equal(sent.length,2);assert.equal(sent[1].body.kind,'discard');assert.equal(sent[1].body.tile,options[1].tile);
  assert.equal(vm.runInContext('selectedTile',context),null);assert.equal(vm.runInContext('actionPending',context),false);
});

test('native automatic controls toggle preferences and the decisions remain separate',async()=>{
  let hand=createHand({...fixture});for(let seat=0;seat<4;seat++)hand=act(hand,seat,{id:'switch-ack'+seat,kind:'ack',code:hand.wallCode});
  const snapshot=roomView(hand,2);snapshot.controls={autoWin:false,skipCalls:false,autoCut:false};let request;
  const view=page('table',{async request(path,method,body){request={path,method,body};return {...snapshot,controls:{...snapshot.controls,...body},revision:2};}});
  view.onLoad({room:snapshot.code});view.accept(snapshot);
  await view.toggleControl({currentTarget:{dataset:{key:'autoWin'}}});
  assert.equal(request.path,'/api/rooms/ABCD1234/controls');assert.equal(request.method,'PATCH');assert.equal(request.body.autoWin,true);assert.equal(view.data.vm.controls.autoWin,true);
  assert.equal(request.body.matchId,snapshot.match.hand.matchId);assert.equal(request.body.handNo,snapshot.match.hand.handNo);
  snapshot.controls.skipCalls=true;snapshot.match.hand.actions=[{kind:'win'},{kind:'pon',type:9},{kind:'pass'}];
  assert.deepEqual(tableView(snapshot).decisions.map(action=>action.kind),['win'],'skip-calls leaves manual win available');
});

test('dragging a selected native tile does not confirm a discard',async()=>{
  let hand=createHand({...fixture});for(let seat=0;seat<4;seat++)hand=act(hand,seat,{id:'drag-ack'+seat,kind:'ack',code:hand.wallCode});
  const seat=2;let sent=0;
  const wx={createSelectorQuery(){return {in(){return this;},selectAll(){return this;},boundingClientRect(fn){fn(hand.players[seat].hand.map((id,index)=>({left:index*40,width:40})));return this;},exec(){}};}};
  const view=page('table',{async command(room,input){sent++;hand=act(hand,seat,{id:'after-drag',...input});return roomView(hand,seat);}},wx);
  view.onLoad({room:'ABCD1234'});view.accept(roomView(hand,seat));view.toggleSort();
  const tile=legalActions(hand,seat).find(action=>action.kind==='discard').tile;view.select({detail:{id:tile}});
  const handIndex=view.data.vm.self.hand.find(face=>face.id===tile).handIndex;
  view.data.vm.self.hand.splice(0,0,{gap:true,key:'closing-gap'});
  view.dragStart({currentTarget:{dataset:{index:handIndex}},touches:[{clientX:5,clientY:0}]});
  view.dragEnd({changedTouches:[{clientX:85,clientY:0}]});await view.select({detail:{id:tile}});assert.equal(sent,0);
  assert.equal(view.handOrder.length,hand.players[seat].hand.length);assert.ok(view.handOrder.every(Number.isInteger),'a closing gap is never included in manual tile order');
  view.dragStart({currentTarget:{dataset:{index:0}},touches:[{clientX:5,clientY:0}]});view.dragEnd({changedTouches:[{clientX:5,clientY:0}]});
  await view.select({detail:{id:tile}});assert.equal(sent,0,'the next real tap selects again');await view.select({detail:{id:tile}});assert.equal(sent,1);
});

test('native decision previews keep multiple Kongs distinct and submit only the original action',async()=>{
  let hand=createHand({...fixture});for(let seat=0;seat<4;seat++)hand=act(hand,seat,{id:'choice-ack'+seat,kind:'ack',code:hand.wallCode});
  const snapshot=roomView(hand,2);snapshot.match.hand.actions=[{kind:'concealedKong',type:9},{kind:'concealedKong',type:18}];let sent;
  const view=page('table',{async command(room,input){sent=input;return room;}});view.accept(snapshot);
  assert.deepEqual(view.data.vm.decisions.map(choice=>choice.glyph),['杠','杠']);
  assert.notEqual(view.data.vm.decisions[0].preview[0].image,view.data.vm.decisions[1].preview[0].image);
  await view.decision({currentTarget:{dataset:{index:1}}});assert.equal(sent.type,18);assert.deepEqual(Object.keys(sent).sort(),['kind','type']);
});

test('browser win effects play once for a live win and show settlement after their timer',()=>{
  const hand=scenario({hands:[[0,1,2,9,10,11,18,19,20,26,26]]});
  const before=roomView(hand,1),after=roomView(act(hand,0,{id:'effect-win',kind:'win'}),1);
  after.revision=2;after.match.seats[0].name='甲<祝贺>';
  const timers=[],{context,elements}=browser({setTimeout(fn,ms){timers.push({fn,ms});return timers.length;},clearTimeout(){}});
  context.before=before;context.after=after;
  vm.runInContext("user={id:'user1'};room=before;render();updateRoom(after)",context);
  const effect=elements.get('win-effects').innerHTML;assert.match(effect,/win-celebration/);assert.match(effect,/自摸/);assert.match(effect,/甲&lt;祝贺&gt;/);
  assert.doesNotMatch(elements.get('room').innerHTML,/class="result"/);
  vm.runInContext('render();updateRoom(after)',context);assert.equal(timers.length,1);assert.equal(elements.get('win-effects').innerHTML,effect);
  assert.equal(timers[0].ms,1600);timers[0].fn();assert.equal(elements.get('win-effects').innerHTML,'');assert.match(elements.get('room').innerHTML,/class="result"/);
  vm.runInContext('updateRoom(after)',context);assert.equal(timers.length,1,'polling a finished hand must not replay the effect');
  const cold=browser({setTimeout(){throw new Error('A completed reconnect must not animate');}});cold.context.after=after;vm.runInContext('room=after;render()',cold.context);assert.equal(cold.elements.get('win-effects').innerHTML,'');
});

test('native win effects identify the winner, survive rendering, and do not replay on reconnect',()=>{
  const hand=scenario({hands:[[0,1,2,9,10,11,18,19,20,26,26]]}),before=roomView(hand,1),after=roomView(act(hand,0,{id:'native-effect-win',kind:'win'}),1);
  after.revision=2;const timers=[];
  const view=page('table',{watchRoom:()=>()=>{}},{},undefined,{setTimeout(fn,ms){timers.push({fn,ms});return timers.length;},clearTimeout(){}});
  view.accept(before);view.accept(after);assert.equal(view.data.winEffect.winner,after.match.seats[0].name);assert.equal(view.data.winEffect.sparks.length,12);
  view.render();view.accept(after);assert.equal(timers.length,1);timers[0].fn();assert.equal(view.data.winEffect,null);assert.ok(view.data.vm.result);
  view.onHide();view.onShow();view.accept(after);assert.equal(timers.length,1);assert.equal(view.data.winEffect,null);view.onHide();
});

test('native table saves commitment before sending acknowledgement',async()=>{
  const hand=createHand({...fixture});const calls=[];
  const api={rememberCommitment(){calls.push('saved');},async command(room,input){assert.deepEqual(calls,['saved']);assert.equal(input.kind,'ack');calls.push('sent');return roomView(act(hand,0,{id:'ack',kind:'ack',code:hand.wallCode}),0);}};
  const view=page('table',api);view.stopped=false;
  await view.acknowledge(roomView(hand,0));
  assert.deepEqual(calls,['saved','sent']);assert.ok(view.data.room.match.hand.acknowledgements[0]);
});

test('native page bindings resolve to handlers and lobby seats have distinct keys',()=>{
  for(const name of ['lobby','table','replays','verify']){
    const view=page(name);
    const markup=fs.readFileSync('miniprogram/pages/'+name+'/index.wxml','utf8');
    for(const tag of markup.matchAll(/<mahjong-tile\b[^>]*\/>/g))assert.match(tag[0],/tile-id=/,'Use a tile property rather than the reserved element id');
    for(const handler of markup.matchAll(/(?:bind|catch):?(?:tap|input|blur|submit|change|changing|pick)="([^"]+)"/g))assert.equal(typeof view[handler[1]],'function',name+': '+handler[1]);
  }
  const lobby=page('lobby',{}, {setStorageSync(){}});
  lobby.accept({code:'ABCD1234',settings:{handsPerMatch:8},seats:[{id:'a',name:'A'},null,null,null],ready:[false,false,false,false],seat:0,match:null});
  assert.deepEqual(Array.from(lobby.data.seatCards,item=>item.seat),[0,1,2,3]);
});

test('the native tile component emits its physical tile ID, including zero',()=>{
  let definition;const filename=path.resolve('miniprogram/components/tile/index.js');
  vm.runInNewContext(fs.readFileSync(filename,'utf8'),{require:createRequire(filename),Component(value){definition=value;}});
  assert.equal(definition.options.virtualHost,true,'component hosts must not flatten the shared 3D world');
  let payload;const component={data:{tileId:0,disabled:false},triggerEvent(kind,value){assert.equal(kind,'pick');payload=value;}};
  definition.methods.pick.call(component);assert.equal(payload.id,0);
  payload=null;component.data.disabled=true;definition.methods.pick.call(component);assert.equal(payload,null);
});

test('release builds reject a development or non-HTTPS backend',async()=>{
  const api=apiModule({getAccountInfoSync:()=>({miniProgram:{envVersion:'release'}})});
  await assert.rejects(api.request('/api/me'),/正式的 HTTPS 服务地址/);
});

test('the native calculator verifies imported data without contacting a server',()=>{
  const view=page('verify',{observedCode:()=>null,request(){throw new Error('No network permitted');}});
  view.sample();assert.equal(view.data.report.status,'unverified');assert.equal(view.data.report.calculatedCode,fixture.expected.wallCode);
  view.value=null;view.data.inputText='null';view.calculate();assert.match(view.data.error,/JSON 对象/);
});

test('out-of-order room responses cannot rewind the native lobby or table',()=>{
  let hand=createHand({...fixture});
  for(let seat=0;seat<4;seat++)hand=act(hand,seat,{id:'ack'+seat,kind:'ack',code:hand.wallCode});
  const before={...roomView(hand,2),revision:10};
  const choice=legalActions(hand,2).find(action=>action.kind==='discard');
  hand=act(hand,2,{id:'discard-latest',...choice});
  const latest={...roomView(hand,2),revision:11};
  for(const name of ['lobby','table']){
    let back=0;
    const controller=page(name,{}, {setStorageSync(){},navigateTo(){},navigateBack(){back++;}});
    controller.accept(latest);controller.accept(before);
    assert.equal(controller.data.room.revision,11,name+' must retain the newest revision');
    assert.equal(controller.data.room.match.hand.phase,'own');
    controller.accept({...before,match:null});
    assert.equal(controller.data.room.revision,11);assert.equal(back,0,'a late pre-match response must not leave the table');
    const presence=JSON.parse(JSON.stringify(latest));presence.seats[1].online=false;
    controller.accept(presence);assert.equal(controller.data.room.seats[1].online,false,'same-revision presence refreshes remain valid');
  }
});

test('the development harness ignores delayed updates from older revisions or other rooms',()=>{
  const {context}=browser();
  context.snapshot={code:'ABCD1234',revision:11,settings:{handsPerMatch:1},seats:[],ready:[],ownerId:'other',seat:0,match:null};
  vm.runInContext("user={id:'test'};room=snapshot;",context);
  context.snapshot={...context.snapshot,revision:10};vm.runInContext('updateRoom(snapshot)',context);
  assert.equal(vm.runInContext('room.revision',context),11);
  context.snapshot={...context.snapshot,code:'OTHER123',revision:99};vm.runInContext('updateRoom(snapshot)',context);
  assert.equal(vm.runInContext('room.code',context),'ABCD1234');
  context.snapshot={...context.snapshot,code:'ABCD1234',revision:12};vm.runInContext('updateRoom(snapshot)',context);
  assert.equal(vm.runInContext('room.revision',context),12);
});

test('Chinese interface covers dynamic actions, results, tile labels, errors and verification',()=>{
  const {context,elements}=browser();
  let hand=createHand({...fixture});
  for(let seat=0;seat<4;seat++)hand=act(hand,seat,{id:'cn-ack'+seat,kind:'ack',code:hand.wallCode});
  const snapshot=roomView(hand,2);
  snapshot.seats.forEach((seat,i)=>seat.name='甲乙丙丁'[i]);
  snapshot.match.seats.forEach((seat,i)=>seat.name='甲乙丙丁'[i]);
  snapshot.match.hand.phase='responses';
  snapshot.match.hand.actions=[{kind:'win'},{kind:'pon'},{kind:'concealedKong',type:9},{kind:'pass'}];
  snapshot.match.hand.payments=[{payer:0,recipient:1,kind:'addedKong',amount:1}];
  context.snapshot=snapshot;
  vm.runInContext("user={id:'user2',name:'丙'};room=snapshot;render();",context);
  let html=elements.get('room').innerHTML;
  for(const text of ['等待碰杠响应','理','和','鸣','切','分'])assert.ok(html.includes(text),text);
  html=elements.get('room').innerHTML;
  for(const text of ['碰','暗杠：一条','过'])assert.ok(html.includes(text),text);
  snapshot.match.hand.phase='finished';snapshot.match.hand.actions=[];
  snapshot.match.hand.result={kind:'win',winner:0,classification:'jiahei',deltas:[0,0,0,0]};
  vm.runInContext('render()',context);html=elements.get('room').innerHTML;
  assert.match(html,/甲 · 夹黑/);assert.match(html,/本地验证/);assert.match(html,/导出牌谱/);
  const visible=html.replace(/<[^>]+>/g,'').replace(/sha256:[a-f0-9]{64}/g,'').replaceAll(snapshot.code,'');
  assert.doesNotMatch(visible,/[A-Za-z]{2,}/,'App-owned visible copy must be Chinese');
  assert.equal(vm.runInContext('tileName(null)',context),'暗牌');
  assert.equal(vm.runInContext('tileName(26)',context),'九饼');
  vm.runInContext("error(new Error('Failed to fetch'))",context);
  assert.match(elements.get('error').textContent,/操作失败/);
  for(const name of ['lobby','table','replays','verify']){
    const controller=page(name);controller.fail(new Error('Native SDK failure'));
    assert.match(controller.data.error,/[\u3400-\u9fff]/);assert.doesNotMatch(controller.data.error,/Native SDK/);
  }
  const {calculateWall}=require('../miniprogram/lib/replay');
  const report=calculateWall({...fixture,wall:fixture.expected.wall,wallCode:fixture.expected.wallCode});
  const copy=report.checks.map(check=>check.name+' '+check.detail).join(' ').replace(/sha256:[a-f0-9]{64}/g,'');
  assert.doesNotMatch(copy,/[A-Za-z]{2,}/);
});

test('browser shows character backs and five stickers; expired bubbles stay hidden on stale refresh',()=>{
  let expire;
  const {context,elements}=browser({setTimeout(fn){expire=fn;return 1;},clearTimeout(){}});
  let hand=createHand({...fixture});for(let seat=0;seat<4;seat++)hand=act(hand,seat,{id:'style-ack'+seat,kind:'ack',code:hand.wallCode});
  const snapshot=roomView(hand,2);snapshot.characters=['ironclad','silent','defect','watcher'];
  snapshot.emotes=[{id:'greeting',emote:'greet',character:'ironclad',expiresAt:new Date(Date.now()+3000).toISOString()},null,null,null];
  context.snapshot=snapshot;vm.runInContext("user={id:'user2',name:'丙'};room=snapshot;panel='emotes';render();",context);
  let html=elements.get('room').innerHTML;
  for(const id of snapshot.characters)assert.match(html,new RegExp('/assets/characters/'+id+'-sheet.webp'));
  assert.equal((html.match(/data-emote=/g)||[]).length,5);assert.match(html,/aria-label="发送你好表情"/);
  assert.match(html,/class="emote-bubble"/);assert.match(html,/--frame-x:-100%;--frame-y:0%/);
  assert.equal(typeof expire,'function');snapshot.emotes[0].expiresAt=new Date(Date.now()-1).toISOString();expire();
  assert.doesNotMatch(elements.get('room').innerHTML,/class="emote-bubble"/);
  vm.runInContext('updateRoom(snapshot)',context);assert.doesNotMatch(elements.get('room').innerHTML,/class="emote-bubble"/);
});

test('all four local atlas files match their provenance manifest',()=>{
  const {createHash}=require('node:crypto');
  const manifest=require('../assets/characters/manifest.json');
  assert.equal(manifest.files.length,8);
  for(const file of manifest.files){
    const data=fs.readFileSync(path.join('assets/characters',file.file));
    assert.equal(data.length,file.bytes);assert.equal(createHash('sha256').update(data).digest('hex'),file.sha256);
    assert.equal(file.width*2,file.height*3);assert.equal(file.alpha,true);
  }
  for(const character of require('../miniprogram/lib/cosmetics').characters)assert.ok(manifest.files.some(file=>'/assets/characters/'+file.file===character.sheet));
});

test('reference table projects relative scores and keeps settings and the lobby available',()=>{
  const {context,elements}=browser();
  let hand=createHand({...fixture});
  for(let seat=0;seat<4;seat++)hand=act(hand,seat,{id:'layout-ack'+seat,kind:'ack',code:hand.wallCode});
  hand.scores=[2,-4,6,-4];
  const snapshot=roomView(hand,2);context.snapshot=snapshot;
  vm.runInContext("user={id:'user2',name:'丙'};room=snapshot;render();",context);
  assert.equal(elements.get('app').className,'table-view');
  assert.equal(elements.get('settings').hidden,false);
  let html=elements.get('room').innerHTML;
  assert.match(html,/class="board-info"/);
  assert.match(html,/class="center-score bottom acting"[^>]*>3<small>分/);
  assert.match(html,/class="center-score right"[^>]*>-2<small>分/);
  assert.match(html,/class="center-score top"[^>]*>1<small>分/);
  assert.equal((html.match(/class="pond /g)||[]).length,4);
  vm.runInContext("panel='settings';render();",context);html=elements.get('room').innerHTML;
  for(const text of ['牌桌设置','更换牌背','角色表情','自动理牌：开启','牌山校验码','本局收支','操作说明'])assert.ok(html.includes(text),text);
  vm.runInContext('showLobby=true;render();',context);
  assert.equal(elements.get('app').className,'');
  assert.equal(elements.get('lobby').hidden,false);
});

test('the table uses one projected world and closed six-face tiles without revealing hidden faces',()=>{
  const {context,elements}=browser();
  let hand=createHand({...fixture});
  for(let seat=0;seat<4;seat++)hand=act(hand,seat,{id:'depth-ack'+seat,kind:'ack',code:hand.wallCode});
  context.snapshot=roomView(hand,2);
  vm.runInContext("user={id:'user2',name:'丙'};room=snapshot;render();",context);
  const html=elements.get('room').innerHTML;
  assert.equal((html.match(/class="table-camera"/g)||[]).length,1);
  assert.match(html,/<div class="table-world"><div class="table-surface"/);
  const cubes=(html.match(/class="tile-model"/g)||[]).length;
  assert.ok(cubes>=41);
  for(const side of ['front','back','top','base','left','right'])assert.equal((html.match(new RegExp('class="tile-face tile-'+side+'"','g'))||[]).length,cubes,side);
  const own=vm.runInContext('tiles([0],-1,2)',context);
  assert.match(own,/tile-front"><img[^>]*Man1\.png/);
  const hidden=vm.runInContext('tiles([null],-1,0,true)',context);
  assert.match(hidden,/tile-front"><\/span>/);
  assert.doesNotMatch(hidden,/\/assets\/tiles\/(?:Man|Sou|Pin)/);
  assert.match(hidden,/tile-back"><span class="sprite"/);
});

test('native table mirrors the browser depth, role backs, card backs, and safe-area insets',()=>{
  const tableWxml=fs.readFileSync('miniprogram/pages/table/index.wxml','utf8');
  const tableWxss=fs.readFileSync('miniprogram/pages/table/index.wxss','utf8');
  const tileWxml=fs.readFileSync('miniprogram/components/tile/index.wxml','utf8');
  const tileWxss=fs.readFileSync('miniprogram/components/tile/index.wxss','utf8');
  const lobbyWxml=fs.readFileSync('miniprogram/pages/lobby/index.wxml','utf8');
  assert.match(tableWxml,/style="\{\{safeStyle\}\}"/);
  assert.match(tableWxml,/class="table-camera"/);
  assert.match(tableWxml,/class="table-world"/);
  assert.match(tableWxml,/class="table-surface"/);
  assert.match(tableWxml,/class="pond-ring(?:\s|")/);
  assert.match(tableWxml,/character-sheet="\{\{player\.character\.sheetUrl\}\}"/);
  assert.match(tableWxml,/character-sheet="\{\{opponent\.character\.sheetUrl\}\}"/);
  assert.match(tableWxml,/bindtap="chooseCharacter"/);
  assert.match(lobbyWxml,/class="character-gallery"/);
  assert.match(lobbyWxml,/bindtap="chooseCharacter"/);
  for(const side of ['front','back','top','base','left','right'])assert.match(tileWxml,new RegExp('tile-'+side));
  assert.match(tileWxml,/role-sheet/);
  assert.match(tileWxss,/preserve-3d/);
  assert.match(tileWxss,/backface-visibility:hidden/);
  for(const side of ['top','right','bottom','left'])assert.match(tableWxss,new RegExp('safe-area-inset-'+side));
  assert.match(tableWxss,/env\(safe-area-inset-left\)/);
  assert.match(tableWxss,/env\(safe-area-inset-right\)/);
});


test('the opposite avatar follows the measured hand edge and reuses unchanged layout',()=>{
  let reads=0,completed=0;
  const boxes=[{left:44,top:0,width:756,height:370},{left:260,top:47,right:514,bottom:53,width:254,height:6},{width:72,height:80},{width:44,height:44}];
  const wx={getWindowInfo:()=>({windowWidth:844,windowHeight:390}),createSelectorQuery(){return {select(){return this;},boundingClientRect(){return this;},exec(callback){reads++;callback(boxes);}};}};
  const view=page('table',{},wx);view.data.vm=tableView(roomView(handWithDraw(),0));
  const done=()=>completed++;
  view.alignOppositeAvatar(done);assert.equal(view.oppositeAvatarRect.left,526);assert.equal(view.oppositeAvatarRect.top,9);
  view.alignOppositeAvatar(done);assert.equal(reads,1);assert.equal(completed,2);
  view.data.vm.players.find(player=>player.position==='top').hand.pop();boxes[1].right=480;boxes[1].width=220;
  view.alignOppositeAvatar(done);assert.equal(view.oppositeAvatarRect.left,492);assert.equal(reads,2);assert.equal(completed,3);
});

test('window safe-area insets become CSS variables and keep fixed panels inside the notch-safe viewport',()=>{
  const {safeAreaStyle}=require('../miniprogram/lib/room-state');
  const style=safeAreaStyle({getWindowInfo:()=>({windowWidth:900,windowHeight:420,safeArea:{left:44,right:844,top:0,bottom:400}})});
  assert.match(style,/--safe-left:44px/);assert.match(style,/--safe-right:56px/);assert.match(style,/--safe-bottom:20px/);
  const tableCss=fs.readFileSync('miniprogram/pages/table/index.wxss','utf8');
  assert.match(tableCss,/var\(--safe-left, env\(safe-area-inset-left\)\)/);
  assert.match(tableCss,/position:fixed;right:calc\(12px \+ var\(--safe-right/);
});

test('native public sets follow their player orientation while hands retain their 3D projection',()=>{
  const source=fs.readFileSync('miniprogram/pages/table/index.wxml','utf8'),stack=[],found=new Set();
  for(const [,closing,tag,attributes] of source.matchAll(/<(\/?)([\w-]+)((?:"[^"]*"|'[^']*'|[^'">])*)>/g)){
    if(closing){assert.equal(stack.pop().tag,tag);continue;}
    const classes=(/class="([^"]*)"/.exec(attributes)||[])[1]||'';
    for(const name of ['opponent-rack','meld-rack','pond-ring','seat','local-rack']){
      if(!classes.split(/\s+/).includes(name))continue;
      const projected=stack.some(node=>node.classes==='table-world');
      const opponent=stack.some(node=>node.classes.split(/\s+/).includes('opponent-rack'));
      assert.equal(projected,['opponent-rack','pond-ring'].includes(name)||name==='meld-rack'&&opponent,name);
      if(name==='meld-rack')assert.ok(opponent||stack.some(node=>node.classes.split(/\s+/).includes('local-rack')),'Public sets must follow their player');
      if(classes.includes('local-player'))assert.doesNotMatch(attributes,/wx:if/,'the local portrait must also render');
      found.add(name);
    }
    if(classes.includes('avatar')){
      assert.match(classes,/interaction-anchor/);assert.match(attributes,/data-seat="\{\{(?:player.seat|room.seat)\}\}"/);
    }
    if(!/\/\s*$/.test(attributes))stack.push({tag,classes});
  }
  assert.equal(stack.length,0);assert.equal(found.size,5);
  assert.match(source,/size="opponent" standing="\{\{true\}\}"/);
});

test('native settings expose browser controls and opening another panel closes the previous one',()=>{
  const view=page('table');
  view.toggleSettings();assert.equal(view.data.settingsOpen,true);
  view.toggleCode();view.togglePayments();view.toggleHelp();
  assert.equal(view.data.codeExpanded,true);assert.equal(view.data.paymentsExpanded,true);assert.equal(view.data.helpExpanded,true);
  view.toggleCharacter();assert.equal(view.data.characterOpen,true);assert.equal(view.data.settingsOpen,false);
  view.toggleEmotes();assert.equal(view.data.emoteOpen,true);assert.equal(view.data.characterOpen,false);
  view.toggleSettings();assert.equal(view.data.settingsOpen,true);assert.equal(view.data.emoteOpen,false);
  const source=fs.readFileSync('miniprogram/pages/table/index.wxml','utf8');
  assert.match(source,/<scroll-view[^>]*scroll-y class="settings-panel/);
  for(const label of ['牌桌设置','更换牌背','角色表情','自动理牌','牌山校验码','本局收支','操作说明','历史牌谱','结束测试','邀请好友'])assert.ok(source.includes(label),label);
});

test('returning to the native lobby stays there until the player explicitly reopens the table',async()=>{
  const snapshot=roomView(handWithDraw(),0);let opened=0,back=0,relaunched=0;
  const wx={setStorageSync(){},removeStorageSync(){},getStorageSync(){return 'session';},navigateTo(){opened++;},navigateBack(){back++;},reLaunch(){relaunched++;}};
  const lobby=page('lobby',{request:async()=>({user:{id:'user0'},rooms:[]}),watchRoom:(code,accept)=>{accept(snapshot);return ()=>{};}},wx);
  lobby.route='pages/lobby/index';lobby.accept(snapshot);assert.equal(opened,1);
  const table=page('table',{},wx,undefined,{getCurrentPages:()=>[lobby,{}]});
  table.lobby();assert.equal(back,1);await lobby.onShow();assert.equal(opened,1,'polling must not bounce a manual lobby visit back to the table');
  lobby.table();assert.equal(opened,2);assert.equal(lobby.stayInLobby,false);
  const direct=page('table',{},wx,undefined,{getCurrentPages:()=>[{}]});direct.lobby();assert.equal(relaunched,1,'a direct table launch can also return to the lobby');
});

test('native capsule placement preserves safe insets even when the optional menu API fails',()=>{
  const {safeAreaStyle}=require('../miniprogram/lib/room-state');
  const api={getWindowInfo:()=>({windowWidth:900,windowHeight:420,safeArea:{left:44,right:844,top:0,bottom:400}}),getMenuButtonBoundingClientRect:()=>({left:790,top:8,width:80,height:32})};
  const style=safeAreaStyle(api);assert.match(style,/--menu-right:62px;--menu-top:8px/);
  api.getMenuButtonBoundingClientRect=()=>{throw Error('Menu unavailable');};
  assert.match(safeAreaStyle(api),/--safe-left:44px/);
});

test('resizing remeasures canvas effects without retaining a touch drag or expired effect',()=>{
  const snapshot=roomView(handWithDraw(),0),now=Date.now(),canvas=nativeCanvas();
  snapshot.interactions=[{id:'resize',playerId:'user0',from:0,target:2,effect:'water',sentAt:new Date(now-500).toISOString(),expiresAt:new Date(now+2500).toISOString()}];
  const view=page('table',{},canvas.wx);
  view.accept(snapshot);const first=view.interactionMotions.values().next().value.motion;
  view.drag={index:0,x:1,y:1};view.skipTap=true;canvas.anchors=canvas.anchors.map(rect=>({...rect,left:rect.left+30}));view.onResize();
  assert.equal(view.drag,null);assert.equal(view.skipTap,false);assert.match(view.data.safeStyle,/--safe-bottom:20px/);
  const resumed=view.interactionMotions.values().next().value.motion;assert.equal(resumed.key,first.key);assert.equal(resumed.startedAt,first.startedAt);assert.equal(resumed.expiresAt,first.expiresAt);assert.equal(resumed.x,first.x+30);assert.equal(canvas.frames.size,1);
  view.data.room.interactions[0].expiresAt=new Date(0).toISOString();view.onResize();assert.equal(view.interactionMotions.size,0);assert.equal(canvas.frames.size,0);view.onHide();
});

test('native floated wildcards keep their count and Kong scores are whole points',()=>{
  const tableCss=fs.readFileSync('miniprogram/pages/table/index.wxss','utf8');
  const tableWxml=fs.readFileSync('miniprogram/pages/table/index.wxml','utf8');
  assert.match(tableCss,/\.local-rack \.meld-rack\.bottom\{[^}]*position:static/);
  assert.match(tableWxml,/player\.floated\[0\]\.id/);
  assert.match(tableWxml,/×\{\{player\.floated\.length\}\}/);
  assert.match(tableWxml,/class="seat-floats">已飘 \{\{player\.floats\}\} 张/);
  const snapshot=roomView(handWithDraw(),0);snapshot.match.hand.floats=[0,1,2,3];
  for(let seat=0;seat<4;seat++){
    const top=tableView({...snapshot,seat}).players.find(player=>player.position==='top');
    assert.equal(top.floats,(seat+2)%4);
  }
  assert.match(tableCss,/\.floated-row\{[^}]*border:1px solid #e6bf67aa/);
  assert.match(tableWxml,/本局规则：\{\{room\.match\.hand\.rulesVersion\}\}/);
  assert.doesNotMatch(tableWxml,/friends-v1|0\.5|旧规则|半点/);
  const payment={payer:0,recipient:1,kind:'exposedKong',amount:2,counts:[0,0]};
  const currentRoom=roomView(createHand({...fixture}),0);currentRoom.match.hand.payments=[payment];
  const text=tableView(currentRoom).eventPayments[0].text;
  assert.match(text,/1 分/);assert.doesNotMatch(text,/0\.5|旧规则/);
});

test('native discard and interaction UI update optimistically before the cloud response',async()=>{
  const hand=handWithDraw();
  const snapshot=roomView(hand,hand.actor);
  let rejectDiscard;
  const discardPending=new Promise((resolve,reject)=>{rejectDiscard=reject;});
  const discardView=page('table',{
    actionId:()=> 'optimistic-discard',
    command(){return discardPending;},
    async request(){return snapshot;},
  });
  discardView.onLoad({room:snapshot.code});
  discardView.accept(snapshot);
  const discard=snapshot.match.hand.actions.find(action=>action.kind==='discard');
  assert.ok(discard);
  const discardPromise=discardView.send(discard);
  const optimisticHand=discardView.data.room.match.hand.players[hand.actor];
  assert.equal(optimisticHand.hand.includes(discard.tile),false);
  assert.ok(optimisticHand.discards.some(item=>item.id===discard.tile));
  rejectDiscard(new Error('连接失败'));
  await discardPromise;
  assert.equal(discardView.data.busy,false);
  discardView.onHide();

  let rejectInteraction,interactionCalls=0;
  const interactionPending=new Promise((resolve,reject)=>{rejectInteraction=reject;});
  const interactionView=page('table',{
    actionId:()=> 'optimistic-interaction',
    async command(){return snapshot;},
    request(){interactionCalls++;return interactionCalls===1?interactionPending:Promise.resolve(snapshot);},
  });
  interactionView.onLoad({room:snapshot.code});
  interactionView.accept(snapshot);
  interactionView.render();
  assert.ok(Number.isInteger(interactionView.data.interactionTarget));
  const beforeRemaining=interactionView.data.vm.interactionRemaining;
  const interactionPromise=interactionView.interaction({currentTarget:{dataset:{effect:'water'}}});
  assert.ok(interactionView.data.room.interactions.some(item=>item.effect==='water'));
  assert.equal(interactionView.data.room.interactionRemaining,beforeRemaining-1);
  rejectInteraction(new Error('连接失败'));
  await interactionPromise;
  assert.equal(interactionView.data.busy,false);
  interactionView.onHide();
});

test('native control toggles update immediately and survive stale room polls',async()=>{
  let hand=createHand({...fixture});
  for(let seat=0;seat<4;seat++)hand=act(hand,seat,{id:'control-ack'+seat,kind:'ack',code:hand.wallCode});
  const snapshot=roomView(hand,2);snapshot.controls={autoWin:false,skipCalls:false,autoCut:false};
  let resolveControl;
  const pending=new Promise(resolve=>{resolveControl=resolve;});
  const view=page('table',{async request(){return pending;}});
  view.onLoad({room:snapshot.code});view.accept(snapshot);
  const toggle=view.toggleControl({currentTarget:{dataset:{key:'autoWin'}}});
  assert.equal(view.data.room.controls.autoWin,true);
  assert.equal(view.data.vm.controls.autoWin,true);
  view.accept(snapshot);
  assert.equal(view.data.vm.controls.autoWin,true,'a stale poll cannot revert an optimistic control');
  resolveControl({...snapshot,controls:{...snapshot.controls,autoWin:true},revision:2});
  await toggle;
  assert.equal(view.data.vm.controls.autoWin,true);
  assert.equal(view.data.busy,false);
  assert.equal(view.data.sortEnabled,true);
  view.toggleSort();
  assert.equal(view.data.sortEnabled,false,'sort is local and updates immediately');
  view.onHide();
});

test('native data patches preserve array changes, removals, and null values without resending unchanged tiles',()=>{
  const {dataPatch}=require('../miniprogram/lib/room-state');
  const current={tiles:[{id:0,selected:false},{id:1,selected:false}],emote:{id:'old'},controls:{autoWin:false},legacy:{old:true}};
  const next={tiles:[{id:0,selected:false},{id:1,selected:true}],emote:undefined,controls:{autoWin:false},legacy:{current:true}};
  assert.deepEqual(dataPatch(current,next),{'tiles[1].selected':true,emote:null,legacy:{current:true}});
  assert.deepEqual(dataPatch(current,{tiles:[]}),{tiles:[]});
  assert.deepEqual(dataPatch(current,JSON.parse(JSON.stringify(current))),{});
});

test('native rapid toggles coalesce saves, keep sorting responsive, and send only changed UI data',async()=>{
  const snapshot=roomView(handWithDraw(),0);snapshot.controls={autoWin:false,skipCalls:false,autoCut:false};
  const requests=[],view=page('table',{request(path,method,body){return new Promise(resolve=>requests.push({path,body,resolve}));}});
  view.onLoad({room:snapshot.code});view.accept(snapshot);
  const patches=[],setData=view.setData;
  view.setData=function(patch,callback){patches.push(JSON.parse(JSON.stringify(patch)));setData.call(this,patch,callback);};
  const toggle=key=>view.toggleControl({currentTarget:{dataset:{key}}});
  const saving=[toggle('autoWin'),toggle('skipCalls'),toggle('autoWin')];
  assert.equal(view.data.busy,false);assert.equal(requests.length,1);
  assert.equal(view.data.vm.controls.autoWin,false);assert.equal(view.data.vm.controls.skipCalls,true);
  view.accept(snapshot);assert.equal(view.data.vm.controls.skipCalls,true);
  assert.ok(Buffer.byteLength(JSON.stringify(patches))<1024,'toggles must not serialize the table or change every tile disabled property');
  assert.ok(patches.flatMap(Object.keys).every(key=>!key.startsWith('vm.players')&&!key.startsWith('vm.self.hand')&&!key.startsWith('vm.opponents')));
  const keys=new Map(view.data.vm.self.hand.map(face=>[face.id,face.key]));view.toggleSort();
  assert.equal(view.data.sortEnabled,false);
  for(const face of view.data.vm.self.hand)assert.equal(face.key,keys.get(face.id),'sorting reuses the same physical tile components');
  requests[0].resolve({...snapshot,revision:2,controls:{...snapshot.controls,autoWin:true}});
  await new Promise(setImmediate);
  assert.equal(requests.length,2);assert.equal(requests[1].body.autoWin,false);assert.equal(requests[1].body.skipCalls,true);
  assert.equal(view.data.vm.controls.autoWin,false,'the first save cannot overwrite a later tap');
  requests[1].resolve({...snapshot,revision:3,controls:{...snapshot.controls,skipCalls:true}});
  await Promise.all(saving);assert.equal(view.controlsPending,null);assert.equal(view.data.busy,false);view.onHide();
});

test('native failed control saves restore confirmed values even when the refresh also fails',async()=>{
  const snapshot=roomView(handWithDraw(),0);snapshot.controls={autoWin:false,skipCalls:false,autoCut:false};
  const view=page('table',{async request(){throw new Error('连接失败');}});
  view.onLoad({room:snapshot.code});view.accept(snapshot);
  await view.toggleControl({currentTarget:{dataset:{key:'autoCut'}}});
  assert.equal(view.data.vm.controls.autoCut,false);assert.equal(view.controlsPending,null);assert.equal(view.data.busy,false);assert.match(view.data.error,/连接失败/);view.onHide();
});

test('a pending native preference cannot overwrite the next hand automation reset',async()=>{
  const snapshot=roomView(handWithDraw(),0);snapshot.controls={autoWin:false,skipCalls:false,autoCut:false};
  let resolve;
  const view=page('table',{request(){return new Promise(done=>{resolve=done;});}});
  view.onLoad({room:snapshot.code});view.accept(snapshot);
  const saving=view.toggleControl({currentTarget:{dataset:{key:'autoCut'}}});
  const next=JSON.parse(JSON.stringify(snapshot));next.revision=3;next.match.hand.handNo++;
  view.accept(next);assert.equal(view.data.vm.controls.autoCut,false);
  resolve({...snapshot,revision:2,controls:{...snapshot.controls,autoCut:true}});await saving;
  assert.equal(view.data.room.match.hand.handNo,next.match.hand.handNo);assert.equal(view.data.vm.controls.autoCut,false);view.onHide();
});

test('a failed old-hand save cannot strand controls queued for the new hand',async()=>{
  const snapshot=roomView(handWithDraw(),0);snapshot.controls={autoWin:false,skipCalls:false,autoCut:false};
  const next=JSON.parse(JSON.stringify(snapshot));next.revision=3;next.match.hand.handNo++;
  const requests=[],view=page('table',{request(path,method,body){if(!method)return Promise.resolve(next);return new Promise((resolve,reject)=>requests.push({body,resolve,reject}));}});
  view.onLoad({room:snapshot.code});view.accept(snapshot);
  const oldSave=view.toggleControl({currentTarget:{dataset:{key:'autoCut'}}});view.accept(next);
  const newSave=view.toggleControl({currentTarget:{dataset:{key:'autoWin'}}});
  requests[0].reject(new Error('旧请求连接失败'));await new Promise(setImmediate);
  assert.equal(requests.length,2);assert.equal(requests[1].body.handNo,next.match.hand.handNo);assert.equal(requests[1].body.autoWin,true);
  requests[1].resolve({...next,revision:4,controls:{...next.controls,autoWin:true}});await Promise.all([oldSave,newSave]);
  assert.equal(view.data.vm.controls.autoWin,true);assert.equal(view.data.vm.controls.autoCut,false);assert.equal(view.data.error,'');view.onHide();
});

test('all four native perspectives display each public call once and never display Pass',()=>{
  const snapshot=roomView(handWithDraw(),0),expiresAt=new Date(Date.now()+1500).toISOString();
  snapshot.callNotices=[{id:'pon',seat:1,kind:'pon',label:'碰',expiresAt},{id:'kong',seat:2,kind:'concealedKong',label:'暗杠',expiresAt},{id:'win',seat:3,kind:'win',label:'胡',expiresAt}];
  for(let seat=0;seat<4;seat++){
    const timers=[],view=page('table',{}, {},undefined,{setTimeout(fn){timers.push(fn);return timers.length;},clearTimeout(){}});
    const room={...snapshot,seat};view.accept(room);
    assert.deepEqual(view.data.callEffects.map(effect=>effect.label),['碰','暗杠','胡']);
    for(const effect of view.data.callEffects)assert.equal(effect.position,['bottom','right','top','left'][(effect.seat-seat+4)%4]);
    view.accept(room);view.render();assert.equal(timers.length,3,'polling and rendering cannot replay calls');
    for(const timer of timers)timer();assert.equal(view.data.callEffects.length,0);
    view.accept({...room,revision:2});assert.equal(view.data.callEffects.length,0,'a still-live server notice cannot restart an expired animation');
    view.onHide();
  }
  const markup=fs.readFileSync('miniprogram/pages/table/index.wxml','utf8');assert.match(markup,/wx:for="\{\{callEffects\}\}" wx:key="id"/);assert.doesNotMatch(markup,/room\.callNotice/);
});

test('browser rapid toggles and sort update their controls without replacing the table',async()=>{
  const snapshot=roomView(handWithDraw(),0);snapshot.controls={autoWin:false,skipCalls:false,autoCut:false};
  const requests=[],rack={innerHTML:''},menu={innerHTML:''},buttons=['autoWin','skipCalls','autoCut'].map(control=>({dataset:{control},classList:{toggle(){}},setAttribute(name,value){this[name]=value;}}));
  const {context,elements}=browser({fetch(path,options){return new Promise(resolve=>requests.push({path,body:JSON.parse(options.body),resolve}));}});
  context.snapshot=snapshot;vm.runInContext("room=snapshot;user={id:'user0'};confirmedControls={...room.controls};render()",context);
  context.document.querySelector=selector=>selector==='.rack.bottom'?rack:selector==='.call-menu'?menu:selector==='.action-tray'?{}:null;
  context.document.querySelectorAll=selector=>selector==='[data-control]'?buttons:[];
  const html=elements.get('room').innerHTML;
  const saving=[vm.runInContext("toggleControl('autoWin')",context),vm.runInContext("toggleControl('autoCut')",context),vm.runInContext("toggleControl('autoWin')",context)];
  assert.equal(buttons[0]['aria-pressed'],'false');assert.equal(buttons[2]['aria-pressed'],'true');assert.equal(requests.length,1);
  context.poll=snapshot;vm.runInContext('updateRoom(poll);toggleSort()',context);assert.match(rack.innerHTML,/class="tiles /);assert.equal(elements.get('room').innerHTML,html);
  requests[0].resolve({ok:true,json:async()=>({...snapshot,revision:2,controls:{...snapshot.controls,autoWin:true}})});await new Promise(setImmediate);
  assert.equal(requests.length,2);assert.equal(requests[1].body.autoCut,true);assert.equal(requests[1].body.autoWin,false);
  requests[1].resolve({ok:true,json:async()=>({...snapshot,revision:3,controls:{...snapshot.controls,autoCut:true}})});await Promise.all(saving);
  assert.equal(elements.get('room').innerHTML,html);assert.equal(vm.runInContext('actionPending',context),false);
});

test('all four browser perspectives display calls once in an independent overlay',()=>{
  const expiresAt=new Date(Date.now()+1500).toISOString();
  for(let seat=0;seat<4;seat++){
    const timers=[],{context,elements}=browser({setTimeout(fn){timers.push(fn);return timers.length;},clearTimeout(){}});
    context.snapshot={...roomView(handWithDraw(),seat),callNotices:[{id:'pon',seat:1,kind:'pon',label:'碰',expiresAt},{id:'kong',seat:2,kind:'exposedKong',label:'明杠',expiresAt},{id:'win',seat:3,kind:'win',label:'胡',expiresAt}]};
    vm.runInContext('room=snapshot;render();renderCalls();renderCalls();render()',context);
    const html=elements.get('call-effects').innerHTML;
    for(const label of ['碰','明杠','胡'])assert.ok(html.includes('>'+label+'</div>'));
    assert.doesNotMatch(html,/>过</);assert.equal(timers.length,3);assert.equal((html.match(/class="call-flash /g)||[]).length,3);
  }
});

test('native and browser Kong chains display in sequence instead of covering earlier calls',()=>{
  const snapshot=roomView(handWithDraw(),0),expiresAt=new Date(Date.now()+1500).toISOString();
  snapshot.callNotices=[{id:'first-kong',seat:1,kind:'exposedKong',label:'明杠',expiresAt},{id:'second-kong',seat:1,kind:'concealedKong',label:'暗杠',expiresAt}];
  const nativeTimers=[],native=page('table',{}, {},undefined,{setTimeout(fn,ms){nativeTimers.push({fn,ms});return nativeTimers.length;},clearTimeout(){}});
  native.accept(snapshot);assert.deepEqual(native.data.callEffects.map(item=>item.label),['明杠']);assert.equal(nativeTimers.length,2);
  nativeTimers[0].fn();nativeTimers[1].fn();assert.deepEqual(native.data.callEffects.map(item=>item.label),['暗杠']);assert.ok(nativeTimers[1].ms>=1400);
  native.accept(snapshot);assert.equal(nativeTimers.length,3);native.onHide();
  const browserTimers=[],{context,elements}=browser({setTimeout(fn,ms){browserTimers.push({fn,ms});return browserTimers.length;},clearTimeout(){}});context.snapshot=snapshot;
  vm.runInContext('room=snapshot;renderCalls();renderCalls()',context);assert.match(elements.get('call-effects').innerHTML,/>明杠</);assert.doesNotMatch(elements.get('call-effects').innerHTML,/>暗杠</);assert.equal(browserTimers.length,2);
  browserTimers[0].fn();browserTimers[1].fn();assert.match(elements.get('call-effects').innerHTML,/>暗杠</);assert.equal(browserTimers.length,3);
});
