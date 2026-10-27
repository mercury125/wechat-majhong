'use strict';

const { sha256 } = require('./vendor/sha256');
const RULES_VERSION = 'friends-v3';
const SUPPORTED_RULES = ['friends-v2', RULES_VERSION];
const SHUFFLE_VERSION = 'fy-hmac-sha256-v1';

function utf8(text) {
  const encoded = unescape(encodeURIComponent(text));
  return Array.from(encoded, ch => ch.charCodeAt(0));
}

function u32(value) {
  return [value >>> 24, (value >>> 16) & 255, (value >>> 8) & 255, value & 255];
}

function lp(text) {
  const bytes = utf8(text);
  return u32(bytes.length).concat(bytes);
}

function validateContext(context) {
  if (!context || typeof context.matchId !== 'string' || !context.matchId || utf8(context.matchId).length > 256) throw new Error('对局编号无效');
  if (!Number.isInteger(context.handNo) || context.handNo < 1 || context.handNo > 0xffffffff) throw new Error('小局编号无效');
  if (!Number.isInteger(context.dealerSeat) || context.dealerSeat < 0 || context.dealerSeat > 3) throw new Error('庄家座位编号无效');
  if (!SUPPORTED_RULES.includes(context.rulesVersion) || context.shuffleVersion !== SHUFFLE_VERSION) throw new Error('不支持此规则或洗牌版本');
}

function contextBytes(context) {
  validateContext(context);
  return lp(context.matchId).concat(u32(context.handNo), [context.dealerSeat], lp(context.rulesVersion), lp(context.shuffleVersion));
}

function seedBytes(seedHex) {
  if (typeof seedHex !== 'string' || !/^[a-f0-9]{64}$/.test(seedHex)) throw new Error('种子必须是 64 位小写十六进制字符');
  return seedHex.match(/../g).map(pair => parseInt(pair, 16));
}

function validateWall(wall) {
  if (!Array.isArray(wall) || wall.length !== 108 || wall.some(id => !Number.isInteger(id) || id < 0 || id > 107) || new Set(wall).size !== 108) throw new Error('牌山必须包含 0–107 号实体牌，且每张牌恰好出现一次');
}

function streamBlock(seedHex, counter) {
  return sha256.hmac.array(seedBytes(seedHex), utf8('wechat-mahjong/shuffle/v1\0').concat(u32(counter)));
}

function sample(next, bound) {
  const limit = Math.floor(2 ** 32 / bound) * bound;
  let value;
  do { value = next(); } while (value >= limit);
  return value % bound;
}

function shuffle(seedHex) {
  seedBytes(seedHex);
  let counter = 0;
  let block = [];
  let offset = 32;
  function next() {
    if (offset === 32) { block = streamBlock(seedHex, counter++); offset = 0; }
    const value = block[offset] * 0x1000000 + block[offset + 1] * 0x10000 + block[offset + 2] * 0x100 + block[offset + 3];
    offset += 4;
    return value;
  }
  const wall = Array.from({ length: 108 }, (_, i) => i);
  for (let i = 107; i > 0; i--) {
    const j = sample(next, i + 1);
    [wall[i], wall[j]] = [wall[j], wall[i]];
  }
  return wall;
}

function wallCode(context, wall) {
  validateWall(wall);
  return 'sha256:' + sha256(utf8('wechat-mahjong/wall/v1\0').concat(contextBytes(context), wall));
}

module.exports = { RULES_VERSION, SUPPORTED_RULES, SHUFFLE_VERSION, utf8, contextBytes, seedBytes, validateContext, validateWall, streamBlock, sample, shuffle, wallCode };
