'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const vm = require('node:vm');
const protocol = require('../miniprogram/lib/shuffle');
const fixture = require('../docs/fixtures/shuffle-v1-friends-v3.json');

test('published cross-language shuffle vector and byte encoding', () => {
  assert.equal(Buffer.from(protocol.streamBlock(fixture.seedHex,0)).toString('hex'),fixture.expected.streamBlock0Hex);
  assert.equal(Buffer.from(protocol.contextBytes(fixture)).toString('hex'),fixture.expected.contextHex);
  assert.deepEqual(protocol.shuffle(fixture.seedHex),fixture.expected.wall);
  assert.equal(protocol.wallCode(fixture,fixture.expected.wall),fixture.expected.wallCode);
  const samples = [2**32-1,5,7];
  assert.equal(protocol.sample(()=>samples.shift(),108),5);
  assert.deepEqual(samples,[7]);
});

test('pure JavaScript SHA/HMAC path matches Node crypto without Node globals', () => {
  const sandbox = { module:{exports:{}}, window:{} };
  vm.runInNewContext(fs.readFileSync('miniprogram/lib/vendor/sha256.js','utf8'),sandbox);
  const sha = sandbox.module.exports.sha256;
  for (const message of ['', 'abc', '中文 🀇', 'a'.repeat(1000)]) {
    assert.equal(sha(message),crypto.createHash('sha256').update(message).digest('hex'));
    assert.equal(sha.hmac('key',message),crypto.createHmac('sha256','key').update(message).digest('hex'));
  }
});

test('invalid inputs and changed context/wall cannot pass the original code', () => {
  for (const seed of ['','A'.repeat(64),'0'.repeat(63)]) assert.throws(()=>protocol.shuffle(seed));
  for (const wall of [[],Array(108).fill(0), [...fixture.expected.wall.slice(0,107),108]]) assert.throws(()=>protocol.wallCode(fixture,wall));
  for (const patch of [{handNo:2},{dealerSeat:0},{matchId:'changed'}]) assert.notEqual(protocol.wallCode({...fixture,...patch},fixture.expected.wall),fixture.expected.wallCode);
  assert.throws(()=>protocol.wallCode({...fixture,rulesVersion:'unknown'},fixture.expected.wall));
  assert.throws(()=>protocol.wallCode({...fixture,rulesVersion:'friends-v1'},fixture.expected.wall));
  const wall = fixture.expected.wall.slice();
  [wall[0],wall[1]] = [wall[1],wall[0]];
  assert.notEqual(protocol.wallCode(fixture,wall),fixture.expected.wallCode);
  for (let i=0;i<10;i++) assert.equal(new Set(protocol.shuffle(crypto.randomBytes(32).toString('hex'))).size,108);
});
