'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {Store}=require('../server/store');
const {Service}=require('../server/service');
const {MemoryStore}=require('../cloudfunctions/api/memory-store');
const {CloudService}=require('../cloudfunctions/api/service');
const {botAction}=require('../server/bots');
const {createHand,legalActions,conservation}=require('../miniprogram/lib/engine');
const {verifyMatch}=require('../miniprogram/lib/replay');
let serial=0;

async function setup(backend,handsPerMatch=1){
  const cloud=backend==='cloud',store=cloud?new MemoryStore():new Store(':memory:');
  let seed=0;
  const options={dealer:()=>2,seed:()=>(seed++).toString(16).padStart(64,'0')};
  const service=cloud?new CloudService(store,options):new Service(store,options),users=[];
  for(let seat=0;seat<4;seat++){
    const identity='normal-bots-'+seat,login=await service.login(identity,'Player '+seat);
    users.push(cloud?await service.requireUser(identity):service.authenticate(login.token));
  }
  const created=await service.createRoom(users[0],{handsPerMatch});
  const read=()=>cloud?store.getRoom(created.code):store.room(created.code);
  const match=async()=>{const room=await read();return cloud?room.match:room.matchId&&store.match(room.matchId);};
  const view=async(user=users[0])=>service.view(await read(),user);
  const send=async(user,input)=>{
    const room=await read(),current=await match(),hand=current&&current.hands.at(-1);
    return service.command(user,created.code,{id:'room-bot-'+serial++,expectedRevision:room.revision,...(hand?{matchId:current.id,handNo:hand.handNo}:{}),...input});
  };
  return {store,service,users,code:created.code,read,match,view,send,close(){if(!cloud)store.close();}};
}

for(const backend of ['local','cloud']){
  test(backend+': an existing friends-v2 match keeps its original counts after the upgrade',async()=>{
    const app=await setup(backend),owner=app.users[0];
    try{
      for(let seat=1;seat<4;seat++)await app.send(owner,{kind:'addBot',seat});
      await app.send(owner,{kind:'ready',ready:true});
      const room=await app.read(),match=await app.match();
      match.rulesVersion='friends-v2';
      match.hands=[createHand({matchId:match.id,handNo:1,dealerSeat:0,rulesVersion:'friends-v2',seedHex:'00'.repeat(32)})];
      if(backend==='cloud'){room.match=match;await app.store.updateRoom(room,room.revision);}else app.store.saveMatch(match);
      const view=await app.send(owner,{kind:'ack',code:match.hands[0].wallCode});
      assert.equal(view.match.hand.rulesVersion,'friends-v2');
      assert.deepEqual(view.match.hand.players.map(player=>player.hand.length),[11,10,10,10]);
      await app.send(owner,view.match.hand.actions.find(action=>action.kind==='discard'));
      assert.equal((await app.match()).rulesVersion,'friends-v2');
    }finally{app.close();}
  });

  test(backend+': ordinary-room bot management is owner-only, validated and idempotent',async()=>{
    const app=await setup(backend),[owner,guest,outsider]=app.users;
    try{
      await app.service.join(guest,app.code,{seat:1});
      const created=await app.view();
      assert.equal(created.testMode,false);
      for(const seat of [-1,4,1.5,'2',null,undefined]){
        await assert.rejects(app.send(owner,{kind:'addBot',seat}),error=>error.status===400);
      }
      await assert.rejects(app.send(guest,{kind:'addBot',seat:2}),error=>error.status===403);
      await assert.rejects(app.send(outsider,{kind:'addBot',seat:2}),error=>error.status===403);
      await assert.rejects(app.send(owner,{kind:'addBot',seat:0}),error=>error.status===409);
      await assert.rejects(app.send(owner,{kind:'removeBot',seat:1}),error=>error.status===409);
      let room=await app.send(owner,{id:'bot-add-once',kind:'addBot',seat:2});
      const bot=room.seats[2];
      assert.equal(bot.bot,true);assert.equal(bot.online,true);
      assert.deepEqual(room.ready,[false,false,true,false]);assert.equal(room.match,null);
      const retried=await app.send(owner,{id:'bot-add-once',kind:'addBot',seat:2});
      assert.equal(retried.revision,room.revision);assert.equal(retried.seats[2].id,bot.id);
      await assert.rejects(app.send(owner,{id:'bot-add-once',kind:'addBot',seat:3}),error=>error.status===409);
      await assert.rejects(app.send(guest,{kind:'removeBot',seat:2}),error=>error.status===403);
      room=await app.send(owner,{kind:'removeBot',seat:2});
      assert.equal(room.seats[2],null);assert.equal(room.ready[2],false);
      room=await app.send(owner,{kind:'addBot',seat:3});
      assert.equal(room.seats[3].id,bot.id,'removed bots are reused without growing the user pool');
      room=await app.send(owner,{kind:'settings',handsPerMatch:2});
      assert.deepEqual(room.ready,[false,false,false,true]);assert.equal(room.match,null);
      const solo=await app.service.createRoom(owner,{testMode:true});
      await assert.rejects(async()=>app.service.command(owner,solo.code,{id:'keep-solo-bots',kind:'removeBot',seat:1,expectedRevision:solo.revision}),error=>error.status===403);
    }finally{app.close();}
  });

  test(backend+': adding the final bot starts only when all humans have already readied',async()=>{
    const app=await setup(backend),[owner,guest]=app.users;
    try{
      await app.service.join(guest,app.code,{seat:1});
      await app.send(owner,{kind:'addBot',seat:2});
      await app.send(owner,{kind:'ready',ready:true});
      let room=await app.send(guest,{kind:'ready',ready:true});
      assert.equal(room.match,null);
      room=await app.send(owner,{kind:'addBot',seat:3});
      assert.equal(room.match.status,'active');
      assert.deepEqual(room.match.hand.acknowledgements.map(Boolean),[false,false,true,true]);
      assert.equal(room.match.hand.seedHex,undefined);assert.equal(room.match.hand.wall,undefined);
      await assert.rejects(app.send(owner,{kind:'removeBot',seat:2}),error=>error.status===409);
      await assert.rejects(app.send(owner,{kind:'addBot',seat:0}),error=>error.status===409);
    }finally{app.close();}
  });

  test(backend+': ownership passes to a human and the last human leaving clears all bots',async()=>{
    const app=await setup(backend),[owner,guest,outsider]=app.users;
    try{
      await app.send(owner,{kind:'addBot',seat:1});
      await app.service.join(guest,app.code,{seat:2});
      await app.send(owner,{kind:'addBot',seat:3});
      await app.send(owner,{kind:'leave'});
      let room=await app.view(guest);
      assert.equal(room.ownerId,guest.id);
      room=await app.send(guest,{kind:'removeBot',seat:1});
      assert.equal(room.seats[1],null);
      await app.send(guest,{kind:'leave'});
      const empty=await app.read();
      assert.equal(empty.ownerId,null);assert.deepEqual(empty.seats,[null,null,null,null]);
      assert.deepEqual(empty.ready,[false,false,false,false]);assert.deepEqual(empty.bots,[]);
      room=await app.service.join(outsider,app.code);
      assert.equal(room.ownerId,outsider.id);assert.equal(room.testMode,false);
    }finally{app.close();}
  });

  for(const humans of [1,2,3])test(backend+': '+humans+' humans finish and verify a normal match with '+(4-humans)+' bots',async()=>{
    const app=await setup(backend,2),owner=app.users[0];
    try{
      for(let seat=1;seat<humans;seat++)await app.service.join(app.users[seat],app.code,{seat});
      for(let seat=humans;seat<4;seat++)await app.send(owner,{kind:'addBot',seat});
      assert.equal((await app.view()).match,null);
      for(let seat=0;seat<humans;seat++)await app.send(app.users[seat],{kind:'ready',ready:true});
      let stored=await app.match();
      const bots=stored.seats.filter(player=>player.bot).map(player=>player.playerId);
      assert.equal(bots.length,4-humans);assert.equal(stored.testMode,false);
      const observed={};let moves=0;
      while(stored.status==='active'){
        const hand=stored.hands.at(-1);observed[hand.handNo]=hand.wallCode;
        let seat,action;
        if(hand.phase==='commit'){
          seat=hand.acknowledgements.findIndex(value=>!value);action={kind:'ack',code:hand.wallCode};
        }else if(hand.phase==='finished'){
          seat=stored.continueReady.findIndex(value=>!value);action={kind:'continue'};
        }else{
          seat=hand.phase==='own'?hand.actor:hand.pending.responses.findIndex(value=>value===null);
          action=legalActions(hand,seat).find(action=>action.kind==='win')||botAction(hand,seat);
        }
        assert.ok(seat>=0&&seat<humans,'bots must never require a client command');
        assert.ok(action);assert.ok(++moves<1000,'the mixed match must terminate');
        await app.send(app.users[seat],action);stored=await app.match();
      }
      const exported=await app.service.exportMatch(owner,stored.id);
      assert.equal(exported.hands.length,2);assert.equal(verifyMatch(exported,observed).status,'passed');
      for(const hand of exported.hands)conservation(hand);
      const finished=await app.view();
      assert.deepEqual(finished.ready,Array.from({length:4},(_,seat)=>seat>=humans));
      await app.send(owner,{kind:'removeBot',seat:humans});
      for(let seat=0;seat<humans;seat++){
        const history=await app.service.history(app.users[seat]);
        assert.equal(history.length,1);assert.equal(history[0].testMode,false);
        await app.send(app.users[seat],{kind:'leave'});
      }
      for(const id of bots){
        const history=backend==='cloud'?await app.store.historyFor(id):app.store.history(id);
        assert.equal(history.length,0,'bots must not pin human replays, even after leaving');
      }
    }finally{app.close();}
  });
}
