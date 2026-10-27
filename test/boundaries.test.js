'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {scenario}=require('./scenarios');
const {act,legalActions,remaining,conservation}=require('../miniprogram/lib/engine');
const {classifyWin}=require('../miniprogram/lib/rules');
let serial=0;
const move=(hand,seat,kind,extra={})=>act(hand,seat,{id:'boundary-'+serial++,kind,...extra});
function discard(hand,seat,type){const id=hand.players[seat].hand.find(id=>Math.floor(id/4)===type);return move(hand,seat,'discard',{tile:id});}
function passPending(hand){for(let seat=0;seat<4;seat++)if(hand.phase==='responses'&&hand.pending.responses[seat]===null)hand=move(hand,seat,'pass');return hand;}

test('float boundary checks before mutation; consecutive floats increment before each payment',()=>{
  const make=count=>scenario({hands:[[5]],remaining:count,tailType:5});
  let five=make(5);
  const wild=five.players[0].hand.find(id=>Math.floor(id/4)===5);
  five=move(five,0,'float',{tile:wild});
  assert.equal(remaining(five),4);assert.equal(five.floats[0],1);
  assert.equal(five.payments[0].counts[0],1);
  assert.equal(legalActions(five,0).some(a=>a.kind==='float'),false);
  const before=JSON.stringify(five);
  assert.throws(()=>move(five,0,'float',{tile:five.lastDraw}),/当前阶段不能执行/);
  assert.equal(JSON.stringify(five),before);
  let six=make(6);
  for(let i=0;i<2;i++)six=move(six,0,'float',{tile:six.players[0].hand.find(id=>Math.floor(id/4)===5)});
  assert.equal(six.floats[0],2);assert.equal(remaining(six),4);
  assert.deepEqual(six.payments.map(p=>p.counts[0]),[1,1,1,2,2,2]);
  assert.ok(conservation(six));
});

test('concealed and added Kongs replace from the last tile and can self-draw',()=>{
  for(const kind of ['concealedKong','addedKong']){
    const options=kind==='concealedKong'?{hands:[[9,9,9,9,0,1,2,18,19,26,26]]}:{hands:[[9,0,1,2,18,19,26,26]],melds:[[{kind:'pon',type:9,from:1}],[],[],[]]};
    let hand=scenario({...options,remaining:1,tailType:20});
    hand=move(hand,0,kind,{type:9});
    assert.equal(remaining(hand),0);assert.equal(Math.floor(hand.lastDraw/4),20);
    assert.equal(hand.players[0].melds[0].tiles.length,4);
    assert.ok(legalActions(hand,0).some(a=>a.kind==='win'));
    assert.equal(hand.payments[0].kind,kind);
    assert.equal(hand.payments.length,3);
    assert.equal(hand.payments.find(p=>p.payer===1).amount,kind==='addedKong'?2:4);
    hand=move(hand,0,'win');assert.equal(hand.result.classification,'black');assert.equal(hand.phase,'finished');
    assert.ok(conservation(hand));
  }
});

test('exposed Kong charges only the discarder and permits a final replacement win',()=>{
  let hand=scenario({hands:[[9],[9,9,9,0,1,2,18,19,26,26]],remaining:1,tailType:20});
  hand=discard(hand,0,9);
  hand=move(hand,1,'exposedKong',{type:9});
  assert.equal(hand.actor,1);assert.equal(remaining(hand),0);
  assert.equal(hand.payments.length,1);assert.equal(hand.payments[0].payer,0);assert.equal(hand.payments[0].recipient,1);assert.equal(hand.payments[0].amount,2);
  assert.equal(hand.players[0].discards[0].claimed,true);
  hand=move(hand,1,'win');assert.equal(hand.result.winner,1);
  assert.ok(conservation(hand));
});

test('a final-discard Pon must discard before a draw; previous payments survive',()=>{
  let hand=scenario({hands:[[9],[9,9]],remaining:0});
  hand.scores=[6,-2,-2,-2];
  hand=discard(hand,0,9);
  assert.equal(legalActions(hand,1).some(a=>a.kind==='exposedKong'),false);
  hand=move(hand,1,'pon',{type:9});
  assert.equal(hand.actor,1);assert.equal(hand.phase,'own');assert.equal(hand.canWin,false);
  assert.equal(legalActions(hand,1).some(a=>a.kind==='win'),false);
  assert.equal(legalActions(hand,1).some(a=>a.kind.includes('Kong')||a.kind==='float'),false);
  hand=move(hand,1,'discard',{tile:hand.players[1].hand.find(id=>Math.floor(id/4)!==hand.wildcardType)});
  hand=passPending(hand);
  assert.equal(hand.phase,'finished');assert.equal(hand.result.kind,'draw');assert.deepEqual(hand.scores,[6,-2,-2,-2]);assert.deepEqual(hand.result.deltas,[6,-2,-2,-2]);
});

test('ordinary last draw can win, no replacement exists at zero, and wildcards cannot Kong',()=>{
  let hand=scenario({hands:[[9],[0,1,2,18,19,20,21,22,23,26]],remaining:1,headType:26});
  hand=discard(hand,0,9);hand=passPending(hand);
  assert.equal(hand.actor,1);assert.equal(remaining(hand),0);
  hand=move(hand,1,'win');assert.equal(hand.result.winner,1);
  const empty=scenario({hands:[[9,9,9,9]],remaining:0});
  assert.throws(()=>move(empty,0,'concealedKong',{type:9}),/当前阶段不能执行/);
  const wild=scenario({hands:[[5,5,5,5]],remaining:10});
  assert.equal(legalActions(wild,0).some(a=>a.kind==='concealedKong'&&a.type===5),false);
  assert.equal(legalActions(wild,0).some(a=>a.kind==='discard'&&Math.floor(a.tile/4)===5),false);
});

test('Jiahei examines all natural decompositions, and opening wins have no last-draw bonus',()=>{
  const copies=Array(27).fill(0);
  const ids=[0,0,0,1,2,3,3,3,4,5,6].map(type=>4*type+copies[type]++);
  assert.equal(classifyWin(ids,[],2,ids[4]),'jiahei');
  assert.equal(classifyWin(ids,[],2,null),'black');
  let opening=scenario({hands:[[0,1,2,9,10,11,18,19,20,26,26]],wildcard:1,remaining:10});
  opening=move(opening,0,'win');assert.equal(opening.result.classification,'black');
});

test('floating after Pon can complete a self-draw and settles both events in order',()=>{
  let hand=scenario({hands:[[9],[9,9,0,1,2,18,19,20,26,5]],remaining:5,tailType:26});
  hand=discard(hand,0,9);hand=move(hand,1,'pon',{type:9});
  assert.equal(hand.canWin,false);assert.equal(hand.payments.length,0);
  const wild=hand.players[1].hand.find(id=>Math.floor(id/4)===5);
  hand=move(hand,1,'float',{tile:wild});assert.equal(hand.floats[1],1);assert.equal(hand.payments.length,3);
  hand=move(hand,1,'win');assert.equal(hand.result.classification,'black');assert.equal(hand.payments.length,6);
  assert.ok(hand.payments.slice(0,3).every(p=>p.kind==='float'));
  assert.ok(hand.payments.slice(3).every(p=>p.kind==='black'&&p.counts[0]===1));
});
