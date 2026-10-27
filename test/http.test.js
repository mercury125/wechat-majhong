'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {once}=require('node:events');
const {Store}=require('../server/store');
const {Service}=require('../server/service');
const {createServer}=require('../server/http');
const {verifyMatch}=require('../miniprogram/lib/replay');

async function server(t,options={}){
  const store=new Store(':memory:');
  const service=new Service(store,{dealer:()=>2,seed:()=>'01'.repeat(32)});
  const server=createServer(service,{development:true,...options});
  server.listen(0,'127.0.0.1');await once(server,'listening');
  t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));store.close();});
  const base='http://127.0.0.1:'+server.address().port;
  async function request(path,token,method='GET',body){
    const response=await fetch(base+path,{method,headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:body===undefined?undefined:JSON.stringify(body)});
    return {status:response.status,data:await response.json()};
  }
  return {store,service,base,request};
}

test('automatic-control updates are authenticated, private, validated and persistent',async t=>{
  const app=await server(t);
  const mine=(await app.request('/api/login/dev',null,'POST',{name:'自动操作玩家'})).data;
  const friend=(await app.request('/api/login/dev',null,'POST',{name:'同桌玩家'})).data;
  const other=(await app.request('/api/login/dev',null,'POST',{name:'其他玩家'})).data;
  const room=(await app.request('/api/rooms',mine.token,'POST',{})).data,base='/api/rooms/'+room.code;
  await app.request(base+'/join',friend.token,'POST',{});
  assert.equal((await app.request(base+'/controls',null,'PATCH',{autoCut:true})).status,401);
  assert.equal((await app.request(base+'/controls',other.token,'PATCH',{autoCut:true})).status,403);
  for(const body of [{autoWin:'true'},{seat:1,skipCalls:true},{sortEnabled:true}])assert.equal((await app.request(base+'/controls',mine.token,'PATCH',body)).status,400);
  const saved=await app.request(base+'/controls',mine.token,'PATCH',{autoWin:true,skipCalls:true,autoCut:true});
  assert.equal(saved.status,200);assert.deepEqual(saved.data.controls,{autoWin:true,skipCalls:true,autoCut:true});
  assert.deepEqual((await app.request(base,friend.token)).data.controls,{autoWin:false,skipCalls:false,autoCut:false});
  assert.deepEqual((await app.request(base,mine.token)).data.controls,saved.data.controls);
  assert.equal((await app.request(base+'/controls',mine.token,'PATCH',{autoWin:true,skipCalls:true,autoCut:true})).data.revision,saved.data.revision);
  const native=await app.request(base+'/controls',mine.token,'POST',{autoCut:false});assert.equal(native.status,200);assert.equal(native.data.controls.autoCut,false);
  const profile=await app.request('/api/me',mine.token,'POST',{name:'更新昵称'});assert.equal(profile.status,200);assert.equal(profile.data.user.name,'更新昵称');
});

test('one HTTP client can start, finish, rematch and exit a private robot test',async t=>{
  const app=await server(t);
  const login=(await app.request('/api/login/dev',null,'POST',{name:'单人测试玩家'})).data;
  const outsider=(await app.request('/api/login/dev',null,'POST',{name:'其他玩家'})).data;
  assert.equal((await app.request('/api/rooms',outsider.token,'POST',{testMode:'true'})).status,400);
  let response=await app.request('/api/rooms',login.token,'POST',{testMode:true,handsPerMatch:1});
  assert.equal(response.status,201);let view=response.data;const code=view.code;let serial=0;
  assert.equal(view.match,null);assert.deepEqual(view.ready,[false,true,true,true]);
  assert.equal(view.testMode,true);assert.deepEqual(view.seats.map(player=>player.bot),[false,true,true,true]);
  assert.equal(app.store.db.prepare('SELECT COUNT(*) AS n FROM sessions').get().n,2);
  assert.equal((await app.request('/api/rooms/'+code+'/join',outsider.token,'POST',{})).status,403);
  async function command(action){
    const h=view.match&&view.match.hand;
    const result=await app.request('/api/rooms/'+code+'/commands',login.token,'POST',{id:'solo-http-'+serial++,expectedRevision:view.revision,...(h?{matchId:h.matchId,handNo:h.handNo}:{}),...action});
    assert.equal(result.status,200,JSON.stringify(result.data));return result.data;
  }
  view=await command({kind:'ready',ready:true,handsPerMatch:1});
  const matchId=view.match.id,observed={1:view.match.hand.wallCode};
  const poll=app.request('/api/rooms/'+code+'?after='+view.revision,login.token);
  view=await command({kind:'ack',code:view.match.hand.wallCode});assert.ok((await poll).data.revision>response.data.revision);
  assert.ok(app.store.match(matchId).hands[0].commands.some(record=>record.seat!==0&&record.input.kind==='discard'));
  for(let move=0;view.match.status==='active';move++){
    assert.ok(move<200);const hand=view.match.hand;
    assert.ok(hand.phase==='responses'||hand.actor===0,'only the human needs to act');
    assert.equal(hand.wall,undefined);assert.equal(hand.seedHex,undefined);
    assert.ok(hand.players.slice(1).every(player=>player.hand.every(tile=>tile===null)));
    const action=hand.actions.find(a=>a.kind==='win')||hand.actions.find(a=>a.kind.includes('Kong'))||hand.actions.find(a=>a.kind==='pon')||hand.actions.find(a=>a.kind==='float')||hand.actions.find(a=>a.kind==='discard')||hand.actions.find(a=>a.kind==='pass');
    assert.ok(action);view=await command(action);
  }
  assert.equal((await app.request('/api/history',login.token)).data.matches[0].testMode,true);
  const replay=(await app.request('/api/matches/'+matchId,login.token)).data;assert.equal(verifyMatch(replay,observed).status,'passed');
  view=await command({kind:'ready',ready:true,handsPerMatch:1});assert.notEqual(view.match.id,matchId);
  assert.deepEqual(view.match.hand.acknowledgements.map(Boolean),[false,true,true,true]);
  assert.equal((await command({kind:'leave'})).left,true);
  assert.deepEqual((await app.request('/api/me',login.token)).data.rooms,[]);
  assert.equal(JSON.stringify((await app.request('/api/matches/'+matchId,login.token)).data),JSON.stringify(replay));
  response=await app.request('/api/rooms',login.token,'POST',{});assert.equal(response.status,201);assert.equal(response.data.seats.filter(Boolean).length,1);
});

test('four real HTTP clients complete and locally verify a match without leaking live tiles',async t=>{
  const app=await server(t);
  assert.equal((await app.request('/api/me')).status,401);
  const sessions=[];
  for(let i=0;i<5;i++)sessions.push((await app.request('/api/login/dev',null,'POST',{name:'HTTP '+i})).data);
  let result=await app.request('/api/rooms',sessions[0].token,'POST',{handsPerMatch:1});
  assert.equal(result.status,201);const code=result.data.code;
  for(let i=1;i<4;i++)assert.equal((await app.request('/api/rooms/'+code+'/join',sessions[i].token,'POST',{})).status,200);
  let serial=0;
  async function command(seat,action){
    const view=(await app.request('/api/rooms/'+code,sessions[seat].token)).data;
    const h=view.match&&view.match.hand;
    return app.request('/api/rooms/'+code+'/commands',sessions[seat].token,'POST',{id:'http-'+serial++,expectedRevision:view.revision,...(h?{matchId:h.matchId,handNo:h.handNo}:{}),...action});
  }
  const before=(await app.request('/api/rooms/'+code,sessions[0].token)).data;
  const subscription=app.request('/api/rooms/'+code+'?after='+before.revision,sessions[0].token);
  const ready=await Promise.all(sessions.slice(0,4).map((session,seat)=>app.request('/api/rooms/'+code+'/commands',session.token,'POST',{
    id:'ready-concurrent-'+seat,kind:'ready',ready:true,handsPerMatch:1,expectedRevision:before.revision,
  })));
  assert.ok(ready.every(response=>response.status===200),'all four players may prepare against the same room revision');
  result=ready.find(response=>response.data.match);
  assert.ok((await subscription).data.revision>before.revision);
  assert.equal(result.data.match.status,'active','the last ready player starts the match automatically');
  const matchId=result.data.match.id;
  const codeBefore=result.data.match.hand.wallCode;
  assert.equal((await app.request('/api/matches/'+matchId,sessions[0].token)).status,409);
  const commitView=(await app.request('/api/rooms/'+code,sessions[0].token)).data;
  const acknowledgements=await Promise.all([0,1,2,3].map(seat=>app.request('/api/rooms/'+code+'/commands',sessions[seat].token,'POST',{
    id:'http-ack-'+seat,expectedRevision:commitView.revision,matchId,handNo:1,kind:'ack',code:codeBefore,
  })));
  assert.ok(acknowledgements.every(item=>item.status===200),'all clients may acknowledge the same commit concurrently');
  let view=(await app.request('/api/rooms/'+code,sessions[0].token)).data;
  assert.equal(view.match.hand.wall,undefined);assert.equal(view.match.hand.seedHex,undefined);
  for(let i=1;i<4;i++)assert.ok(view.match.hand.players[i].hand.every(id=>id===null));
  assert.equal((await app.request('/api/rooms/'+code,sessions[4].token)).status,403);
  assert.equal((await app.request('/api/matches/'+matchId,sessions[4].token)).status,403);
  for(let move=0;move<500&&view.match.status!=='complete';move++){
    const h=view.match.hand;
    const seat=h.phase==='own'?h.actor:h.pending.responses.findIndex(value=>value===null);
    const privateView=(await app.request('/api/rooms/'+code,sessions[seat].token)).data;
    const actions=privateView.match.hand.actions;
    const action=actions.find(a=>['win','float','concealedKong','addedKong','exposedKong','pon'].includes(a.kind))||actions[0];
    const response=await command(seat,action);assert.equal(response.status,200,JSON.stringify(response.data));view=response.data;
  }
  assert.equal(view.match.status,'complete');
  const exported=await app.request('/api/matches/'+matchId,sessions[0].token);
  assert.equal(exported.status,200);
  assert.equal(verifyMatch(exported.data,{1:codeBefore}).status,'passed');
  assert.equal((await app.request('/api/history',sessions[0].token)).data.matches.length,1);
  const rematch=await Promise.all(sessions.slice(0,4).map((session,seat)=>app.request('/api/rooms/'+code+'/commands',session.token,'POST',{
    id:'rematch-concurrent-'+seat,kind:'ready',ready:true,handsPerMatch:1,matchId,expectedRevision:view.revision,
  })));
  assert.ok(rematch.every(response=>response.status===200),'concurrent rematch readiness must not require repeated clicks');
  assert.ok(rematch.some(response=>response.data.match.id!==matchId));
  assert.equal(JSON.stringify((await app.request('/api/matches/'+matchId,sessions[0].token)).data),JSON.stringify(exported.data));
  const asset=await fetch(app.base+'/assets/tiles/Front.png');assert.equal(asset.status,200);assert.equal(asset.headers.get('content-type'),'image/png');
  const harness=await fetch(app.base+'/dev');assert.equal(harness.status,200);assert.match(await harness.text(),/本地试玩/);
});

test('WeChat exchange binds server-verified openid and never exposes session_key or AppSecret',async t=>{
  let calls=0;
  const app=await server(t,{development:false,appId:'test-app',appSecret:'server-only-secret',fetch:async url=>{
    assert.equal(url.origin,'https://api.weixin.qq.com');assert.equal(url.searchParams.get('secret'),'server-only-secret');calls++;
    return {ok:true,json:async()=>({openid:'verified-user',session_key:'private-wechat-key'})};
  }});
  assert.equal((await app.request('/api/login/dev',null,'POST',{name:'Fake'})).status,404);
  assert.equal((await app.request('/api/login/wechat',null,'POST',{openid:'forged'})).status,400);
  const first=await app.request('/api/login/wechat',null,'POST',{code:'valid-code',name:'Friend'});
  const second=await app.request('/api/login/wechat',null,'POST',{code:'next-code'});
  assert.equal(first.status,200);assert.equal(second.data.user.id,first.data.user.id);assert.equal(calls,2);
  assert.equal(second.data.user.name,'Friend','silent identity restoration retains the saved nickname');
  const renamed=await app.request('/api/login/wechat',null,'POST',{code:'new-nickname-code',name:'微信昵称'});
  assert.equal(renamed.data.user.id,first.data.user.id);assert.equal(renamed.data.user.name,'微信昵称');
  assert.equal((await app.request('/api/me',second.data.token)).data.user.name,'微信昵称');
  assert.equal(JSON.stringify(first).includes('server-only-secret'),false);assert.equal(JSON.stringify(first).includes('private-wechat-key'),false);
  assert.equal((await app.request('/api/logout',first.data.token,'POST')).status,200);
  assert.equal((await app.request('/api/me',first.data.token)).status,401);
  assert.equal((await app.request('/api/me',second.data.token)).status,200);
  const art=await fetch(app.base+'/assets/characters/ironclad-sheet.webp');assert.equal(art.status,200);assert.equal(art.headers.get('content-type'),'image/webp');
  assert.equal((await fetch(app.base+'/assets/characters/manifest.json')).status,401,'only the four allowlisted public atlases are served');
  assert.equal((await app.request('/dev',second.data.token)).status,404,'the development harness stays unavailable in production');
});

test('room emotes broadcast to three HTTP subscribers and character assets are served locally',async t=>{
  const app=await server(t),sessions=[];
  for(let i=0;i<5;i++)sessions.push((await app.request('/api/login/dev',null,'POST',{name:'牌友'+i})).data);
  const room=(await app.request('/api/rooms',sessions[0].token,'POST',{})).data;
  for(let i=1;i<4;i++)await app.request('/api/rooms/'+room.code+'/join',sessions[i].token,'POST',{});
  const base='/api/rooms/'+room.code;
  assert.equal((await app.request(base+'/emotes',sessions[4].token,'POST',{id:'no',emote:'joy'})).status,403);
  assert.equal((await app.request(base+'/appearance',sessions[0].token,'POST',{character:'remote-url'})).status,400);
  const styled=(await app.request(base+'/appearance',sessions[0].token,'POST',{character:'defect'})).data;
  const polls=sessions.slice(1,4).map(session=>app.request(base+'?after='+styled.revision,session.token));
  const sent=await app.request(base+'/emotes',sessions[0].token,'POST',{id:'broadcast',emote:'greet'});
  assert.equal(sent.status,200);
  for(const result of await Promise.all(polls)){
    assert.equal(result.data.emotes[0].emote,'greet');assert.equal(result.data.emotes[0].character,'defect');assert.equal(result.data.characters[0],'defect');
  }
  const duplicate=await app.request(base+'/emotes',sessions[0].token,'POST',{id:'broadcast',emote:'greet'});
  assert.equal(duplicate.data.revision,sent.data.revision);
  assert.equal((await app.request(base+'/emotes',sessions[0].token,'POST',{id:'too-fast',emote:'cry'})).status,429);
  const catalog=await fetch(app.base+'/dev/lib/cosmetics.js');assert.equal(catalog.status,200);assert.match(await catalog.text(),/MahjongCosmetics/);
  const effectStyles=await fetch(app.base+'/dev/styles/interactions.wxss');assert.equal(effectStyles.status,200);assert.match(effectStyles.headers.get('content-type'),/text\/css/);const effects=await effectStyles.text();assert.match(effects,/water-cube/);assert.match(effects,/tomato-scatter/);
  for(const name of ['ironclad','silent','defect','watcher']){
    const asset=await fetch(app.base+'/assets/characters/'+name+'-sheet.webp');assert.equal(asset.status,200);assert.equal(asset.headers.get('content-type'),'image/webp');assert.ok((await asset.arrayBuffer()).byteLength>10000);
  }
});

test('targeted interactions broadcast to all players and the HTTP endpoint enforces the shared fifty-use limit',async t=>{
  const app=await server(t),sessions=[];
  for(let seat=0;seat<5;seat++)sessions.push((await app.request('/api/login/dev',null,'POST',{name:'互动玩家'+seat})).data);
  const room=(await app.request('/api/rooms',sessions[0].token,'POST',{handsPerMatch:1})).data,base='/api/rooms/'+room.code;
  for(let seat=1;seat<4;seat++)await app.request(base+'/join',sessions[seat].token,'POST',{});
  for(let seat=0;seat<4;seat++){const view=(await app.request(base,sessions[seat].token)).data;assert.equal((await app.request(base+'/commands',sessions[seat].token,'POST',{id:'interaction-ready-'+seat,kind:'ready',ready:true,expectedRevision:view.revision})).status,200);}
  const committed=(await app.request(base,sessions[0].token)).data;
  for(let seat=0;seat<4;seat++)assert.equal((await app.request(base+'/commands',sessions[seat].token,'POST',{id:'interaction-ack-'+seat,kind:'ack',code:committed.match.hand.wallCode,matchId:committed.match.id,handNo:1,expectedRevision:committed.revision})).status,200);
  const view=(await app.request(base,sessions[0].token)).data,input={id:'http-water',effect:'water',target:1,matchId:view.match.id,handNo:1};
  assert.equal((await app.request(base+'/interactions',null,'POST',input)).status,401);
  assert.equal((await app.request(base+'/interactions',sessions[4].token,'POST',input)).status,403);
  const polls=sessions.slice(1,4).map(session=>app.request(base+'?after='+view.revision,session.token));
  const sent=await app.request(base+'/interactions',sessions[0].token,'POST',input);assert.equal(sent.status,200);assert.equal(sent.data.interactionRemaining,49);
  for(const result of await Promise.all(polls)){assert.equal(result.data.interactions[0].effect,'water');assert.equal(result.data.interactions[0].target,1);assert.equal(result.data.interactionRemaining,50);}
  for(let use=1;use<50;use++)assert.equal((await app.request(base+'/interactions',sessions[0].token,'POST',{...input,id:'http-throw-'+use,effect:use%2?'tomato':'water'})).data.interactionRemaining,49-use);
  assert.equal((await app.request(base+'/interactions',sessions[0].token,'POST',{...input,id:'http-fifty-first'})).status,429);
  assert.equal((await app.request(base+'/interactions',sessions[0].token,'POST',input)).data.interactionRemaining,0);
});
