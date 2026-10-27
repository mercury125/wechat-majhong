'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createHand, act, legalActions, publicHand, remaining, conservation } = require('../miniprogram/lib/engine');
const fixture = require('../docs/fixtures/shuffle-v1.json');

function dealt(seedHex = fixture.seedHex) {
  let hand = createHand({...fixture,seedHex,startedAt:'2026-01-01T00:00:00.000Z'});
  for (let seat=0;seat<4;seat++) hand = act(hand,seat,{id:'ack'+seat,kind:'ack',code:hand.wallCode},'2026-01-01T00:00:01.000Z');
  return hand;
}

test('commitment acknowledgement precedes concealed dealing; fixed deal vector', () => {
  let hand = createHand({...fixture});
  assert.deepEqual(hand.players.map(p=>p.hand),[[],[],[],[]]);
  assert.throws(()=>act(hand,0,{id:'bad',kind:'ack',code:'wrong'}));
  for (let seat=0;seat<3;seat++) hand=act(hand,seat,{id:'ack'+seat,kind:'ack',code:hand.wallCode});
  assert.equal(hand.head,0);
  hand=act(hand,3,{id:'ack3',kind:'ack',code:hand.wallCode});
  assert.deepEqual(hand.players.map(p=>p.hand),fixture.expected.initialHandsBySeat);
  assert.equal(remaining(hand),66);
  assert.equal(hand.actor,2);
  assert.equal(hand.lastDraw,null);
  assert.ok(conservation(hand));
});

test('invalid/stale phases and duplicate commands cannot mutate state', () => {
  const original=dealt();
  const selected=legalActions(original,2).find(a=>a.kind==='discard');
  const input={id:'discard-one',...selected};
  assert.throws(()=>act(original,1,input));
  assert.equal(original.phase,'own');
  const next=act(original,2,input);
  assert.equal(next.players[2].discards.length,1);
  assert.equal(act(next,2,input),next);
  assert.throws(()=>act(next,2,{...input,tile:107}));
  assert.throws(()=>act(next,2,{id:'chi',kind:'chi'}));
  assert.throws(()=>act(next,1,{id:'ron',kind:'win'}));
  assert.ok(conservation(next));
});

test('live projections contain no wall, seed or opponents concealed IDs', () => {
  const hand=dealt();
  for(let seat=0;seat<4;seat++) {
    const view=publicHand(hand,seat);
    assert.equal(view.seedHex,undefined);
    assert.equal(view.wall,undefined);
    assert.equal(view.events,undefined);
    for(let other=0;other<4;other++) assert.deepEqual(view.players[other].hand, other===seat?hand.players[seat].hand:Array(hand.players[other].hand.length).fill(null));
  }
});


test('discards record whether the tile was drawn or taken from hand', () => {
  let hand=dealt();
  const opening=legalActions(hand,2).find(action=>action.kind==='discard');
  hand=act(hand,2,{id:'hand-cut',...opening});
  assert.equal(hand.players[2].discards[0].tsumogiri,false);
  assert.equal(hand.events.find(event=>event.kind==='discard').tsumogiri,false);
  if(hand.phase==='responses')for(const seat of [0,1,3])if(hand.pending.responses[seat]===null)hand=act(hand,seat,{id:'pass-'+seat,kind:'pass'});
  assert.equal(hand.phase,'own');assert.equal(hand.actor,3);assert.ok(hand.lastDraw!==null);
  const drawn=hand.lastDraw;
  const discard=legalActions(hand,3).find(action=>action.kind==='discard'&&action.tile===drawn);
  assert.ok(discard);
  hand=act(hand,3,{id:'draw-cut',...discard});
  assert.equal(hand.players[3].discards[0].tsumogiri,true);
  assert.equal(hand.events.filter(event=>event.kind==='discard').pop().tsumogiri,true);
});

test('every viewer gets draw position and ordered public discard cues without concealed identities',()=>{
  let hand=dealt();
  const before=JSON.stringify(hand);
  for(let seat=0;seat<4;seat++)assert.equal(publicHand(hand,seat).drawSeat,null,'opening deal is not a new draw');
  assert.equal(JSON.stringify(hand),before,'projection must not change durable replay data');
  hand=act(hand,2,{id:'motion-opening',...legalActions(hand,2).find(a=>a.kind==='discard')});
  if(hand.phase==='responses')for(const seat of [0,1,3])if(hand.pending.responses[seat]===null)hand=act(hand,seat,{id:'motion-pass-'+seat,kind:'pass'});
  const actor=hand.actor,drawn=hand.lastDraw;
  assert.ok(Number.isInteger(drawn));
  for(let seat=0;seat<4;seat++){
    const view=publicHand(hand,seat);
    assert.equal(view.drawSeat,actor);assert.equal(view.lastDraw,seat===actor?drawn:null);
    assert.deepEqual(view.discardEvents.map(e=>Object.keys(e)),[['seq','seat','tileId','tsumogiri','handCount','hadDraw']]);
    assert.equal(view.discardEvents[0].seq,1,'private response/deal event counts are not exposed');
    assert.equal(view.discardEvents[0].handCount,11);assert.equal(view.discardEvents[0].hadDraw,false);
    if(seat!==actor)assert.ok(view.players[actor].hand.every(id=>id===null));
  }
  hand=act(hand,actor,{id:'motion-draw-cut',kind:'discard',tile:drawn});
  const cue=publicHand(hand,0).discardEvents.at(-1);
  assert.deepEqual(publicHand(hand,0).discardEvents.map(event=>event.seq),[1,2]);
  assert.equal(cue.tileId,drawn);assert.equal(cue.handCount,11);assert.equal(cue.hadDraw,true);assert.equal(cue.tsumogiri,true);
  const publicIds=new Set(hand.players.flatMap(player=>player.discards.map(discard=>discard.id)));
  for(const event of publicHand(hand,0).discardEvents)assert.ok(publicIds.has(event.tileId));
  assert.deepEqual(publicHand(hand,0).discardEvents,publicHand(hand,1).discardEvents);
});

test('full hands conserve tiles and money through calls, floats and exhausted walls', () => {
  const seen=new Set();
  for(let seed=0;seed<25;seed++) {
    let hand=dealt(seed.toString(16).padStart(64,'0'));
    let count=0;
    while(hand.phase!=='finished') {
      assert.ok(count++<1000,'hand must terminate');
      const seat=hand.phase==='own'?hand.actor:hand.pending.responses.findIndex(r=>r===null);
      const options=legalActions(hand,seat);
      const option=options.find(a=>['concealedKong','addedKong','exposedKong','pon','float','win'].includes(a.kind))||options[0];
      assert.ok(option,'a legal action must exist');
      seen.add(option.kind);
      hand=act(hand,seat,{id:'move'+count,...option});
      assert.ok(conservation(hand));
    }
    assert.deepEqual(hand.result.scores,hand.scores);
    assert.equal(hand.scores.reduce((a,b)=>a+b,0),0);
    assert.ok(publicHand(hand,0).wall);
  }
  assert.ok(seen.has('float')&&seen.has('pon'));
});

