'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {mkdtempSync,rmSync,mkdirSync}=require('node:fs');
const path=require('node:path');
const {table,play}=require('./helpers');
const {Store}=require('../server/store');
const {Service}=require('../server/service');

test('authenticated seats, frozen settings, stale revisions and idempotent actions',()=>{
  const t=table();
  try {
    assert.equal(t.users[0].history_limit,1000);
    assert.throws(()=>t.service.authenticate('fake-token'),/登录/);
    assert.throws(()=>t.service.view(t.store.room(t.code),t.users[4]),/入座玩家/);
    assert.throws(()=>t.command(1,{kind:'settings',handsPerMatch:3}),/只有房主/);
    const room=t.store.room(t.code);
    const action={id:'ready-once',kind:'ready',ready:true,expectedRevision:room.revision};
    const next=t.service.command(t.users[0],t.code,action);
    assert.equal(t.service.command(t.users[0],t.code,action).revision,next.revision);
    assert.throws(()=>t.service.command(t.users[0],t.code,{...action,ready:false}),/其他内容/);
    assert.throws(()=>t.service.command(t.users[1],t.code,{...action,id:'stale'}),/牌桌状态已更新/);
    t.start();
    assert.equal(t.service.join(t.users[0],t.code).seat,0,'a seated player may reconnect through the original invite');
    assert.throws(()=>t.command(0,{kind:'settings',handsPerMatch:4}),/不能修改/);
    assert.throws(()=>t.service.join(t.users[4],t.code),/已经开始/);
    assert.throws(()=>t.command(0,{kind:'ack',code:next.match?.hand.wallCode,matchId:'wrong'}),/已过期的对局/);
    const view=t.service.view(t.store.room(t.code),t.users[0]);
    assert.equal(view.match.hand.seedHex,undefined);
    assert.equal(view.match.hand.wall,undefined);
  } finally {t.store.close();}
});

test('legacy rules matches are rejected by the active-game command path',()=>{
  const t=table();
  try {
    t.start();
    const room=t.store.room(t.code);
    const match=t.store.match(room.matchId);
    match.rulesVersion='friends-v1';
    match.hands[0].rulesVersion='friends-v1';
    t.store.saveMatch(match);
    const current=t.store.room(t.code),hand=match.hands[0];
    assert.throws(()=>t.service.command(t.users[0],t.code,{id:'legacy-rules',kind:'ack',code:hand.wallCode,matchId:match.id,handNo:hand.handNo,expectedRevision:current.revision}),/已停止支持的规则版本/);
  } finally {t.store.close();}
});

test('an eight-hand match counts draws, discloses each hand, and keeps the dealer on draws',()=>{
  const t=table({handsPerMatch:8});
  try {
    t.start();
    const {match}=play(t,{noWin:true});
    assert.equal(match.hands.length,8);
    assert.equal(match.status,'complete');
    assert.ok(match.hands.every(hand=>hand.result.kind==='draw'));
    assert.ok(match.hands.every(hand=>hand.dealerSeat===2));
    assert.equal(new Set(match.hands.map(hand=>hand.seedHex)).size,8);
    assert.equal(t.service.history(t.users[0]).length,1);
  } finally {t.store.close();}
});

test('active-hand export is withheld; completed hands are accessible before match end',()=>{
  const t=table({handsPerMatch:2});
  try {
    t.start();
    const id=t.store.room(t.code).matchId;
    assert.throws(()=>t.service.exportMatch(t.users[0],id),/暂时没有已结束/);
    let hand;
    for(let count=0;count<1000;count++) {
      hand=t.store.match(id).hands[0];
      if(hand.phase==='finished') break;
      const seat=hand.phase==='commit'?hand.acknowledgements.findIndex(v=>!v):hand.phase==='own'?hand.actor:hand.pending.responses.findIndex(v=>v===null);
      const options=require('../miniprogram/lib/engine').legalActions(hand,seat);
      const action=options.find(a=>a.kind==='win')||options.find(a=>a.kind==='float')||options[0];
      t.command(seat,{...action,...(action.kind==='ack'?{code:hand.wallCode}:{})});
    }
    assert.equal(hand.phase,'finished');
    const exported=t.service.exportMatch(t.users[0],id);
    assert.equal(exported.status,'active');
    assert.equal(exported.hands.length,1);
    assert.ok(exported.hands[0].seedHex);
    assert.throws(()=>t.service.exportMatch(t.users[4],id),/无权访问/);
  } finally {t.store.close();}
});

test('per-player history pruning preserves other participants and needs explicit reduction confirmation',()=>{
  const t=table();
  try {
    const ids=[];
    for(let i=0;i<3;i++) {t.start();ids.push(play(t).match.id);}
    assert.equal(t.service.history(t.users[0]).length,3);
    assert.throws(()=>t.service.updateProfile(t.users[0],{historyMatchLimit:1}),/请确认/);
    t.service.updateProfile(t.users[0],{historyMatchLimit:1,confirmPrune:true});
    assert.equal(t.service.history(t.users[0]).length,1);
    assert.equal(t.service.history(t.users[1]).length,3);
    assert.throws(()=>t.service.exportMatch(t.users[0],ids[0]),/保存范围/);
    assert.ok(t.service.exportMatch(t.users[1],ids[0]));
    t.command(0,{kind:'ready',ready:true});
    assert.equal(t.service.history(t.users[0]).length,1,'lobby actions cannot restore pruned history');
    for(let i=1;i<4;i++) t.service.updateProfile(t.users[i],{historyMatchLimit:1,confirmPrune:true});
    assert.equal(t.store.match(ids[0]),null);
    t.command(3,{kind:'leave'});
    const outsider=t.service.join(t.users[4],t.code);
    assert.equal(outsider.match,null,'new room members cannot see the previous match hands');
  } finally {t.store.close();}
});

test('restart preserves sessions, commitments, response windows and exactly-once settlement',()=>{
  mkdirSync('test-output',{recursive:true});
  const folder=mkdtempSync(path.resolve('test-output/restart-'));
  const filename=path.join(folder,'state.sqlite');
  const t=table({filename});
  let reopened;
  try {
    t.start();
    for(let seat=0;seat<4;seat++) t.command(seat,{kind:'ack',code:t.store.match(t.store.room(t.code).matchId).hands[0].wallCode});
    let view=t.service.view(t.store.room(t.code),t.users[2]);
    const fullHand=t.store.match(t.store.room(t.code).matchId).hands[0];
    const discard=view.match.hand.actions.find(action=>action.kind==='discard'&&fullHand.players.some((player,seat)=>seat!==2&&Math.floor(action.tile/4)!==fullHand.wildcardType&&player.hand.some(id=>Math.floor(id/4)===Math.floor(action.tile/4))&&player.hand.filter(id=>Math.floor(id/4)===Math.floor(action.tile/4)).length>=2));
    assert.ok(discard,'restart test needs a discard that another player can Pon');
    t.command(2,discard);
    const saved=t.store.room(t.code);
    const before=t.service.view(saved,t.users[0]);
    t.store.close();
    reopened=new Store(filename);
    const service=new Service(reopened);
    const user=service.authenticate(t.logins[0].token);
    const after=service.view(service.room(t.code),user);
    assert.deepEqual(after.match,before.match);
    assert.equal(after.revision,before.revision);
    assert.equal(after.match.hand.phase,'responses');
    const receipt=saved.receipts[saved.receipts.length-1];
    const input=JSON.parse(receipt.fingerprint);
    const retried=service.command(reopened.user(receipt.userId),t.code,{...input,expectedRevision:0});
    assert.equal(retried.revision,saved.revision);
  } finally {if(reopened) reopened.close();else t.store.close();rmSync(folder,{recursive:true,force:true});}
});

test('a winning nondealer becomes the next dealer and a late continuation cannot change completed hands',()=>{
  const t=table({handsPerMatch:2});
  try{
    let seed=0;
    t.service.dealer=()=>0;
    t.service.seed=()=>seed++===0?'00000000000000000000000000000000000000000000000000000000000003b8':'02'.repeat(32);
    t.start();
    const id=t.store.room(t.code).matchId;
    for(let seat=0;seat<4;seat++)t.command(seat,{kind:'ack',code:t.store.match(id).hands[0].wallCode});
    let hand=t.store.match(id).hands[0];
    const discard=require('../miniprogram/lib/engine').legalActions(hand,0).find(action=>action.kind==='discard');
    t.command(0,discard);
    const responseHand=t.store.match(id).hands[0];if(responseHand.phase==='responses')for(const seat of [1,2,3])if(responseHand.pending.responses[seat]===null)t.command(seat,{kind:'pass'});
    t.command(1,{kind:'win'});
    hand=t.store.match(id).hands[0];assert.equal(hand.result.winner,1);assert.equal(hand.result.classification,'wildcard');
    const frozen=JSON.stringify(hand);
    for(let seat=0;seat<3;seat++)t.command(seat,{kind:'continue'});
    assert.equal(t.store.match(id).hands.length,1);
    t.command(3,{kind:'continue'});
    const next=t.store.match(id);assert.equal(next.hands[1].dealerSeat,1);assert.equal(next.hands[1].handNo,2);assert.notEqual(next.hands[1].seedHex,hand.seedHex);assert.deepEqual(next.hands[1].initialScores,hand.scores);assert.equal(JSON.stringify(next.hands[0]),frozen);
    t.service.updateProfile(t.users[0],{historyMatchLimit:1});assert.ok(t.store.match(id),'pruning must preserve active matches');
  }finally{t.store.close();}
});

test('default retention keeps exactly the newest 1000 match references',()=>{
  const t=table();
  try{
    t.store.transaction(()=>{
      for(let i=0;i<1001;i++){
        const match={id:'retention-'+i.toString().padStart(4,'0'),status:'complete',endedAt:new Date(Date.UTC(2026,0,1)+i).toISOString(),hands:[],scores:[0,0,0,0]};
        t.store.saveMatch(match);t.store.db.prepare('INSERT INTO history(user_id,match_id) VALUES(?,?)').run(t.users[0].id,match.id);
      }
      assert.equal(t.store.prune(t.users[0].id,t.users[0].history_limit),1);
    });
    assert.equal(t.store.history(t.users[0].id).length,1000);
    assert.equal(t.store.match('retention-0000'),null);assert.ok(t.store.match('retention-1000'));
  }finally{t.store.close();}
});

test('a settled float survives restart and retry without charging anyone twice',()=>{
  mkdirSync('test-output',{recursive:true});const folder=mkdtempSync(path.resolve('test-output/payment-restart-'));const filename=path.join(folder,'state.sqlite');
  const t=table({filename});let reopened;
  try{
    t.start();const id=t.store.room(t.code).matchId;let hand;
    for(let moves=0;moves<1000;moves++){
      hand=t.store.match(id).hands[0];if(hand.payments.length)break;
      const seat=hand.phase==='commit'?hand.acknowledgements.findIndex(v=>!v):hand.phase==='own'?hand.actor:hand.pending.responses.findIndex(v=>v===null);
      const options=require('../miniprogram/lib/engine').legalActions(hand,seat);
      const action=options.find(a=>a.kind==='float')||options.find(a=>a.kind!=='win');
      t.command(seat,{...action,...(action.kind==='ack'?{code:hand.wallCode}:{})});
    }
    assert.ok(hand.payments.length>0);assert.equal(hand.payments[0].kind,'float');
    const room=t.store.room(t.code),receipt=room.receipts[room.receipts.length-1];
    const before=JSON.stringify(hand);t.store.close();reopened=new Store(filename);const service=new Service(reopened);
    service.command(reopened.user(receipt.userId),t.code,{...JSON.parse(receipt.fingerprint),expectedRevision:0});
    assert.equal(JSON.stringify(reopened.match(id).hands[0]),before);
    assert.equal(reopened.room(t.code).revision,room.revision);
  }finally{if(reopened)reopened.close();else t.store.close();rmSync(folder,{recursive:true,force:true});}
});

test('character choices validate membership, upgrade older rooms and follow a player between seats',()=>{
  const t=table();
  try{
    const old=t.store.room(t.code);delete old.characters;delete old.emotes;t.store.saveRoom(old);
    assert.deepEqual(t.service.view(old,t.users[0]).characters,['ironclad','silent','defect','watcher']);
    assert.throws(()=>t.service.social(t.users[4],t.code,'appearance',{character:'watcher'}),/入座玩家/);
    assert.throws(()=>t.service.social(t.users[0],t.code,'appearance',{character:'../../private'}),/有效角色/);
    const changed=t.service.social(t.users[1],t.code,'appearance',{character:'watcher'});
    assert.equal(changed.characters[1],'watcher');
    assert.equal(t.service.social(t.users[1],t.code,'appearance',{character:'watcher'}).revision,changed.revision);
    assert.equal(t.service.view(t.store.room(t.code),t.users[0]).characters[1],'watcher');
    t.command(3,{kind:'leave'});t.command(1,{kind:'sit',seat:3});
    const moved=t.store.room(t.code);assert.equal(moved.characters[3],'watcher');assert.equal(moved.characters[1],'silent');
    t.service.social(t.users[1],t.code,'emotes',{id:'leave-emote',emote:'greet'});
    t.command(1,{kind:'leave'});
    const joined=t.service.join(t.users[4],t.code,{seat:3});assert.equal(joined.emotes[3],null);
  }finally{t.store.close();}
});

test('emotes are persistent, idempotent, limited and expire without changing game state or replay',()=>{
  const t=table();
  try{
    t.start();const matchId=t.store.room(t.code).matchId;
    for(let seat=0;seat<4;seat++)t.command(seat,{kind:'ack',code:t.store.match(matchId).hands[0].wallCode});
    const original=JSON.stringify(t.store.match(matchId));
    let now=Date.now();t.service.clock=()=>new Date(now).toISOString();let broadcasts=0;t.service.changes.on(t.code,()=>broadcasts++);
    assert.throws(()=>t.service.social(t.users[4],t.code,'emotes',{id:'outsider',emote:'joy'}),/入座玩家/);
    assert.throws(()=>t.service.social(t.users[0],t.code,'emotes',{id:'invalid',emote:'<script>'}),/有效表情/);
    assert.throws(()=>t.service.social(t.users[0],t.code,'emotes',{id:'../x',emote:'joy'}),/编号无效/);
    t.service.social(t.users[0],t.code,'appearance',{character:'watcher'});
    const sent=t.service.social(t.users[0],t.code,'emotes',{id:'first-emote',emote:'joy'});
    assert.equal(sent.emotes[0].character,'watcher');assert.equal(Date.parse(sent.emotes[0].expiresAt)-now,3000);
    const duplicate=t.service.social(t.users[0],t.code,'emotes',{id:'first-emote',emote:'joy'});
    assert.equal(duplicate.revision,sent.revision);assert.equal(broadcasts,2);
    assert.equal(duplicate.emotes[0].expiresAt,sent.emotes[0].expiresAt,'retries do not extend the bubble');
    assert.throws(()=>t.service.social(t.users[0],t.code,'emotes',{id:'first-emote',emote:'cry'}),/其他内容/);
    assert.throws(()=>t.service.social(t.users[0],t.code,'emotes',{id:'second-emote',emote:'cry'}),error=>error.status===429);
    assert.equal(new Service(t.store,{clock:t.service.clock}).view(t.store.room(t.code),t.users[3]).emotes[0].id,'first-emote');
    now+=2000;assert.throws(()=>t.service.social(t.users[0],t.code,'emotes',{id:'at-two-seconds',emote:'common_laugh'}),error=>error.status===429);
    now+=999;assert.throws(()=>t.service.social(t.users[0],t.code,'emotes',{id:'before-three-seconds',emote:'cry'}),error=>error.status===429);
    assert.equal(t.service.view(t.store.room(t.code),t.users[0]).emotes[0].id,'first-emote');
    now++;assert.equal(t.service.view(t.store.room(t.code),t.users[0]).emotes[0],null,'bubble expires exactly at three seconds');
    t.service.social(t.users[0],t.code,'emotes',{id:'second-emote',emote:'cry'});
    t.service.social(t.users[1],t.code,'emotes',{id:'second-emote',emote:'shock'});
    for(const user of t.users.slice(0,4))assert.equal(t.service.view(t.store.room(t.code),user).emotes[0].emote,'cry');
    assert.throws(()=>t.service.social(t.users[0],t.code,'emotes',{id:'shared-too-fast',emote:'common_laugh'}),error=>error.status===429);
    for(const emotion of require('../miniprogram/lib/cosmetics').commonEmotions){
      now+=3000;t.service.social(t.users[0],t.code,'emotes',{id:emotion.id,emote:emotion.id});
      for(const user of t.users.slice(0,4))assert.equal(t.service.view(t.store.room(t.code),user).emotes[0].emote,emotion.id);
    }
    now+=3000;const expired=t.service.view(t.store.room(t.code),t.users[2]);assert.deepEqual(expired.emotes,[null,null,null,null]);
    const beforeRetry=expired.revision;t.service.social(t.users[0],t.code,'emotes',{id:'first-emote',emote:'joy'});
    assert.equal(t.store.room(t.code).revision,beforeRetry,'late retries cannot replay an old emote');
    assert.equal(JSON.stringify(t.store.match(matchId)),original,'cosmetics never enter the match or scoring event log');
  }finally{t.store.close();}
});

test('interactions validate the sender, target, item and current dealt hand',()=>{
  const t=table();
  try{
    const send=(input,user=t.users[0])=>t.service.social(user,t.code,'interactions',input);
    const initial={id:'water-first',effect:'water',target:1,matchId:'waiting',handNo:1};
    assert.throws(()=>send(initial),error=>error.status===409);
    const started=t.start(),scope={matchId:started.match.id,handNo:1};
    assert.throws(()=>send({...initial,...scope}),error=>error.status===409);
    for(let seat=0;seat<4;seat++)t.command(seat,{kind:'ack',code:started.match.hand.wallCode});
    assert.throws(()=>send({...initial,...scope},t.users[4]),error=>error.status===403);
    for(const patch of [{effect:'remote-url'},{target:0},{target:4},{target:'1'},{id:'../invalid'}])assert.throws(()=>send({...initial,...scope,...patch}),error=>error.status===400);
    assert.throws(()=>send({...initial,...scope,matchId:'another-match'}),error=>error.status===409);
    assert.throws(()=>send({...initial,...scope,handNo:2}),error=>error.status===409);
    const next=send({...initial,...scope});assert.equal(next.interactionRemaining,49);
    const event=next.interactions[0];assert.equal(event.from,0);assert.equal(event.target,1);assert.equal(event.effect,'water');assert.equal(event.playerId,t.users[0].id);
    assert.equal(Date.parse(event.expiresAt)-Date.parse(event.sentAt),3000);
    for(let seat=1;seat<4;seat++){const view=t.service.view(t.store.room(t.code),t.users[seat]);assert.equal(view.interactionRemaining,50);assert.equal(view.interactions[0].id,'water-first');assert.equal(view.interactionState,undefined);}
  }finally{t.store.close();}
});

test('water and tomatoes share fifty uses per player, survive restart, and never alter emotes or the replay',()=>{
  const t=table();
  try{
    const started=t.start(),scope={matchId:started.match.id,handNo:1};for(let seat=0;seat<4;seat++)t.command(seat,{kind:'ack',code:started.match.hand.wallCode});
    let now=Date.now();t.service.clock=()=>new Date(now).toISOString();
    const original=JSON.stringify(t.store.match(scope.matchId));
    const emote=t.service.social(t.users[0],t.code,'emotes',{id:'while-throwing',emote:'joy'}).emotes[0];
    const first={...scope,id:'throw-0',effect:'water',target:1};
    for(let use=0;use<50;use++){const view=t.service.social(t.users[0],t.code,'interactions',{...first,id:'throw-'+use,effect:use%2?'tomato':'water'});assert.equal(view.interactionRemaining,49-use);assert.equal(view.emotes[0].expiresAt,emote.expiresAt);}
    const room=t.store.room(t.code),revision=room.revision;room.receipts=[];t.store.saveRoom(room);
    assert.equal(t.service.social(t.users[0],t.code,'interactions',first).revision,revision,'retry stays idempotent even after the general receipt window is pruned');
    assert.throws(()=>t.service.social(t.users[0],t.code,'interactions',{...first,effect:'tomato'}),error=>error.status===409);
    assert.throws(()=>t.service.social(t.users[0],t.code,'interactions',{...first,id:'fifty-first'}),error=>error.status===429);
    const other=t.service.social(t.users[1],t.code,'interactions',{...first,target:0});assert.equal(other.interactionRemaining,49);
    now+=1000;const restored=new Service(t.store,{clock:t.service.clock});
    const view=restored.view(t.store.room(t.code),t.users[0]);assert.equal(view.interactionRemaining,0);assert.equal(view.interactions.length,51);
    assert.throws(()=>restored.social(t.users[0],t.code,'interactions',{...first,id:'after-restart'}),error=>error.status===429);
    assert.throws(()=>restored.social(t.users[0],t.code,'emotes',{id:'still-cooling',emote:'common_like'}),error=>error.status===429);
    now+=2000;assert.deepEqual(restored.view(t.store.room(t.code),t.users[0]).interactions,[]);restored.social(t.users[0],t.code,'emotes',{id:'ordinary-still-available',emote:'common_like'});
    assert.equal(restored.view(t.store.room(t.code),t.users[0]).interactionRemaining,0);
    assert.equal(JSON.stringify(t.store.match(scope.matchId)),original);
  }finally{t.store.close();}
});

test('interaction quotas reset on the next hand and rematch while stale requests cannot spend the new quota',()=>{
  const t=table({handsPerMatch:2}),{legalActions}=require('../miniprogram/lib/engine');
  try{
    const started=t.start();for(let seat=0;seat<4;seat++)t.command(seat,{kind:'ack',code:started.match.hand.wallCode});
    const old={id:'old-hand',effect:'tomato',target:1,matchId:started.match.id,handNo:1};t.service.social(t.users[0],t.code,'interactions',old);
    for(let move=0;;move++){
      assert.ok(move<1000);const hand=t.store.match(started.match.id).hands[0];if(hand.phase==='finished')break;
      const seat=hand.phase==='own'?hand.actor:hand.pending.responses.findIndex(value=>value===null),actions=legalActions(hand,seat);
      t.command(seat,actions.find(action=>['win','float','concealedKong','addedKong','exposedKong','pon'].includes(action.kind))||actions[0]);
    }
    for(let seat=0;seat<4;seat++)t.command(seat,{kind:'continue'});
    let view=t.service.view(t.store.room(t.code),t.users[0]);assert.equal(view.match.hand.handNo,2);assert.equal(view.interactionRemaining,50);assert.deepEqual(view.interactions,[]);
    for(let seat=0;seat<4;seat++)t.command(seat,{kind:'ack',code:view.match.hand.wallCode});
    assert.throws(()=>t.service.social(t.users[0],t.code,'interactions',{...old,id:'stale-hand'}),error=>error.status===409);
    t.service.social(t.users[0],t.code,'interactions',{...old,id:'second-hand',handNo:2});
    play(t);const rematch=t.start();assert.notEqual(rematch.match.id,old.matchId);assert.equal(rematch.interactionRemaining,50);assert.deepEqual(rematch.interactions,[]);
    for(let seat=0;seat<4;seat++)t.command(seat,{kind:'ack',code:rematch.match.hand.wallCode});
    assert.throws(()=>t.service.social(t.users[0],t.code,'interactions',{...old,id:'stale-match'}),error=>error.status===409);
    assert.equal(t.service.view(t.store.room(t.code),t.users[0]).interactionRemaining,50);
  }finally{t.store.close();}
});

test('winning streaks count consecutive wins by one player and stop on draws, opponents or a new match',()=>{
  const t=table(),won=seat=>({phase:'finished',result:{kind:'win',winner:seat}}),draw={phase:'finished',result:{kind:'draw'}};
  try{
    assert.equal(t.start().match.winStreak,null);
    assert.deepEqual(t.service.winStreak({hands:[won(0)]}),{seat:0,count:1});
    assert.deepEqual(t.service.winStreak({hands:[won(0),won(0),won(0)]}),{seat:0,count:3});
    assert.deepEqual(t.service.winStreak({hands:[won(1),won(0),won(0)]}),{seat:0,count:2});
    assert.deepEqual(t.service.winStreak({hands:[won(0),draw,won(0)]}),{seat:0,count:1});
    assert.equal(t.service.winStreak({hands:[won(0),draw]}),null);assert.equal(t.service.winStreak({hands:[won(0),{phase:'own',result:null}]}),null);
  }finally{t.store.close();}
});

test('a completed match can restart in the same room without changing history or repeating a start',()=>{
  const t=table();
  try{
    t.start();const completed=play(t).match;
    const archive=JSON.stringify(t.service.exportMatch(t.users[0],completed.id));
    t.service.social(t.users[0],t.code,'appearance',{character:'watcher'});
    const settingsRevision=t.store.room(t.code).revision;
    t.command(0,{kind:'settings',handsPerMatch:2});
    assert.throws(()=>t.service.command(t.users[1],t.code,{id:'old-settings-ready',kind:'ready',ready:true,handsPerMatch:1,matchId:completed.id,expectedRevision:settingsRevision}),/牌桌状态已更新/);
    t.command(0,{kind:'settings',handsPerMatch:1});
    const completedRevision=t.store.room(t.code).revision;
    for(let seat=0;seat<3;seat++)t.service.command(t.users[seat],t.code,{id:'restart-ready-'+seat,kind:'ready',ready:true,handsPerMatch:1,matchId:completed.id,expectedRevision:completedRevision});
    assert.equal(t.store.room(t.code).matchId,completed.id);assert.equal(t.store.match(completed.id).status,'complete');
    t.command(0,{kind:'ready',ready:false});assert.equal(t.store.room(t.code).ready[0],false);
    t.command(0,{kind:'ready',ready:true});
    const input={id:'restart-final-ready',kind:'ready',ready:true,handsPerMatch:1,expectedRevision:completedRevision,matchId:completed.id,handNo:1};
    const started=t.service.command(t.users[3],t.code,input);
    assert.notEqual(started.match.id,completed.id);assert.equal(started.match.status,'active');
    assert.equal(started.match.hand.handNo,1);assert.equal(started.match.hand.phase,'commit');
    assert.deepEqual(started.match.hand.scores,[0,0,0,0]);assert.deepEqual(started.ready,[false,false,false,false]);
    assert.equal(started.characters[0],'watcher');assert.equal(started.settings.handsPerMatch,1);
    assert.deepEqual(started.seats.map(player=>player.id),t.users.slice(0,4).map(user=>user.id));
    assert.equal(t.service.command(t.users[3],t.code,input).match.id,started.match.id);
    assert.throws(()=>t.service.command(t.users[0],t.code,{...input,id:'late-old-match-ready'}),/牌桌状态已更新/);
    assert.throws(()=>t.service.command(t.users[0],t.code,{...input,id:'future-ready',expectedRevision:started.revision+1,matchId:started.match.id}),/牌桌状态已更新/);
    assert.throws(()=>t.command(0,{kind:'continue',matchId:completed.id,handNo:1}),/已过期的对局/);
    assert.equal(JSON.stringify(t.service.exportMatch(t.users[0],completed.id)),archive);
    assert.equal(t.service.history(t.users[0]).length,1);
    play(t);assert.equal(t.service.history(t.users[0]).length,2);
    assert.equal(JSON.stringify(t.service.exportMatch(t.users[0],completed.id)),archive);
  }finally{t.store.close();}
});
