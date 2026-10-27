'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {automaticAction}=require('../server/bots');
const {legalActions}=require('../miniprogram/lib/engine');
const {wallCode}=require('../miniprogram/lib/shuffle');
const {verifyMatch}=require('../miniprogram/lib/replay');
const {scenario}=require('./scenarios');
const {table}=require('./helpers');
const plain=[0,1,2,9,10,11,18,19,20,26,26];

function prepare(app,options){
  const match=app.store.match(app.store.room(app.code).matchId),hand=scenario(options);
  hand.matchId=match.id;hand.wallCode=wallCode(hand,hand.wall);match.hands=[hand];match.scores=hand.scores.slice();
  app.store.saveMatch(match);return hand;
}

test('auto-win takes priority over auto-cut, and only an actual draw can be auto-discarded',()=>{
  const hand=scenario({hands:[plain]});hand.lastDraw=0;
  assert.equal(automaticAction(hand,0,{autoWin:true,autoCut:true}).kind,'win');
  assert.deepEqual(automaticAction(hand,0,{autoCut:true}),{kind:'discard',tile:0});
  assert.equal(automaticAction(hand,0,{}),null);
  hand.lastDraw=null;assert.equal(automaticAction(hand,0,{autoCut:true}),null,'opening hands and post-Pon hands require manual selection');
  hand.lastDraw=999;assert.equal(automaticAction(hand,0,{autoCut:true}),null,'never auto-discard another hand tile');
});

test('auto-cut floats a drawn wildcard only when legal and never substitutes an older tile',()=>{
  for(const remaining of [5,4,0]){
    const hand=scenario({hands:[[5,0,1,2,9,10,11,18,19,26,26]],remaining});
    hand.lastDraw=hand.players[0].hand.find(id=>Math.floor(id/4)===5);
    const action=automaticAction(hand,0,{autoCut:true});
    if(remaining===5)assert.deepEqual(action,{kind:'float',tile:hand.lastDraw});else assert.equal(action,null);
  }
});

test('control settings validate, stay private, and cannot be overwritten by another player',()=>{
  const app=table();
  try{
    assert.deepEqual(app.service.view(app.store.room(app.code),app.users[0]).controls,{autoWin:false,skipCalls:false,autoCut:false});
    for(const input of [null,[],{}, {autoCut:'true'}, {autoWin:true,seat:1}, {sortEnabled:true}])assert.throws(()=>app.service.setControls(app.users[0],app.code,input),/设置无效/);
    assert.throws(()=>app.service.setControls(app.users[4],app.code,{skipCalls:true}),/入座玩家/);
    const changed=app.service.setControls(app.users[0],app.code,{skipCalls:true});
    assert.equal(changed.controls.skipCalls,true);assert.equal(app.service.setControls(app.users[0],app.code,{skipCalls:true}).revision,changed.revision);
    const other=app.service.view(app.store.room(app.code),app.users[1]);assert.equal(other.controls.skipCalls,false);
    assert.ok(other.seats.every(player=>!('controls' in player)));
    app.service.setControls(app.users[0],app.code,{autoWin:true});
    const settings=app.service.view(app.store.room(app.code),app.users[0]).controls;assert.equal(settings.skipCalls,true);assert.equal(settings.autoWin,true);
  }finally{app.store.close();}
});

test('skip-calls passes before a discard is broadcast and hides both exposed and self Kongs',()=>{
  const app=table();
  try{
    app.start();
    const options={hands:[[9],[9,9,0,1,2,18,19,20,26,26]]};
    prepare(app,options);
    let hand=app.store.match(app.store.room(app.code).matchId).hands[0];
    let result=app.command(0,{kind:'discard',tile:hand.players[0].hand.find(id=>Math.floor(id/4)===9)});
    assert.equal(result.match.hand.phase,'responses','the same hand normally offers Pon');
    app.service.setControls(app.users[1],app.code,{skipCalls:true});
    assert.equal(app.store.match(result.match.id).hands[0].phase,'own','enabling skip immediately resolves an existing prompt');
    hand=prepare(app,options);const phases=[];
    app.service.changes.on(app.code,()=>phases.push(app.store.match(app.store.room(app.code).matchId).hands[0].phase));
    result=app.command(0,{kind:'discard',tile:hand.players[0].hand.find(id=>Math.floor(id/4)===9)});
    assert.deepEqual(phases,['own'],'other clients never receive an eligible-call waiting window');assert.equal(result.match.hand.pending,null);
    prepare(app,{hands:[[9,9,9,9,0,1,2,18,19,26,26]]});
    let mine=app.service.setControls(app.users[0],app.code,{skipCalls:true});
    assert.ok(!mine.match.hand.actions.some(action=>action.kind.includes('Kong')));
    assert.throws(()=>app.command(0,{kind:'concealedKong',type:9}),/开启免鸣/);
    mine=app.service.setControls(app.users[0],app.code,{skipCalls:false});assert.ok(mine.match.hand.actions.some(action=>action.kind==='concealedKong'));
  }finally{app.store.close();}
});

test('enabling win and cut together settles a winning hand instead of discarding it',()=>{
  const app=table();
  try{
    app.start();const hand=prepare(app,{hands:[plain]});hand.lastDraw=0;
    const match=app.store.match(hand.matchId);match.hands=[hand];app.store.saveMatch(match);
    const result=app.service.setControls(app.users[0],app.code,{autoWin:true,autoCut:true});
    assert.equal(result.match.status,'complete');assert.equal(result.match.hand.result.winner,0);
    for(const user of app.users.slice(0,4))assert.equal(app.service.view(app.store.room(app.code),user).callNotices.at(-1).label,'胡','automatic wins are announced to every seat');
    assert.deepEqual(result.controls,{autoWin:false,skipCalls:false,autoCut:false});
    assert.equal(result.match.hand.players[0].discards.length,0);
    const saved=JSON.stringify(app.store.match(result.match.id));
    app.service.setControls(app.users[0],app.code,{autoWin:true,autoCut:true});assert.equal(JSON.stringify(app.store.match(result.match.id)),saved);
  }finally{app.store.close();}
});

test('public call notices follow confirmed Pon, all Kong kinds and wins, while Pass stays silent',()=>{
  const cases=[
    {kind:'pon',label:'碰',hands:[[9],[9,9]],seat:1},
    {kind:'exposedKong',label:'明杠',hands:[[9],[9,9,9]],seat:1},
    {kind:'concealedKong',label:'暗杠',hands:[[9,9,9,9,0,1,2,18,19,26,26]],seat:0},
    {kind:'addedKong',label:'补杠',hands:[[9,0,1,2,18,19,26,26]],melds:[[{kind:'pon',type:9,from:1}]],seat:0},
    {kind:'win',label:'胡',hands:[plain],seat:0},
    {kind:'pass',hands:[[9],[9,9]],seat:1},
  ];
  for(const example of cases){
    const app=table();
    try{
      app.start();const hand=prepare(app,example);
      if(example.seat===1)app.command(0,{kind:'discard',tile:hand.players[0].hand.find(id=>Math.floor(id/4)===9)});
      app.command(example.seat,{kind:example.kind,...(['win','pass'].includes(example.kind)?{}:{type:9})});
      for(const user of app.users.slice(0,4)){
        const notices=app.service.view(app.store.room(app.code),user).callNotices;
        if(example.kind==='pass')assert.deepEqual(notices,[]);
        else{assert.equal(notices.length,1);assert.equal(notices[0].seat,example.seat);assert.equal(notices[0].label,example.label);assert.equal(notices[0].kind,example.kind);}
      }
      app.service.clock=()=>new Date(Date.UTC(2030,0,1)).toISOString();
      assert.deepEqual(app.service.view(app.store.room(app.code),app.users[0]).callNotices,[],'expired calls disappear from public views');
    }finally{app.store.close();}
  }
});

test('automatic options reset each hand and explicitly enabled automatic commands remain replay-verifiable',()=>{
  const app=table({handsPerMatch:2});
  try{
    app.start();const observed={},enabled=new Set();let steps=0;
    while(true){
      const room=app.store.room(app.code),match=app.store.match(room.matchId),hand=match.hands.at(-1);
      observed[hand.handNo]=hand.wallCode;
      if(hand.phase==='finished')for(const user of app.users.slice(0,4))assert.deepEqual(app.service.view(room,user).controls,{autoWin:false,skipCalls:false,autoCut:false});
      if(match.status==='complete')break;
      assert.ok(++steps<50,'the server must drain automatic draws before waiting for manual input');
      if(hand.phase==='commit'){
        if(!enabled.has(hand.handNo)){
          for(const user of app.users.slice(0,4)){assert.deepEqual(app.service.view(room,user).controls,{autoWin:false,skipCalls:false,autoCut:false});app.service.setControls(user,app.code,{autoWin:true,skipCalls:true,autoCut:true});}
          enabled.add(hand.handNo);
        }
        app.command(hand.acknowledgements.findIndex(value=>!value),{kind:'ack',code:hand.wallCode});
      }
      else if(hand.phase==='finished')app.command(match.continueReady.findIndex(value=>!value),{kind:'continue'});
      else{
        assert.equal(hand.phase,'own');
        assert.equal(automaticAction(hand,hand.actor,{autoWin:true,skipCalls:true,autoCut:true}),null);
        assert.ok(hand.lastDraw===null||Math.floor(hand.lastDraw/4)===hand.wildcardType);
        const action=legalActions(hand,hand.actor).find(item=>item.kind==='discard');assert.ok(action);app.command(hand.actor,action);
      }
    }
    const room=app.store.room(app.code),match=app.store.match(room.matchId);
    assert.equal(verifyMatch(app.service.exportMatch(app.users[0],match.id),observed).status,'passed');
    assert.ok(match.hands.some(hand=>hand.commands.some(record=>record.input.id.startsWith('auto_'))));
    assert.equal(app.service.view(room,app.users[0]).controls.autoWin,false);
  }finally{app.store.close();}
});

test('manual wins and draws clear every player automation setting before the next hand and reconnection',()=>{
  for(const ending of ['win','draw']){
    const app=table({handsPerMatch:2});
    try{
      app.start();const hand=prepare(app,ending==='win'?{hands:[plain]}:{hands:[[9]],remaining:0});
      const room=app.store.room(app.code);room.controls=Object.fromEntries(app.users.slice(0,4).map(user=>[user.id,{autoWin:true,skipCalls:true,autoCut:true}]));app.store.saveRoom(room);
      const result=ending==='win'?app.command(0,{kind:'win'}):app.command(0,{kind:'discard',tile:hand.players[0].hand.find(id=>Math.floor(id/4)===9)});
      assert.equal(result.match.hand.phase,'finished');assert.equal(result.match.hand.result.kind,ending);
      for(const user of app.users.slice(0,4))assert.deepEqual(app.service.view(app.store.room(app.code),user).controls,{autoWin:false,skipCalls:false,autoCut:false});
      const oldScope={matchId:hand.matchId,handNo:hand.handNo};
      assert.throws(()=>app.service.setControls(app.users[0],app.code,{autoCut:true,...oldScope}),error=>error.status===409,'a queued setting cannot reopen a finished hand');
      app.service.setControls(app.users[0],app.code,{autoCut:true,autoWin:true,skipCalls:true});
      for(let seat=0;seat<4;seat++)app.command(seat,{kind:'continue'});
      const stored=app.store.room(app.code),restored=new (require('../server/service').Service)(app.store);
      assert.equal(app.store.match(stored.matchId).hands.at(-1).handNo,2);
      for(const user of app.users.slice(0,4))assert.deepEqual(restored.view(stored,user).controls,{autoWin:false,skipCalls:false,autoCut:false});
      assert.throws(()=>app.service.setControls(app.users[0],app.code,{autoCut:true,...oldScope}),error=>error.status===409,'an old-hand request cannot enable the new hand');
      const changed=app.service.setControls(app.users[0],app.code,{skipCalls:true,matchId:hand.matchId,handNo:2});
      assert.deepEqual(changed.controls,{autoWin:false,skipCalls:true,autoCut:false},'scope metadata is not stored as a preference');
    }finally{app.store.close();}
  }
});
