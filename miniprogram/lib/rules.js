'use strict';

const { typeOf } = require('./tiles');
const { RULES_VERSION, SUPPORTED_RULES } = require('./shuffle');

function sets(counts, needed) {
  if (needed === 0) return counts.every(n => n === 0);
  const t = counts.findIndex(n => n > 0);
  if (t < 0) return false;
  if (counts[t] >= 3) {
    counts[t] -= 3;
    const valid = sets(counts, needed - 1);
    counts[t] += 3;
    if (valid) return true;
  }
  if (t % 9 <= 6 && counts[t + 1] && counts[t + 2]) {
    counts[t]--; counts[t + 1]--; counts[t + 2]--;
    const valid = sets(counts, needed - 1);
    counts[t]++; counts[t + 1]++; counts[t + 2]++;
    if (valid) return true;
  }
  return false;
}

function natural(counts, needed) {
  for (let t = 0; t < 27; t++) {
    if (counts[t] < 2) continue;
    counts[t] -= 2;
    const valid = sets(counts, needed);
    counts[t] += 2;
    if (valid) return true;
  }
  return false;
}

function classifyWin(hand, melds, wildcard, lastDraw, rulesVersion = RULES_VERSION) {
  if (!SUPPORTED_RULES.includes(rulesVersion)) return null;
  const needed = (rulesVersion === 'friends-v2' ? 3 : 4) - melds.length;
  if (needed < 0 || hand.length !== 3 * needed + 2) return null;
  const counts = Array(27).fill(0);
  hand.forEach(id => counts[typeOf(id)]++);
  if (counts[wildcard] > 1) return null;
  if (natural(counts, needed)) {
    if (needed > 0 && lastDraw !== null && hand.includes(lastDraw) && typeOf(lastDraw) === wildcard && wildcard % 9 > 0 && wildcard % 9 < 8 && counts[wildcard - 1] && counts[wildcard + 1]) {
      counts[wildcard - 1]--; counts[wildcard]--; counts[wildcard + 1]--;
      const jiahei = natural(counts, needed - 1);
      counts[wildcard - 1]++; counts[wildcard]++; counts[wildcard + 1]++;
      if (jiahei) return 'jiahei';
    }
    return 'black';
  }
  if (counts[wildcard] === 1) {
    counts[wildcard]--;
    for (let t = 0; t < 27; t++) {
      if (t === wildcard) continue;
      counts[t]++;
      const valid = natural(counts, needed);
      counts[t]--;
      if (valid) return 'wildcard';
    }
  }
  return null;
}

const EXPONENTS = { float: -1, addedKong: 0, exposedKong: 0, concealedKong: 1, wildcard: 1, black: 2, jiahei: 3 };

function transfers(kind, recipient, floats, payer) {
  if (!(kind in EXPONENTS)) throw new Error('结算类型无效');
  const exponent = EXPONENTS[kind];
  return floats.flatMap((n, seat) => {
    if (seat === recipient || (kind === 'exposedKong' && seat !== payer)) return [];
    const amount = 2 ** (floats[recipient] + n + exponent + 1);
    if (!Number.isSafeInteger(amount)) throw new Error('结算金额无效');
    return [{ payer: seat, recipient, amount, counts: [floats[recipient], n], base: 1, multiplier: amount / 2 }];
  });
}

module.exports = { classifyWin, natural, sets, transfers };
