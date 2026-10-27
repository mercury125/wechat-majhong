'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { classifyWin, transfers } = require('../miniprogram/lib/rules');
const { wildcardAfter } = require('../miniprogram/lib/tiles');

function ids(types) {
  const copies = Array(27).fill(0);
  return types.map(type => { assert.ok(copies[type] < 4); return type * 4 + copies[type]++; });
}

test('natural, substituted, natural-use wildcard and Jiahei wins', () => {
  const types = [0,1,2,9,10,11,18,19,20,26,26];
  const natural = ids(types);
  assert.equal(classifyWin(natural, [], 5, null), 'black');
  assert.equal(classifyWin(ids([0,1,2,9,10,11,18,19,5,26,26]), [], 5, 20), 'wildcard');
  assert.equal(classifyWin(natural, [], 1, natural[1]), 'jiahei');
  assert.equal(classifyWin(natural, [], 1, null), 'black');
  assert.equal(classifyWin(natural, [], 1, natural[0]), 'black');
  assert.equal(classifyWin(natural, [], 0, natural[0]), 'black');
  assert.equal(classifyWin(natural, [], 26, natural[10]), null);
  const pairWild = ids([0,1,2,9,10,11,18,19,20,25,26]);
  assert.equal(classifyWin(pairWild, [], 26, pairWild[10]), 'wildcard');
});

test('meld counts, same-suit boundaries and wildcard cap', () => {
  assert.equal(classifyWin(ids([0,1,2,9,10,11,26,26]), [{kind:'pon'}], 5, null), 'black');
  assert.equal(classifyWin(ids([26,26]), [{},{},{}], 5, null), 'black');
  assert.equal(classifyWin(ids([7,8,9,10,11,12,18,19,20,26,26]), [], 5, null), null);
  assert.equal(classifyWin(ids([0,1,2,9,10,11,18,19,20,5,5]), [], 5, null), null);
  assert.equal(classifyWin(ids([0,1,2,9,10,11,18,19,20,26]), [], 5, null), null);
  for (let suit = 0; suit < 3; suit++) assert.equal(wildcardAfter(suit * 9 + 8), suit * 9);
});

test('all score table examples use exact integer score units', () => {
  const examples = [[0,0,[2,4,8]],[1,0,[4,8,16]],[0,1,[4,8,16]],[1,1,[8,16,32]],[2,1,[16,32,64]]];
  for (const [winner, payer, amounts] of examples) {
    for (const [index, kind] of ['wildcard','black','jiahei'].entries()) {
      assert.equal(transfers(kind, 0, [winner,payer,0,0])[0].amount, amounts[index] * 2);
    }
  }
  const expected = {wildcard:[16,-8,-4,-4], black:[32,-16,-8,-8], jiahei:[64,-32,-16,-16], concealedKong:[16,-8,-4,-4], exposedKong:[4,-4,0,0], addedKong:[8,-4,-2,-2]};
  for (const [kind, scores] of Object.entries(expected)) {
    const actual = [0,0,0,0];
    transfers(kind,0,[1,1,0,0],1).forEach(p => { actual[p.payer] -= p.amount / 2; actual[p.recipient] += p.amount / 2; });
    assert.deepEqual(actual, scores);
    assert.equal(actual.reduce((a,b)=>a+b),0);
  }
  assert.equal(transfers('addedKong',0,[0,0,0,0])[0].amount,2);
  assert.equal(transfers('exposedKong',0,[0,0,0,0],1)[0].amount,2);
  assert.equal(transfers('concealedKong',0,[0,0,0,0])[0].amount,4);
  for (const kind of ['exposedKong','addedKong','concealedKong']) {
    for (const payer of [undefined,1]) {
      for (const payment of transfers(kind,0,[0,0,0,0],payer)) assert.equal(payment.amount%2,0,'Kong payments must be whole displayed points');
    }
  }
  assert.equal(transfers('float',0,[1,0,0,0])[0].amount,2);
});

