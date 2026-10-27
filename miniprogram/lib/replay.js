'use strict';

const { createHand, act, clone } = require('./engine');
const { SUPPORTED_RULES, SHUFFLE_VERSION, validateContext, validateWall, shuffle, wallCode } = require('./shuffle');

function canonical(value) {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}';
  return JSON.stringify(value);
}
const equal = (a, b) => canonical(a) === canonical(b);

function verification() {
  const checks = [];
  return {
    checks,
    check(name, fn) {
      try { const detail = fn(); checks.push({ name, status: 'pass', detail: detail || '通过' }); return true; }
      catch (error) { checks.push({ name, status: 'fail', detail: /[\u3400-\u9fff]/.test(error.message || '') ? error.message : '数据格式不正确，无法完成此项验证。' }); return false; }
    },
    result() {
      return { status: checks.some(c => c.status === 'fail') ? 'failed' : checks.some(c => c.status === 'unknown') ? 'unverified' : 'passed', checks };
    },
  };
}
const requireTrue = (condition, message) => { if (!condition) throw new Error(message); };

function calculateWall(input, observedCode) {
  const report = verification();
  if (!report.check('对局信息与实体牌编号', () => { validateContext(input); validateWall(input.wall); })) return report.result();
  const calculatedCode = wallCode(input, input.wall);
  report.check('牌山校验码', () => {
    if (input.wallCode !== undefined) requireTrue(input.wallCode === calculatedCode, '重新计算的牌山校验码与提供的值不一致');
    return calculatedCode;
  });
  if (input.seedHex !== undefined && input.seedHex !== '') report.check('种子复现', () => requireTrue(equal(shuffle(input.seedHex), input.wall), '种子复现得到的牌山不一致'));
  else report.checks.push({ name: '种子复现', status: 'unknown', detail: '未提供洗牌种子' });
  if (observedCode) report.check('发牌前承诺', () => requireTrue(observedCode === calculatedCode, '与本地记录的发牌前校验码不一致'));
  else report.checks.push({ name: '发牌前承诺', status: 'unknown', detail: '牌山可复现，但缺少本地记录的发牌前校验码，无法验证事先承诺' });
  return { ...report.result(), calculatedCode };
}

function verifyHand(hand, observedCode) {
  const report = verification();
  if (!report.check('牌谱格式', () => {
    requireTrue(hand && hand.schemaVersion === 1, '不支持此牌谱格式版本');
    validateContext(hand);
    requireTrue(hand.phase === 'finished' && hand.result, '本局尚未结束，或牌谱已被截断');
    requireTrue(Array.isArray(hand.commands) && hand.commands.length <= 10000, '操作记录无效');
    requireTrue(Array.isArray(hand.events) && Array.isArray(hand.payments), '缺少操作或结算记录');
    requireTrue(typeof hand.startedAt === 'string' && Number.isFinite(Date.parse(hand.startedAt)), '本局时间记录无效');
  })) return report.result();
  const wallReport = calculateWall(hand, observedCode);
  report.checks.push(...wallReport.checks);
  let rebuilt;
  if (report.check('规则合法性与操作顺序', () => {
    rebuilt = createHand({ ...hand, scores: hand.initialScores });
    hand.commands.forEach((command, index) => {
      try {
        requireTrue(command && typeof command === 'object', '操作记录格式错误');
        requireTrue(typeof command.at === 'string' && Number.isFinite(Date.parse(command.at)), '时间记录无效');
        rebuilt = act(rebuilt, command.seat, command.input, command.at);
      } catch (error) { throw new Error('第 ' + (index + 1) + ' 条操作：' + (/[\u3400-\u9fff]/.test(error.message || '') ? error.message : '操作记录格式错误')); }
    });
    requireTrue(rebuilt.phase === 'finished', '操作记录在本局结束前中断');
    requireTrue(rebuilt.commands.length === hand.commands.length, '牌谱包含重复指令');
  })) {
    report.check('发牌、摸牌与事件记录', () => {
      const length = Math.max(rebuilt.events.length, hand.events.length);
      for (let i = 0; i < length; i++) requireTrue(equal(rebuilt.events[i], hand.events[i]), '首个不一致的操作／事件编号：' + (i + 1));
      const fieldNames={players:'玩家牌区',floats:'飘癞子次数',head:'牌墙头部',tail:'牌墙尾部',indicatorId:'朝天',wildcardType:'癞子',acknowledgements:'发牌前确认记录',finishedAt:'结束时间'};
      for (const field of Object.keys(fieldNames)) requireTrue(equal(rebuilt[field], hand[field]), '最终状态不一致：' + fieldNames[field]);
    });
    report.check('精确结算与结果', () => {
      requireTrue(equal(rebuilt.payments, hand.payments), '结算记录与规则计算结果不一致');
      requireTrue(equal(rebuilt.scores, hand.scores) && equal(rebuilt.result, hand.result), '本局结果或分数不一致');
    });
  }
  return { ...report.result(), calculatedCode: wallReport.calculatedCode };
}

function verifyMatch(match, observed) {
  const report = verification();
  if (!report.check('整场牌谱格式', () => {
    requireTrue(match && match.schemaVersion === 1 && Array.isArray(match.hands) && match.hands.length > 0, '整场牌谱无效');
    requireTrue(Array.isArray(match.seats) && match.seats.length === 4, '对局必须有四个座位');
    requireTrue(match.seats.every(seat=>seat&&typeof seat.playerId==='string'&&seat.playerId&&typeof seat.name==='string') && new Set(match.seats.map(seat=>seat.playerId)).size===4, '玩家座位无效或重复');
    requireTrue(SUPPORTED_RULES.includes(match.rulesVersion)&&match.shuffleVersion===SHUFFLE_VERSION, '不支持此对局规则或洗牌版本');
    requireTrue(match.settings && Number.isInteger(match.settings.handsPerMatch) && match.settings.handsPerMatch > 0 && match.settings.handsPerMatch <= 0xffffffff, '每场局数无效');
  })) return report.result();
  let scores = [0,0,0,0];
  let dealer;
  const hands = [];
  for (let i = 0; i < match.hands.length; i++) {
    const hand = match.hands[i];
    if (!hand || typeof hand !== 'object') { report.check('第 '+(i+1)+' 局',()=>{throw new Error('小局记录格式错误');}); return report.result(); }
    report.check('第 ' + (i + 1) + ' 局的对局接续', () => {
      requireTrue(hand.matchId === match.id && hand.handNo === i + 1, '本局所属对局或局数顺序不一致');
      requireTrue(hand.rulesVersion === match.rulesVersion && hand.shuffleVersion === match.shuffleVersion, '本局规则或洗牌版本与对局不一致');
      requireTrue(equal(hand.initialScores, scores), '初始分数未延续上一局结果');
      if (dealer !== undefined) requireTrue(hand.dealerSeat === dealer, '庄家接续顺序错误');
    });
    const result = verifyHand(hand, observed && observed[hand.handNo]);
    hands.push(result);
    result.checks.forEach(check => report.checks.push({ ...check, name: '第 ' + (i + 1) + ' 局：' + check.name }));
    scores = hand.scores;
    dealer = hand.result && hand.result.kind === 'win' ? hand.result.winner : hand.dealerSeat;
  }
  report.check('整场总分与局数', () => {
    requireTrue(equal(scores, match.scores), '整场总分与最后一局结果不一致');
    requireTrue(match.hands.length <= match.settings.handsPerMatch, '小局数量超过设定上限');
    if (match.status === 'complete') requireTrue(match.hands.length === match.settings.handsPerMatch && match.endedAt, '已完成对局的牌谱被截断');
    else requireTrue(match.status === 'active', '不支持此对局状态');
  });
  if (match.status === 'active') report.checks.push({ name: '整场完成情况', status: 'unknown', detail: '本场尚未结束，当前仅导出了已完成的小局' });
  return { ...report.result(), hands };
}

function replayState(hand, count) {
  const state = { players: Array.from({length:4}, () => ({hand:[],melds:[],discards:[],floated:[]})), scores: hand.initialScores.slice(), floats:[0,0,0,0], head:0, tail:106, phase:'commit', actor:hand.dealerSeat, lastDraw:null, result:null };
  const end = Math.max(0, Math.min(hand.events.length, count));
  for (const e of hand.events.slice(0, end)) {
    const player = state.players[e.seat];
    const remove = ids => ids.forEach(id => { const index = player.hand.indexOf(id); if (index >= 0) player.hand.splice(index,1); });
    if (e.kind === 'deal' || e.kind === 'draw') {
      player.hand.push(e.tileId);
      if (e.source === 'tail') state.tail--; else state.head++;
      if (e.kind === 'draw') state.lastDraw = e.tileId;
    } else if (e.kind === 'discard') {
      remove([e.tileId]); player.discards.push({id:e.tileId,claimed:false,tsumogiri:Boolean(e.tsumogiri)}); state.lastDraw=null;
    } else if (e.kind === 'pon' || e.kind === 'exposedKong') {
      remove(e.ownTiles);
      player.melds.push({kind:e.kind,type:e.type,tiles:e.tiles.slice(),from:e.from});
      state.players[e.from].discards.find(d=>d.id===e.discardId).claimed=true;
      state.lastDraw=null;
    } else if (e.kind === 'concealedKong') {
      remove(e.tiles); player.melds.push({kind:e.kind,type:e.type,tiles:e.tiles.slice(),from:e.seat});
    } else if (e.kind === 'addedKong') {
      remove(e.tiles); const meld=player.melds.find(m=>m.type===e.type&&m.kind==='pon'); meld.kind=e.kind; meld.tiles.push(...e.tiles);
    } else if (e.kind === 'float') {
      remove([e.tileId]); player.floated.push(e.tileId); state.floats[e.seat]=e.count;
    } else if (e.kind === 'payment') {
      e.payments.forEach(p=>{state.scores[p.payer]-=p.amount;state.scores[p.recipient]+=p.amount;});
    } else if (e.kind === 'win' || e.kind === 'drawHand') state.result=clone(e.result);
    state.phase=e.phase; state.actor=e.actor;
  }
  state.remaining=Math.max(0,state.tail-state.head+1);
  state.eventCount=end;
  return state;
}

module.exports = { canonical, calculateWall, verifyHand, verifyMatch, replayState };
