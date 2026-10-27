'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const {mkdtempSync,rmSync,mkdirSync}=require('node:fs');
const path=require('node:path');
const {Store}=require('../server/store');
const {Service}=require('../server/service');
const {botAction}=require('../server/bots');
const {act,conservation,legalActions}=require('../miniprogram/lib/engine');
const {verifyMatch}=require('../miniprogram/lib/replay');
const {wallCode}=require('../miniprogram/lib/shuffle');
const {scenario}=require('./scenarios');
let serial=0;
const plain=[0,1,2,9,10,11,18,19,20,26,26];

function solo(seed=0,handsPerMatch=1,filename=':memory:'){
  const store=new Store(filename);let next=seed;
  const service=new Service(store,{dealer:()=>seed%4,seed:()=>(next++).toString(16).padStart(64,'0')});
  const login=service.login('solo-owner','测试玩家'),user=service.authenticate(login.token);
  const room=service.createRoom(user,{testMode:true,handsPerMatch});
  const app={store,service,user,login,lobby:room};
  app.room=command(app,room,{kind:'ready',ready:true,handsPerMatch});
  return app;
}
function command(app,view,input){
  const h=view.match&&view.match.hand;
  return app.service.command(app.user,view.code,{id:'human_'+serial++,expectedRevision:view.revision,...(h?{matchId:h.matchId,handNo:h.handNo}:{}),...input});
}
function finish(app,start){
  let view=start,moves=0;const observed={};
  while(view.match.status==='active'){
    assert.ok(++moves<500,'solo play must reach the end of its configured hands');
    const hand=view.match.hand;observed[hand.handNo]=hand.wallCode;
    let action;
    if(hand.phase==='commit'){
      assert.deepEqual(hand.acknowledgements.map(Boolean),[false,true,true,true]);action={kind:'ack',code:hand.wallCode};
    }else if(hand.phase==='finished'){
      assert.deepEqual(view.match.continueReady,[false,true,true,true]);action={kind:'continue'};
    }else{
      assert.ok(hand.phase==='responses'||hand.actor===0,'the driver must stop only for the human');
      const stored=app.store.match(view.match.id).hands.at(-1);
      action=hand.actions.find(a=>a.kind==='win')||botAction(stored,0);
      assert.ok(action,'the human must have a legal action: '+JSON.stringify({seed:stored.seedHex,actor:stored.actor,phase:stored.phase,hand:stored.players[stored.actor].hand,melds:stored.players[stored.actor].melds,remaining:hand.remaining}));
    }
    view=command(app,view,action);
  }
  return {view,observed};
}

test('robots always prefer a Kong over Pon, and use all three Kong kinds',()=>{
  for(const copies of [2,3]){
    let hand=scenario({hands:[[9],Array(copies).fill(9)],remaining:10});
    hand=act(hand,0,{id:'offer',kind:'discard',tile:hand.players[0].hand.find(id=>Math.floor(id/4)===9)});
    assert.equal(botAction(hand,1).kind,copies===3?'exposedKong':'pon');
  }
  assert.equal(botAction(scenario({hands:[[9,9,9,9,0,1,2,18,19,26,26]]}),0).kind,'concealedKong');
  assert.equal(botAction(scenario({hands:[[9,0,1,2,18,19,26,26]],melds:[[{kind:'pon',type:9,from:1}]]}),0).kind,'addedKong');
});

test('robots can randomly choose every legal hand tile, including the draw and physical tile zero',t=>{
  let hand=scenario({hands:[plain]});hand.lastDraw=0;
  const choices=legalActions(hand,0).filter(action=>action.kind==='discard'),before=JSON.stringify(hand);
  let index=0;
  t.mock.method(crypto,'randomInt',limit=>{assert.equal(limit,choices.length);return index;});
  for(index=0;index<choices.length;index++)assert.deepEqual(botAction(hand,0),choices[index]);
  assert.ok(choices.some(action=>action.tile===0));assert.ok(choices.some(action=>action.tile!==hand.lastDraw));
  assert.equal(JSON.stringify(hand),before,'choosing a tile does not mutate the hand');
});

test('robots float drawn wildcards legally and randomly hand-cut after Pon or an unfloatable wildcard',()=>{
  const wild=[5,0,1,2,9,10,11,18,19,26,26];
  let hand=scenario({hands:[wild],remaining:5});hand.lastDraw=hand.players[0].hand.find(id=>Math.floor(id/4)===5);
  assert.equal(botAction(hand,0).kind,'float');assert.equal(botAction(hand,0).tile,hand.lastDraw);
  hand=scenario({hands:[wild],remaining:4});hand.lastDraw=hand.players[0].hand.find(id=>Math.floor(id/4)===5);
  const fallback=botAction(hand,0);assert.equal(fallback.kind,'discard');assert.notEqual(Math.floor(fallback.tile/4),5);
  hand=scenario({hands:[[9],[9,9,0,1,2,18,19,20,26,26]],remaining:0});
  hand=act(hand,0,{id:'offer-last',kind:'discard',tile:hand.players[0].hand.find(id=>Math.floor(id/4)===9)});
  hand=act(hand,1,{id:'take-pon',...botAction(hand,1)});
  assert.equal(hand.lastDraw,null);assert.equal(botAction(hand,1).kind,'discard');
  assert.ok(hand.players[1].hand.includes(botAction(hand,1).tile));
});

test('one human gets three sessionless private robots without revealing concealed information',()=>{
  const app=solo();
  try{
    const {room}=app;assert.equal(room.testMode,true);assert.equal(room.seat,0);assert.equal(room.match.status,'active');
    assert.deepEqual(room.seats.map(player=>player.bot),[false,true,true,true]);assert.ok(room.seats.every(player=>player.online));
    assert.equal(app.store.db.prepare('SELECT COUNT(*) AS n FROM sessions').get().n,1);
    assert.equal(room.match.hand.seedHex,undefined);assert.equal(room.match.hand.wall,undefined);
    const outsider=app.service.authenticate(app.service.login('other-person','其他玩家').token);
    assert.throws(()=>app.service.join(outsider,room.code),/不允许其他玩家/);
    assert.throws(()=>app.service.command(outsider,room.code,{id:'direct-join',kind:'join',expectedRevision:room.revision}),/不允许其他玩家/);
    assert.throws(()=>app.service.createRoom(app.user,{testMode:true}),/重连当前对局/);
  }finally{app.store.close();}
});

test('single-player creation and settings wait for human readiness while robots stay ready',()=>{
  const store=new Store(':memory:'),service=new Service(store);
  try{
    const user=service.authenticate(service.login('waiting-owner','测试玩家').token);
    let room=service.createRoom(user,{testMode:true,handsPerMatch:1});
    assert.equal(room.match,null);assert.equal(room.matchId,null);assert.deepEqual(room.ready,[false,true,true,true]);
    const app={service,user};
    room=command(app,room,{kind:'settings',handsPerMatch:3});
    assert.equal(room.match,null);assert.equal(room.settings.handsPerMatch,3);assert.deepEqual(room.ready,[false,true,true,true]);
    assert.equal(service.view(store.room(room.code),user).match,null,'refreshing cannot start the match');
    room=command(app,room,{kind:'ready',ready:true,handsPerMatch:3});
    assert.equal(room.match.status,'active');assert.equal(room.match.settings.handsPerMatch,3);
    assert.deepEqual(room.match.hand.acknowledgements.map(Boolean),[false,true,true,true]);
  }finally{store.close();}
});

test('robot calls are included in the same broadcast as the human discard',()=>{
  const app=solo();
  try{
    const match=app.store.match(app.room.match.id),hand=scenario({hands:[[9],[9,9,9]]});
    hand.matchId=match.id;hand.wallCode=wallCode(hand,hand.wall);match.hands=[hand];match.scores=hand.scores.slice();app.store.saveMatch(match);
    const result=command(app,app.room,{kind:'discard',tile:hand.players[0].hand.find(id=>Math.floor(id/4)===9)});
    assert.ok(result.callNotices.some(notice=>notice.seat===1&&notice.kind==='exposedKong'&&notice.label==='明杠'));
    assert.ok(result.callNotices.every(notice=>notice.kind!=='pass'));
  }finally{app.store.close();}
});

test('single-player matches progress, verify, and rematch with only human commands',()=>{
  let calls=0,cuts=0;
  for(let seed=0;seed<24;seed++){
    const app=solo(seed,2);
    try{
      const {view,observed}=finish(app,app.room);
      assert.deepEqual(view.ready,[false,true,true,true]);
      const exported=app.service.exportMatch(app.user,view.match.id);
      assert.equal(verifyMatch(exported,observed).status,'passed','seed '+seed);
      for(const hand of exported.hands){
        conservation(hand);
        calls+=hand.events.filter(event=>event.seat!==0&&['pon','exposedKong','concealedKong','addedKong'].includes(event.kind)).length;
        cuts+=hand.events.filter(event=>event.seat!==0&&event.kind==='discard'&&event.tsumogiri).length;
      }
      const bots=app.store.room(view.code).bots;
      assert.ok(bots.every(id=>app.store.history(id).length===0),'robots do not pin the human\'s replay retention');
      const archive=JSON.stringify(exported);
      const next=command(app,view,{kind:'ready',ready:true,handsPerMatch:2});
      assert.notEqual(next.match.id,view.match.id);assert.equal(next.match.hand.handNo,1);
      assert.deepEqual(next.match.hand.scores,[0,0,0,0]);
      assert.equal(JSON.stringify(app.service.exportMatch(app.user,view.match.id)),archive);
    }finally{app.store.close();}
  }
  assert.ok(calls>0&&cuts>0,'real bot games must exercise both calls and draw discards');
});

test('retries and server recovery do not repeat robot actions or payments',()=>{
  mkdirSync('test-output',{recursive:true});const folder=mkdtempSync(path.resolve('test-output/solo-restart-')),filename=path.join(folder,'state.sqlite');
  const app=solo(3,1,filename);let reopened;
  try{
    const input={id:'human-ack-once',kind:'ack',code:app.room.match.hand.wallCode,matchId:app.room.match.id,handNo:1,expectedRevision:app.room.revision};
    const view=app.service.command(app.user,app.room.code,input),saved=JSON.stringify(app.store.match(view.match.id));
    assert.equal(app.service.command(app.user,view.code,input).revision,view.revision);assert.equal(JSON.stringify(app.store.match(view.match.id)),saved);
    app.store.close();reopened=new Store(filename);const service=new Service(reopened);const user=service.authenticate(app.login.token);
    const restored=service.join(user,view.code);assert.equal(restored.match.id,view.match.id);assert.equal(restored.revision,view.revision);
    assert.equal(JSON.stringify(reopened.match(view.match.id)),saved);
    finish({store:reopened,service,user},restored);
  }finally{if(reopened)reopened.close();else app.store.close();rmSync(folder,{recursive:true,force:true});}
});

test('ending a test releases the human and preserves completed history and ordinary rooms',()=>{
  const app=solo();
  try{
    const {view}=finish(app,app.room),completed=view.match.id;
    const next=command(app,view,{kind:'ready',ready:true,handsPerMatch:1}),active=next.match.id;
    const input={id:'end-test-once',kind:'leave',expectedRevision:next.revision};
    assert.equal(app.service.command(app.user,view.code,input).left,true);
    assert.equal(app.service.command(app.user,view.code,input).left,true);
    assert.equal(app.store.match(active),null);assert.equal(app.store.match(completed).status,'complete');
    assert.equal(app.service.activeRoom(app.user),undefined);assert.deepEqual(app.service.myRooms(app.user),[]);
    const normal=app.service.createRoom(app.user);assert.equal(normal.testMode,false);assert.equal(normal.match,null);assert.equal(normal.seats.filter(Boolean).length,1);
  }finally{app.store.close();}
});
