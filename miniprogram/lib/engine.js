'use strict';

const { typeOf, wildcardAfter, assertTile } = require('./tiles');
const { classifyWin, transfers } = require('./rules');
const { RULES_VERSION, SHUFFLE_VERSION, shuffle, wallCode } = require('./shuffle');
const clone = value => JSON.parse(JSON.stringify(value));
const remaining = hand => Math.max(0, hand.tail - hand.head + 1);
const need = (condition, message) => { if (!condition) throw new Error(message); };
const ACTION_ID = /^[A-Za-z0-9_-]{1,128}$/;
const isActionId = value => typeof value === 'string' && ACTION_ID.test(value);

function createHand(options) {
  const context = { matchId: options.matchId, handNo: options.handNo, dealerSeat: options.dealerSeat, rulesVersion: options.rulesVersion === undefined ? RULES_VERSION : options.rulesVersion, shuffleVersion: SHUFFLE_VERSION };
  const wall = shuffle(options.seedHex);
  const scores = (options.scores || [0, 0, 0, 0]).slice();
  need(scores.length === 4 && scores.every(Number.isSafeInteger) && scores.reduce((a, b) => a + b, 0) === 0, '初始分数不合法');
  return {
    schemaVersion: 1, ...context, seedHex: options.seedHex, wall, wallCode: wallCode(context, wall),
    indicatorId: wall[107], wildcardType: wildcardAfter(typeOf(wall[107])),
    head: 0, tail: 106, phase: 'commit', actor: context.dealerSeat,
    players: Array.from({ length: 4 }, () => ({ hand: [], melds: [], discards: [], floated: [] })),
    floats: [0, 0, 0, 0], scores, initialScores: scores.slice(),
    lastDraw: null, canWin: false, pending: null, acknowledgements: [null, null, null, null],
    events: [], payments: [], commands: [], startedAt: options.startedAt || new Date().toISOString(), finishedAt: null, result: null,
  };
}

function remove(player, ids) {
  ids.forEach(id => {
    const index = player.hand.indexOf(id);
    need(index >= 0, '这张牌不在你的手牌中');
    player.hand.splice(index, 1);
  });
}

function conservation(hand) {
  const ids = [hand.indicatorId].concat(hand.wall.slice(hand.head, hand.tail + 1));
  hand.players.forEach(player => {
    ids.push(...player.hand, ...player.floated);
    player.melds.forEach(meld => ids.push(...meld.tiles));
    player.discards.filter(discard => !discard.claimed).forEach(discard => ids.push(discard.id));
  });
  need(ids.length === 108 && new Set(ids).size === 108 && ids.every(id => Number.isInteger(id) && id >= 0 && id < 108), '实体牌数量校验失败');
  need(hand.scores.reduce((a, b) => a + b, 0) === 0, '四人分数之和不为零');
  return true;
}

function legalActions(hand, seat) {
  const actions = [];
  const player = hand.players[seat];
  if (!player || hand.phase === 'finished') return actions;
  if (hand.phase === 'commit') return hand.acknowledgements[seat] ? [] : [{ kind: 'ack' }];
  if (hand.phase === 'responses' && seat !== hand.pending.from && hand.pending.responses[seat] === null) {
    actions.push({ kind: 'pass' });
    const type = typeOf(hand.pending.tileId);
    const matching = player.hand.filter(id => typeOf(id) === type).length;
    if (matching >= 2 && type !== hand.wildcardType) actions.push({ kind: 'pon', type });
    if (matching >= 3 && type !== hand.wildcardType && remaining(hand) > 0) actions.push({ kind: 'exposedKong', type });
    return actions;
  }
  if (hand.phase !== 'own' || hand.actor !== seat) return actions;
  if (hand.canWin && classifyWin(player.hand, player.melds, hand.wildcardType, hand.lastDraw, hand.rulesVersion)) actions.push({ kind: 'win' });
  player.hand.forEach(id => {
    if (typeOf(id) !== hand.wildcardType) actions.push({ kind: 'discard', tile: id });
    else if (remaining(hand) > 4) actions.push({ kind: 'float', tile: id });
  });
  if (remaining(hand) > 0) {
    for (let type = 0; type < 27; type++) {
      if (type === hand.wildcardType) continue;
      const count = player.hand.filter(id => typeOf(id) === type).length;
      if (count === 4) actions.push({ kind: 'concealedKong', type });
      if (count && player.melds.some(meld => meld.kind === 'pon' && meld.type === type)) actions.push({ kind: 'addedKong', type });
    }
  }
  return actions;
}

function act(original, seat, action, timestamp) {
  need(Number.isInteger(seat) && seat >= 0 && seat < 4, '座位编号无效');
  need(action && isActionId(action.id), '操作编号无效');
  const old = original.commands.find(command => command.input.id === action.id);
  if (old) {
    need(old.seat === seat && JSON.stringify(old.input) === JSON.stringify(action), '该操作编号已用于其他指令');
    return original;
  }
  const allowed = legalActions(original, seat).some(option => option.kind === action.kind && (option.tile === undefined || option.tile === action.tile) && (option.type === undefined || option.type === action.type));
  need(allowed, '当前阶段不能执行此操作');
  if (action.tile !== undefined) assertTile(action.tile);
  if (action.kind === 'ack') need(action.code === original.wallCode, '牌山校验码不一致');
  const hand = clone(original);
  const at = timestamp || new Date().toISOString();
  const player = hand.players[seat];
  function event(kind, details) {
    const record = { seq: hand.events.length + 1, actionId: action.id, at, kind, seat, phase: hand.phase, actor: hand.actor, ...details };
    hand.events.push(record);
    return record.seq;
  }
  function pay(kind, recipient, payer, trigger) {
    const payments = transfers(kind, recipient, hand.floats, payer);
    payments.forEach(payment => {
      hand.scores[payment.payer] -= payment.amount;
      hand.scores[payment.recipient] += payment.amount;
      hand.payments.push({ ...payment, kind, actionId: action.id, eventSeq: trigger, scores: hand.scores.slice() });
    });
    event('payment', { payments, scores: hand.scores.slice(), trigger });
  }
  function finish(kind, classification) {
    hand.phase = 'finished';
    hand.finishedAt = at;
    hand.result = { kind, winner: kind === 'win' ? seat : null, classification: classification || null, deltas: hand.scores.map((score, i) => score - hand.initialScores[i]), scores: hand.scores.slice() };
    event(kind === 'win' ? 'win' : 'drawHand', { result: clone(hand.result) });
  }
  function draw(target, source, dealing) {
    if (remaining(hand) === 0) { finish('draw'); return; }
    const position = source === 'tail' ? hand.tail-- : hand.head++;
    const tileId = hand.wall[position];
    hand.players[target].hand.push(tileId);
    if (!dealing) { hand.lastDraw = tileId; hand.canWin = true; }
    event(dealing ? 'deal' : 'draw', { seat: target, tileId, position, source });
  }
  function resolve() {
    const pending = hand.pending;
    if (pending.responses.some(response => response === null)) return;
    const claimant = pending.responses.findIndex(response => response === 'pon' || response === 'exposedKong');
    hand.pending = null;
    hand.phase = 'own';
    hand.lastDraw = null;
    hand.canWin = false;
    if (claimant < 0) {
      hand.actor = (pending.from + 1) % 4;
      draw(hand.actor, 'head', false);
      return;
    }
    hand.actor = claimant;
    const kind = pending.responses[claimant];
    const type = typeOf(pending.tileId);
    const owner = hand.players[claimant];
    const ownTiles = owner.hand.filter(id => typeOf(id) === type).slice(0, kind === 'pon' ? 2 : 3);
    remove(owner, ownTiles);
    owner.melds.push({ kind, type, tiles: ownTiles.concat([pending.tileId]), from: pending.from });
    hand.players[pending.from].discards.find(discard => discard.id === pending.tileId).claimed = true;
    const trigger = event(kind, { seat: claimant, type, tiles: ownTiles.concat([pending.tileId]), ownTiles, from: pending.from, discardId: pending.tileId });
    if (kind === 'exposedKong') { pay(kind, claimant, pending.from, trigger); draw(claimant, 'tail', false); }
  }

  if (action.kind === 'ack') {
    hand.acknowledgements[seat] = at;
    event('ack', { code: action.code });
    if (hand.acknowledgements.every(Boolean)) {
      hand.phase = 'own';
      const rounds = hand.rulesVersion === 'friends-v2' ? 10 : 13;
      for (let i = 0; i < rounds * 4; i++) draw((hand.dealerSeat + i % 4) % 4, 'head', true);
      draw(hand.dealerSeat, 'head', true);
      hand.canWin = true;
    }
  } else if (action.kind === 'discard') {
    const tsumogiri = hand.lastDraw !== null && action.tile === hand.lastDraw;
    remove(player, [action.tile]);
    player.discards.push({ id: action.tile, claimed: false, tsumogiri });
    hand.phase = 'responses';
    hand.canWin = false;
    hand.lastDraw = null;
    hand.pending = { from: seat, tileId: action.tile, responses: [null, null, null, null] };
    hand.pending.responses[seat] = 'discarder';
    event('discard', { tileId: action.tile, tsumogiri });
    const discardedType = typeOf(action.tile);
    // Players with no legal Pon/Kong response are passed automatically. Only
    // players who can actually call see a response window.
    for (let other = 0; other < 4; other++) {
      if (other === seat) continue;
      const count = hand.players[other].hand.filter(id => typeOf(id) === discardedType).length;
      if (discardedType === hand.wildcardType || count < 2) hand.pending.responses[other] = 'pass';
    }
    resolve();
  } else if (['pass', 'pon', 'exposedKong'].includes(action.kind)) {
    hand.pending.responses[seat] = action.kind;
    event('response', { choice: action.kind });
    resolve();
  } else if (action.kind === 'float') {
    remove(player, [action.tile]);
    player.floated.push(action.tile);
    hand.floats[seat]++;
    const trigger = event('float', { tileId: action.tile, count: hand.floats[seat] });
    pay('float', seat, undefined, trigger);
    draw(seat, 'tail', false);
  } else if (action.kind === 'concealedKong' || action.kind === 'addedKong') {
    const ids = player.hand.filter(id => typeOf(id) === action.type).slice(0, action.kind === 'concealedKong' ? 4 : 1);
    remove(player, ids);
    if (action.kind === 'concealedKong') player.melds.push({ kind: action.kind, type: action.type, tiles: ids, from: seat });
    else {
      const meld = player.melds.find(item => item.kind === 'pon' && item.type === action.type);
      meld.kind = 'addedKong'; meld.tiles.push(ids[0]);
    }
    const trigger = event(action.kind, { type: action.type, tiles: ids });
    pay(action.kind, seat, undefined, trigger);
    draw(seat, 'tail', false);
  } else if (action.kind === 'win') {
    const classification = classifyWin(player.hand, player.melds, hand.wildcardType, hand.lastDraw, hand.rulesVersion);
    pay(classification, seat, undefined, hand.events.length + 2);
    finish('win', classification);
  }
  hand.commands.push({ seat, input: clone(action), at });
  conservation(hand);
  return hand;
}

function publicHand(hand, seat) {
  const complete = hand.phase === 'finished';
  const players = hand.players.map((player, index) => ({ ...clone(player), hand: complete || index === seat ? player.hand.slice() : Array(player.hand.length).fill(null) }));
  const counts = hand.players.map(player=>player.hand.length), drawn = [false,false,false,false], discardEvents = [];
  // Derive public animation cues without changing persisted events or old replay verification.
  for (const event of hand.events) {
    if (event.kind === 'deal' || event.kind === 'draw') counts[event.seat]--;
    else if (['discard','float','addedKong'].includes(event.kind)) counts[event.seat]++;
    else if (event.kind === 'concealedKong') counts[event.seat] += 4;
    else if (event.kind === 'pon' || event.kind === 'exposedKong') counts[event.seat] += event.ownTiles.length;
  }
  for (const event of hand.events) {
    const who = event.seat;
    if (event.kind === 'deal' || event.kind === 'draw') {
      counts[who]++;
      if (event.kind === 'draw') drawn[who] = true;
    } else if (event.kind === 'discard') {
      // Internal response counts can reveal skipped calls; number only public discards.
      discardEvents.push({seq:discardEvents.length+1,seat:who,tileId:event.tileId,tsumogiri:Boolean(event.tsumogiri),handCount:counts[who],hadDraw:drawn[who]});
      counts[who]--;drawn[who] = false;
    } else if (event.kind === 'pon' || event.kind === 'exposedKong') {
      counts[who] -= event.ownTiles.length;drawn[who] = false;
    } else if (event.kind === 'concealedKong') counts[who] -= 4;
    else if (event.kind === 'addedKong' || event.kind === 'float') counts[who]--;
  }
  return {
    matchId: hand.matchId, handNo: hand.handNo, dealerSeat: hand.dealerSeat, rulesVersion: hand.rulesVersion, shuffleVersion: hand.shuffleVersion,
    wallCode: hand.wallCode, indicatorId: hand.indicatorId, wildcardType: hand.wildcardType, phase: hand.phase, actor: hand.actor,
    players, floats: hand.floats.slice(), scores: hand.scores.slice(), initialScores: hand.initialScores.slice(), remaining: remaining(hand),
    pending: clone(hand.pending), acknowledgements: hand.acknowledgements.slice(), result: clone(hand.result),
    lastDraw: complete || seat === hand.actor ? hand.lastDraw : null,
    drawSeat: hand.lastDraw === null ? null : hand.actor, discardEvents,
    actions: legalActions(hand, seat), payments: clone(hand.payments),
    ...(complete ? { seedHex: hand.seedHex, wall: hand.wall.slice() } : {}),
  };
}

module.exports = { createHand, act, legalActions, publicHand, remaining, conservation, clone, isActionId };
