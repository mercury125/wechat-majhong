'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const {MemoryStore}=require('../cloudfunctions/api/memory-store');
const {CloudService}=require('../cloudfunctions/api/service');
const {handleAction}=require('../cloudfunctions/api/handler');
const {legalActions}=require('../miniprogram/lib/engine');

function makeService(){
  const store=new MemoryStore();
  let now=Date.UTC(2026,0,1),seed=0;
  const service=new CloudService(store,{clock:()=>new Date(now++).toISOString(),seed:()=>String(seed++).padStart(64,'0'),dealer:()=>2});
  return {store,service};
}
async function call(service,openid,action,data){return handleAction(service,openid,action,data);}
async function view(service,openid,code){return call(service,openid,'view',{code});}
async function command(service,openid,code,input){
  const room=await view(service,openid,code);
  const hand=room.match&&room.match.hand;
  return call(service,openid,'command',{code,input:{expectedRevision:room.revision,...(hand?{matchId:hand.matchId,handNo:hand.handNo}:{}),...input}});
}

test('cloud identity is stable through OpenID and nickname updates',async()=>{
  const {service}=makeService();
  const first=await call(service,'openid-one','login',{name:'云玩家'});
  assert.equal(first.token,'cloud-session');assert.equal(first.user.name,'云玩家');
  const second=await call(service,'openid-one','login',{name:'新昵称'});
  assert.equal(second.user.id,first.user.id);assert.equal(second.user.name,'新昵称');
  const me=await call(service,'openid-one','me');
  assert.equal(me.user.id,first.user.id);assert.deepEqual(me.rooms,[]);
});

test('versioned room reads authorize membership before skipping unchanged views',async t=>{
  const {store,service}=makeService();
  await call(service,'version-owner','login',{name:'Owner'});await call(service,'version-outsider','login',{name:'Outsider'});
  const room=await call(service,'version-owner','createRoom',{handsPerMatch:1});
  const profiles=t.mock.method(store,'getUsers',store.getUsers);
  const unchanged=await call(service,'version-owner','view',{code:room.code,after:room.revision});
  assert.deepEqual(unchanged,{code:room.code,revision:room.revision,unchanged:true});assert.equal(profiles.mock.callCount(),0);
  await assert.rejects(call(service,'version-outsider','view',{code:room.code,after:room.revision}),error=>error.status===403);
  for(const after of [null,-1,'1',1.5])await assert.rejects(call(service,'version-owner','view',{code:room.code,after}),error=>error.status===400);
  const full=await call(service,'version-owner','view',{code:room.code});assert.equal(full.seats.length,4);assert.equal(full.unchanged,undefined);assert.equal(profiles.mock.callCount(),1);
  await command(service,'version-owner',room.code,{id:'version-settings',kind:'settings',handsPerMatch:2});
  const changed=await call(service,'version-owner','view',{code:room.code,after:room.revision});
  assert.equal(changed.settings.handsPerMatch,2);assert.ok(changed.revision>room.revision);assert.equal(changed.unchanged,undefined);
});

test('starting a match checks all four players in parallel and rejects a player active elsewhere',async t=>{
  const {store,service}=makeService(),users=[];
  for(let seat=0;seat<4;seat++){
    await call(service,'start-check-'+seat,'login',{name:'Player '+seat});
    users.push(await store.getUserByOpenid('start-check-'+seat));
  }
  const room=await service.createRoom(users[0],{handsPerMatch:1});
  for(let seat=1;seat<4;seat++)await service.join(users[seat],room.code);
  const pending=[];
  t.mock.method(service,'activeRoom',id=>new Promise(resolve=>pending.push({id,resolve})));
  const starting=service.startMatch(await store.getRoom(room.code));
  assert.deepEqual(pending.map(item=>item.id),users.map(user=>user.id));
  const rejected=assert.rejects(starting,error=>error.status===409&&error.message.includes('其他对局'));
  pending.forEach((item,index)=>item.resolve(index===2?{code:'OTHER123'}:null));await rejected;
  assert.equal((await store.getRoom(room.code)).match,null);
});

test('cloud solo setup waits for Ready and broadcasts robot calls and automatic wins',async()=>{
  const {store,service}=makeService();
  await call(service,'solo-human','login',{name:'测试玩家'});
  let room=await call(service,'solo-human','createRoom',{testMode:true,handsPerMatch:1});
  assert.equal(room.match,null);assert.equal(room.matchId,null);assert.deepEqual(room.ready,[false,true,true,true]);
  room=await command(service,'solo-human',room.code,{id:'solo-settings',kind:'settings',handsPerMatch:2});
  assert.equal(room.match,null);assert.equal(room.settings.handsPerMatch,2);assert.deepEqual(room.ready,[false,true,true,true]);
  assert.equal((await view(service,'solo-human',room.code)).match,null);
  room=await command(service,'solo-human',room.code,{id:'solo-ready',kind:'ready',ready:true,handsPerMatch:2,matchId:null});
  assert.equal(room.match.status,'active');assert.deepEqual(room.match.hand.acknowledgements.map(Boolean),[false,true,true,true]);
  const {scenario}=require('./scenarios'),{wallCode}=require('../miniprogram/lib/shuffle');
  let stored=await store.getRoom(room.code),hand=scenario({hands:[[9],[9,9,9]]});
  hand.matchId=stored.match.id;hand.wallCode=wallCode(hand,hand.wall);stored.match.hands=[hand];stored.match.scores=hand.scores.slice();
  await store.updateRoom(stored,stored.revision);
  room=await command(service,'solo-human',room.code,{id:'solo-offer',kind:'discard',tile:hand.players[0].hand.find(id=>Math.floor(id/4)===9)});
  assert.ok(room.callNotices.some(notice=>notice.seat===1&&notice.kind==='exposedKong'&&notice.label==='明杠'));
  assert.ok(room.callNotices.every(notice=>notice.kind!=='pass'));
  stored=await store.getRoom(room.code);hand=scenario({hands:[[0,1,2,9,10,11,18,19,20,26,26]]});
  hand.matchId=stored.match.id;hand.lastDraw=0;hand.wallCode=wallCode(hand,hand.wall);stored.match.hands=[hand];stored.match.scores=hand.scores.slice();stored.callNotices=[];
  await store.updateRoom(stored,stored.revision);
  room=await call(service,'solo-human','controls',{code:room.code,input:{autoWin:true,matchId:hand.matchId,handNo:hand.handNo}});
  assert.equal(room.match.hand.result.kind,'win');assert.equal(room.callNotices.at(-1).label,'胡');assert.equal(room.callNotices.at(-1).seat,0);
});

test('four cloud users can create, join, ready, play a complete hand and export it',async()=>{
  const {store,service}=makeService();
  for(let seat=0;seat<4;seat++)await call(service,'openid-'+seat,'login',{name:'Cloud '+seat});
  let room=await call(service,'openid-0','createRoom',{handsPerMatch:1});
  for(let seat=1;seat<4;seat++)room=await call(service,'openid-'+seat,'join',{code:room.code,input:{id:'join-'+seat}});
  assert.deepEqual(room.seats.map(player=>player&&player.name),['Cloud 0','Cloud 1','Cloud 2','Cloud 3']);
  for(let seat=0;seat<4;seat++)room=await command(service,'openid-'+seat,room.code,{id:'ready-'+seat,kind:'ready',ready:true,handsPerMatch:1,matchId:null});
  assert.equal(room.match.hand.phase,'commit');
  for(let seat=0;seat<4;seat++){
    const current=await view(service,'openid-'+seat,room.code);
    const hand=current.match.hand;
    room=await command(service,'openid-'+seat,room.code,{id:'ack-'+seat,kind:'ack',code:hand.wallCode,matchId:hand.matchId,handNo:hand.handNo});
  }
  assert.equal(room.match.hand.phase,'own');
  let moves=0;
  while(true){
    const full=await store.getRoom(room.code);
    const match=full.match;
    if(match.status==='complete') break;
    const hand=match.hands[match.hands.length-1];
    let seat,action;
    if(hand.phase==='commit'){seat=hand.acknowledgements.findIndex(value=>!value);action={kind:'ack',code:hand.wallCode};}
    else if(hand.phase==='finished'){seat=match.continueReady.findIndex(value=>!value);action={kind:'continue'};}
    else {
      seat=hand.phase==='own'?hand.actor:hand.pending.responses.findIndex(value=>value===null);
      const options=legalActions(hand,seat);
      action=options.find(option=>option.kind==='win')||options.find(option=>option.kind!=='win');
    }
    const current=await view(service,'openid-'+seat,room.code);
    const actionId='move-'+moves++;
    room=await command(service,'openid-'+seat,room.code,{id:actionId,...action,matchId:hand.matchId,handNo:hand.handNo});
    const noticeLabels={pon:'碰',exposedKong:'明杠',concealedKong:'暗杠',addedKong:'补杠',win:'胡'};
    if(noticeLabels[action.kind]){
      const saved=await store.getRoom(room.code);
      const notice=saved.callNotices.find(notice=>notice.seat===seat&&notice.kind===action.kind);
      assert.ok(notice);
      assert.equal(notice.label,noticeLabels[action.kind]);
      const observer=await view(service,'openid-'+((seat+1)%4),room.code);
      assert.ok(observer.callNotices.some(item=>item.id===notice.id),'other players receive the call announcement');
    }
    if(action.kind==='pass'){
      const saved=await store.getRoom(room.code);
      assert.ok((saved.callNotices||[]).every(notice=>notice.kind!=='pass'),'pass is not announced');
    }
    assert.ok(moves<500,'cloud hand must terminate');
  }
  assert.equal(room.match.status,'complete');
  const history=await call(service,'openid-0','history');
  assert.equal(history.matches.length,1);assert.equal(history.matches[0].scores.reduce((a,b)=>a+b,0),0);
  const exported=await call(service,'openid-0','exportMatch',{matchId:room.match.id});
  assert.equal(exported.hands.length,1);assert.equal(exported.status,'complete');
  await assert.rejects(call(service,'openid-99','exportMatch',{matchId:room.match.id}),/无权访问/);
});

test('concurrent cloud acknowledgements retry without losing any player',async()=>{
  const {service}=makeService();
  for(let seat=0;seat<4;seat++)await call(service,'openid-'+seat,'login',{name:'Ack '+seat});
  let room=await call(service,'openid-0','createRoom',{handsPerMatch:1});
  for(let seat=1;seat<4;seat++)room=await call(service,'openid-'+seat,'join',{code:room.code,input:{id:'ack-join-'+seat}});
  for(let seat=0;seat<4;seat++)room=await command(service,'openid-'+seat,room.code,{id:'ack-ready-'+seat,kind:'ready',ready:true,handsPerMatch:1,matchId:null});
  const views=await Promise.all([0,1,2,3].map(seat=>view(service,'openid-'+seat,room.code)));
  const hand=views[0].match.hand;
  await Promise.all([0,1,2,3].map(seat=>call(service,'openid-'+seat,'command',{code:room.code,input:{id:'concurrent-ack-'+seat,kind:'ack',code:hand.wallCode,matchId:hand.matchId,handNo:hand.handNo,expectedRevision:views[seat].revision}})));
  const final=await view(service,'openid-0',room.code);
  assert.equal(final.match.hand.phase,'own');
  assert.ok(final.match.hand.acknowledgements.every(Boolean));
});

test('cloud command receipts are exactly-once and stale revisions are rejected',async()=>{
  const {service}=makeService();
  await call(service,'openid-a','login',{name:'A'});
  const created=await call(service,'openid-a','createRoom',{handsPerMatch:1});
  const input={id:'settings-once',kind:'settings',handsPerMatch:2,expectedRevision:created.revision};
  const changed=await call(service,'openid-a','command',{code:created.code,input});
  assert.equal(changed.settings.handsPerMatch,2);
  const repeated=await call(service,'openid-a','command',{code:created.code,input});
  assert.equal(repeated.revision,changed.revision);assert.equal(repeated.settings.handsPerMatch,2);
  await assert.rejects(call(service,'openid-a','command',{code:created.code,input:{...input,handsPerMatch:3}}),/已用于其他内容/);
  await assert.rejects(call(service,'openid-a','command',{code:created.code,input:{id:'stale',kind:'settings',handsPerMatch:3,expectedRevision:1}}),/状态已更新/);
});

test('native API maps REST-shaped calls to cloud actions',async()=>{
  const calls=[],storage=new Map();
  const config={apiBase:'https://unused.example',cloudEnv:'cloud-env',development:false};
  const wx={
    getStorageSync:key=>storage.get(key),setStorageSync:(key,value)=>storage.set(key,value),removeStorageSync:key=>storage.delete(key),
    cloud:{callFunction(options){
      calls.push(options.data);
      const data=options.data.action==='login'?{token:'cloud-session',user:{id:'u1',name:'玩家'}}:{revision:7,code:'ABCD1234'};
      options.success({result:{ok:true,data}});
    }},
  };
  const context={wx,module:{exports:{}},require:()=>config,setTimeout,clearTimeout};
  vm.runInNewContext(fs.readFileSync('miniprogram/lib/api.js','utf8'),context);
  const api=context.module.exports;
  const user=await api.login('玩家');
  assert.equal(user.id,'u1');assert.equal(storage.get('sessionToken'),'cloud-session');
  await api.request('/api/me');
  await api.request('/api/rooms','POST',{handsPerMatch:8});
  await api.request('/api/rooms/ABCD1234/commands','POST',{id:'cmd',kind:'discard',tile:3});
  await api.request('/api/rooms/ABCD1234/appearance','POST',{character:'ironclad'});
  await api.request('/api/matches/00000000-0000-4000-8000-000000000000');
  assert.deepEqual(calls.map(item=>item.action),['login','me','createRoom','command','social','exportMatch']);
  assert.equal(calls[3].data.code,'ABCD1234');assert.equal(calls[3].data.input.id,'cmd');
  assert.equal(calls[4].data.kind,'appearance');
});
