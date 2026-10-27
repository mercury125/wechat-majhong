'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {table,play}=require('./helpers');
const {calculateWall,verifyHand,verifyMatch,replayState}=require('../miniprogram/lib/replay');
const fixture=require('../docs/fixtures/shuffle-v1.json');

test('local wall calculator reproduces the fixed code without a server verdict',()=>{
  const input={...fixture,wall:fixture.expected.wall,wallCode:fixture.expected.wallCode};
  assert.equal(calculateWall(input,fixture.expected.wallCode).status,'passed');
  assert.equal(calculateWall(input).status,'unverified');
  assert.equal(calculateWall({...input,seedHex:'0'.repeat(64)}).status,'failed');
  assert.equal(calculateWall({...input,wall:[0,0]}).status,'failed');
});

test('replay verifies full rules/settlement and reconstructs every event',()=>{
  const t=table({handsPerMatch:2});
  try {
    t.start();
    const {match,observed}=play(t);
    assert.equal(match.rulesVersion,'friends-v2');
    assert.ok(match.hands.every(hand=>hand.rulesVersion==='friends-v2'));
    const exported=t.service.exportMatch(t.users[0],match.id);
    assert.equal(verifyMatch(exported,observed).status,'passed');
    assert.equal(verifyMatch(exported).status,'unverified');
    for(const hand of exported.hands) {
      const state=replayState(hand,hand.events.length);
      for(const field of ['players','scores','floats','head','tail','phase','actor','result']) assert.deepEqual(state[field],hand[field],field);
      for(let i=0;i<hand.events.length;i+=11) assert.deepEqual(replayState(hand,i),replayState(hand,i),'seeking is deterministic');
    }
    const changed=JSON.parse(JSON.stringify(exported.hands[0]));
    changed.events.find(event=>event.kind==='deal').tileId=107;
    const report=verifyHand(changed,observed[1]);
    assert.equal(report.status,'failed');
    assert.match(report.checks.find(check=>check.status==='fail').detail,/首个不一致的操作／事件编号/);
    const payment=JSON.parse(JSON.stringify(exported.hands[0]));
    payment.payments[0].amount++;
    assert.equal(verifyHand(payment,observed[1]).status,'failed');
    const truncated=JSON.parse(JSON.stringify(exported.hands[0]));
    truncated.commands.pop();
    assert.equal(verifyHand(truncated,observed[1]).status,'failed');
    for (const version of ['friends-v1','unsupported']) {
      const invalid={...exported.hands[0],rulesVersion:version};
      assert.equal(verifyHand(invalid).status,'failed');
    }
  } finally {t.store.close();}
});

