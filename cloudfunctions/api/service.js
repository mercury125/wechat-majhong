'use strict';

const { randomBytes, randomUUID } = require('node:crypto');
const { createHand, act, publicHand, clone, isActionId } = require('./shared/engine');
const { RULES_VERSION, SUPPORTED_RULES, SHUFFLE_VERSION } = require('./shared/shuffle');
const { canonical } = require('./shared/replay');
const cosmetics = require('./shared/cosmetics');
const { botAction, automaticAction } = require('./shared/bots');

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const requireTrue = (condition, status, message) => { if (!condition) throw new HttpError(status, message); };
function positive(value, label) {
  requireTrue(Number.isInteger(value) && value > 0 && value <= 0xffffffff, 400, label + '必须是 1–4294967295 之间的整数');
  return value;
}
function nameValue(value) {
  requireTrue(typeof value === 'string' && value.trim().length > 0 && Array.from(value.trim()).length <= 32 && !/[\x00-\x1f\x7f]/.test(value), 400, '昵称须包含 1–32 个可显示字符');
  return value.trim();
}

const COMMAND_KEYS = ['id','kind','tile','type','code','seat','handsPerMatch','ready','matchId','handNo'];
const ROOM_COMMANDS = new Set(['sit','leave','ready','settings','addBot','removeBot']);
const RECEIPT_LIMIT = 512;
const CALL_KINDS = new Set(['pon','exposedKong','concealedKong','addedKong']);
const CALL_NOTICE_LABELS = { pon:'碰', exposedKong:'明杠', concealedKong:'暗杠', addedKong:'补杠', win:'胡' };
// A room document contains the live match snapshot. Keep the document well below
// CloudBase's 1 MiB document limit while still supporting normal friend matches.
const MAX_HANDS_PER_MATCH = 16;

class CloudService {
  constructor(store, options = {}) {
    this.store = store;
    this.clock = options.clock || (() => new Date().toISOString());
    this.seed = options.seed || (() => randomBytes(32).toString('hex'));
    this.dealer = options.dealer || (() => randomUUID().charCodeAt(0) % 4);
  }

  profile(user) { return { id:user.id, name:user.name, historyMatchLimit:user.historyLimit }; }

  async login(openid, name) {
    const nickname = name === undefined ? undefined : nameValue(name);
    let user = await this.store.getUserByOpenid(openid);
    if (!user) {
      user = { id:randomUUID(), openid, name:nickname || '牌友', historyLimit:1000, lastSeen:Date.now() };
      await this.store.putUser(user);
    } else {
      if (nickname !== undefined && nickname !== user.name) user.name = nickname;
      user.lastSeen = Date.now();
      await this.store.putUser(user);
    }
    return { token:'cloud-session', user:this.profile(user) };
  }

  async requireUser(openid) {
    let user = await this.store.getUserByOpenid(openid);
    if (!user) {
      user = { id:randomUUID(), openid, name:'牌友', historyLimit:1000, lastSeen:Date.now() };
      await this.store.putUser(user);
    } else if (!user.lastSeen || Date.now() - user.lastSeen > 20000) {
      user.lastSeen = Date.now();
      await this.store.putUser(user);
    }
    return user;
  }

  async updateProfile(user, body = {}) {
    const name = body.name === undefined ? user.name : nameValue(body.name);
    const limit = body.historyMatchLimit === undefined ? user.historyLimit : positive(body.historyMatchLimit, '牌谱保存场数');
    const count = await this.store.countHistory(user.id);
    requireTrue(limit >= count || body.confirmPrune === true, 409, '降低上限将移除 ' + (count - limit) + ' 场历史对局，请确认后继续');
    user.name = name;
    user.historyLimit = limit;
    await this.store.putUser(user);
    await this.store.pruneHistory(user.id, limit);
    return this.profile(user);
  }

  async room(code) {
    requireTrue(typeof code === 'string' && /^[A-Z0-9]{8}$/.test(code), 404, '房间不存在，请检查房间号');
    const room = await this.store.getRoom(code);
    requireTrue(room, 404, '房间不存在，请检查房间号');
    return room;
  }

  member(room, user) {
    const seat = room.seats.indexOf(user.id);
    requireTrue(seat >= 0, 403, '只有本房间的入座玩家才能访问');
    return seat;
  }

  async activeRoom(userId) {
    const rooms = await this.store.roomsForUser(userId);
    return rooms.find(room => room.match && room.match.status === 'active') || null;
  }

  playerControls(room, id) { return { autoWin:false, skipCalls:false, autoCut:false, ...room.controls?.[id] }; }

  async view(room, user) {
    const seat = this.member(room, user);
    const match = room.match && room.match.seats.some(player => player.playerId === user.id) ? room.match : null;
    const controls = this.playerControls(room, user.id);
    const hand = match && publicHand(match.hands[match.hands.length - 1], seat);
    if (hand && controls.skipCalls) hand.actions = hand.actions.filter(action => !CALL_KINDS.has(action.kind));
    const interactionState = this.interactionState(room, match);
    const now = Date.now();
    const ids = room.seats.filter(Boolean);
    const users = await this.store.getUsers(ids);
    const byId = new Map(users.map(item => [item.id, item]));
    return {
      code: room.code,
      ownerId: room.ownerId,
      seat,
      revision: room.revision,
      ready: room.ready,
      settings: room.settings,
      matchId: room.matchId,
      testMode: room.testMode === true,
      controls,
      characters: room.seats.map((_, index) => cosmetics.character(room.characters?.[index], index).id),
      emotes: room.seats.map((_, index) => room.emotes?.[index] && Date.parse(room.emotes[index].expiresAt) > now ? room.emotes[index] : null),
      interactions: interactionState.events.filter(event => Date.parse(event.expiresAt) > now),
      interactionRemaining: cosmetics.interactionLimit - (interactionState.counts[user.id] || 0),
      seats: room.seats.map(id => {
        if (!id) return null;
        const player = byId.get(id);
        return {
          id,
          name: player ? player.name : '牌友',
          bot: !!room.bots?.includes(id),
          online: !!room.bots?.includes(id) || !!(player && player.lastSeen && now - player.lastSeen < 45000),
        };
      }),
      callNotices: (room.callNotices || []).filter(notice => Date.parse(notice.expiresAt) > now).map(clone),
      match: match ? {
        id: match.id,
        status: match.status,
        settings: match.settings,
        seats: match.seats,
        scores: match.scores,
        continueReady: match.continueReady,
        winStreak: this.winStreak(match),
        hand,
      } : null,
    };
  }

  winStreak(match) {
    const last = match.hands[match.hands.length - 1];
    if (last.phase !== 'finished' || last.result?.kind !== 'win') return null;
    const seat = last.result.winner;
    let count = 0;
    for (let index = match.hands.length - 1; index >= 0; index--) {
      const result = match.hands[index].result;
      if (!result || result.kind !== 'win' || result.winner !== seat) break;
      count++;
    }
    return { seat, count };
  }

  async myRooms(user) {
    const rooms = await this.store.roomsForUser(user.id);
    return rooms.map(room => ({
      code: room.code,
      testMode: room.testMode === true,
      active: !!(room.match && room.match.status === 'active'),
    }));
  }

  async createRoom(user, body = {}) {
    requireTrue(!(await this.activeRoom(user.id)), 409, '请先重连当前对局，再创建其他房间');
    requireTrue(body.testMode === undefined || typeof body.testMode === 'boolean', 400, '测试模式设置无效');
    const handsPerMatch = positive(body.handsPerMatch === undefined ? 8 : body.handsPerMatch, '每场局数');
    requireTrue(handsPerMatch <= MAX_HANDS_PER_MATCH, 400, '云开发模式每场最多支持 ' + MAX_HANDS_PER_MATCH + ' 局');
    let code;
    do { code = randomBytes(5).toString('hex').slice(0, 8).toUpperCase(); } while (await this.store.getRoom(code));
    const room = {
      code,
      ownerId: user.id,
      seats: [user.id, null, null, null],
      ready: [false, false, false, false],
      characters: cosmetics.defaults.slice(),
      emotes: [null, null, null, null],
      settings: { handsPerMatch },
      matchId: null,
      match: null,
      revision: 1,
      receipts: [],
      testMode: body.testMode === true,
      bots: [],
    };
    if (room.testMode) {
      for (let seat = 1; seat < 4; seat++) await this.addBot(room, seat);
      await this.advanceAutomatic(room, null);
    }
    await this.store.createRoom(room);
    return this.view(room, user);
  }

  async addBot(room, seat) {
    room.bots = room.bots || [];
    let id = room.bots.find(id => !room.seats.includes(id));
    if (!id) {
      id = randomUUID();
      await this.store.putUser({ id, openid:null, name:'机器人' + '一二三'[room.bots.length] + '号', historyLimit:1000, lastSeen:Date.now(), bot:true });
      room.bots.push(id);
    }
    room.seats[seat] = id;
    room.ready[seat] = true;
    if (room.characters) room.characters[seat] = cosmetics.defaults[seat];
    if (room.emotes) room.emotes[seat] = null;
  }

  receipt(room, userId, id) {
    return (room.receipts || []).find(item => item.userId === userId && item.id === id);
  }

  recordReceipt(room, userId, id, fingerprint, kind) {
    room.revision++;
    room.receipts = room.receipts || [];
    room.receipts.push({ userId, id, fingerprint, revision:room.revision, kind });
    room.receipts = room.receipts.slice(-RECEIPT_LIMIT);
  }

  async saveRoom(room, expectedRevision) {
    room.matchId = room.match?.id || null;
    await this.store.updateRoom(room, expectedRevision);
  }

  async ensureArchived(room) {
    if (!room.match || room.match.status !== 'complete') return;
    const participants = room.match.seats.filter(player => !player.bot && !room.bots?.includes(player.playerId));
    await this.store.archiveMatch(room.match, participants);
  }

  async startMatch(room) {
    const activeRooms = await Promise.all(room.seats.filter(Boolean).map(id => this.activeRoom(id)));
    requireTrue(activeRooms.every(other => !other || other.code === room.code), 409, '有玩家正在其他对局中');
    const users = await this.store.getUsers(room.seats.filter(Boolean));
    const names = new Map(users.map(item => [item.id, item.name]));
    const id = randomUUID();
    const at = this.clock();
    const match = {
      schemaVersion: 1,
      id,
      roomCode: room.code,
      testMode: room.testMode === true,
      settings: clone(room.settings),
      rulesVersion: RULES_VERSION,
      shuffleVersion: SHUFFLE_VERSION,
      seats: room.seats.map(playerId => ({ playerId, name:names.get(playerId) || '牌友', bot:!!room.bots?.includes(playerId) })),
      status: 'active',
      startedAt: at,
      endedAt: null,
      scores: [0, 0, 0, 0],
      continueReady: [false, false, false, false],
      hands: [createHand({ matchId:id, handNo:1, dealerSeat:this.dealer(), seedHex:this.seed(), startedAt:at })],
    };
    room.matchId = id;
    room.match = match;
    room.ready = [false, false, false, false];
    room.controls = {};
    room.callNotices = [];
    return match;
  }

  async roomCommand(room, user, input, seat) {
    if (input.kind === 'addBot' || input.kind === 'removeBot') {
      requireTrue(!room.testMode && room.ownerId === user.id, 403, '只有普通房间的房主可以添加或移除机器人');
      const target = input.seat;
      requireTrue(Number.isInteger(target) && target >= 0 && target < 4, 400, '请选择有效座位');
      if (input.kind === 'addBot') {
        requireTrue(room.seats[target] === null, 409, '该座位已有人，或房间已满');
        await this.addBot(room, target);
        return room.seats.every(Boolean) && room.ready.every(Boolean) ? this.startMatch(room) : null;
      }
      requireTrue(room.seats[target] && room.bots?.includes(room.seats[target]), 409, '该座位不是机器人');
      room.seats[target] = null;
      room.ready[target] = false;
      if (room.characters) room.characters[target] = cosmetics.defaults[target];
      if (room.emotes) room.emotes[target] = null;
      return null;
    }
    if (input.kind === 'sit') {
      requireTrue(Number.isInteger(input.seat) && input.seat >= 0 && input.seat < 4 && room.seats[input.seat] === null, 409, '该座位已有人，或房间已满');
      room.seats[seat] = null;
      room.ready[seat] = false;
      room.seats[input.seat] = user.id;
      room.ready[input.seat] = false;
      if (room.characters) { room.characters[input.seat] = room.characters[seat]; room.characters[seat] = cosmetics.defaults[seat]; }
      if (room.emotes) { room.emotes[seat] = null; room.emotes[input.seat] = null; }
      return null;
    }
    if (input.kind === 'leave') {
      room.seats[seat] = null;
      room.ready[seat] = false;
      if (room.characters) room.characters[seat] = cosmetics.defaults[seat];
      if (room.emotes) room.emotes[seat] = null;
      if (room.ownerId === user.id) {
        room.ownerId = room.seats.find(id => id && !room.bots?.includes(id)) || null;
        if (!room.ownerId) {
          room.seats = [null, null, null, null];
          room.ready = [false, false, false, false];
          room.bots = [];
        }
      }
      return null;
    }
    if (input.kind === 'ready') {
      requireTrue(typeof input.ready === 'boolean', 400, '准备状态无效');
      room.ready[seat] = input.ready;
      if (input.ready && room.seats.every(Boolean) && room.ready.every(Boolean)) return this.startMatch(room);
      return null;
    }
    if (input.kind === 'settings') {
      requireTrue(room.ownerId === user.id, 403, '只有房主可以修改每场局数');
      const limit = positive(input.handsPerMatch, '每场局数');
      requireTrue(limit <= MAX_HANDS_PER_MATCH, 400, '云开发模式每场最多支持 ' + MAX_HANDS_PER_MATCH + ' 局');
      room.settings.handsPerMatch = limit;
      room.ready = [false, false, false, false];
      return null;
    }
    throw new HttpError(400, '房间操作无效');
  }

  gameCommand(room, match, seat, input) {
    const hand = match.hands[match.hands.length - 1];
    requireTrue(SUPPORTED_RULES.includes(match.rulesVersion) && hand.rulesVersion === match.rulesVersion, 409, '此对局使用了已停止支持的规则版本');
    requireTrue(input.matchId === match.id && input.handNo === hand.handNo, 409, '操作指向已过期的对局或小局');
    if (input.kind === 'continue') {
      requireTrue(hand.phase === 'finished', 409, '本局尚未结束');
      requireTrue(!match.continueReady[seat], 409, '你已准备进入下一局');
      match.continueReady[seat] = true;
      if (match.continueReady.every(Boolean)) {
        room.controls = {};
        room.callNotices = [];
        const dealer = hand.result.kind === 'win' ? hand.result.winner : hand.dealerSeat;
        match.hands.push(createHand({
          matchId:match.id,
          handNo:hand.handNo + 1,
          dealerSeat:dealer,
          rulesVersion:match.rulesVersion,
          seedHex:this.seed(),
          scores:match.scores,
          startedAt:this.clock(),
        }));
        match.continueReady = [false, false, false, false];
      }
      return match;
    }
    const action = { id:input.id, kind:input.kind };
    for (const key of ['tile','type','code']) if (input[key] !== undefined) action[key] = input[key];
    try { match.hands[match.hands.length - 1] = act(hand, seat, action, this.clock()); }
    catch (error) { throw new HttpError(400, error.message); }
    const updated = match.hands[match.hands.length - 1];
    for (const event of updated.events.slice(hand.events.length)) {
      const label = CALL_NOTICE_LABELS[event.kind];
      if (!label) continue;
      const now = Date.now();
      room.callNotices = (room.callNotices || []).filter(notice => Date.parse(notice.expiresAt) > now);
      room.callNotices.push({ id:match.id + ':' + updated.handNo + ':' + event.seq, seat:event.seat, kind:event.kind, label, expiresAt:new Date(now + 1500).toISOString() });
    }
    if (updated.phase === 'finished') room.controls = {};
    match.scores = updated.scores.slice();
    if (updated.phase === 'finished' && match.hands.length >= match.settings.handsPerMatch) {
      match.status = 'complete';
      match.endedAt = this.clock();
    }
    room.matchId = match.id;
    room.match = match;
    return match;
  }

  async advanceAutomatic(room, match) {
    let steps = 0;
    while (true) {
      if (!match || match.status === 'complete') {
        for (let seat = 0; seat < 4; seat++) if (room.bots?.includes(room.seats[seat])) room.ready[seat] = true;
        return;
      }
      const hand = match.hands[match.hands.length - 1];
      let choice;
      for (let seat = 0; seat < 4; seat++) {
        const id = room.seats[seat];
        if (!id) continue;
        const bot = room.bots?.includes(id);
        const action = hand.phase === 'finished'
          ? (bot && !match.continueReady[seat] ? { kind:'continue' } : null)
          : (bot ? botAction(hand, seat) : automaticAction(hand, seat, this.playerControls(room, id)));
        if (action) { choice = { seat, action, bot }; break; }
      }
      if (!choice) return;
      if (++steps > 1000) throw new HttpError(500, '自动操作未能结束本局');
      this.gameCommand(room, match, choice.seat, {
        ...choice.action,
        id:(choice.bot ? 'bot_' : 'auto_') + randomUUID(),
        matchId:match.id,
        handNo:hand.handNo,
      });
    }
  }

  async command(user, code, input) {
    for (let attempt = 0; attempt < 8; attempt++) {
      try {
        return await this.commandOnce(user, code, input);
      } catch (error) {
        const retryable = error && error.code === 'ROOM_REVISION_CONFLICT' && ['ack','ready'].includes(input && input.kind);
        if (!retryable || attempt === 7) throw error;
      }
    }
  }

  async commandOnce(user, code, input) {
    const room = await this.room(code);
    const expectedRevision = room.revision;
    requireTrue(input && isActionId(input.id), 400, '操作编号无效');
    const normalized = {};
    for (const key of COMMAND_KEYS) if (input[key] !== undefined) normalized[key] = input[key];
    const fingerprint = canonical(normalized);
    const prior = this.receipt(room, user.id, input.id);
    if (prior) {
      requireTrue(prior.fingerprint === fingerprint, 409, '该操作编号已用于其他内容');
      await this.ensureArchived(room);
      if (input.kind === 'leave') return { left:true, code };
      return this.view(room, user);
    }
    const acknowledging = input.kind === 'ack';
    const preparing = input.kind === 'ready' && input.handsPerMatch === room.settings.handsPerMatch &&
      (input.matchId === undefined ? null : input.matchId) === room.matchId &&
      Number.isInteger(input.expectedRevision) && input.expectedRevision > 0 && input.expectedRevision <= room.revision;
    requireTrue(acknowledging || preparing || Number.isInteger(input.expectedRevision) && input.expectedRevision === room.revision, 409, '牌桌状态已更新，请刷新后重试');
    let match = room.match;
    const wasComplete = match && match.status === 'complete';
    const active = match && match.status === 'active';
    let seat = room.seats.indexOf(user.id);
    if (input.kind === 'join') {
      requireTrue(!room.testMode || room.ownerId === user.id, 403, '单人测试房间不允许其他玩家加入');
      requireTrue(!active, 409, '本场对局已经开始');
      requireTrue(!(await this.activeRoom(user.id)), 409, '请先重连当前对局');
      if (seat < 0) {
        const desired = input.seat === undefined ? room.seats.indexOf(null) : input.seat;
        requireTrue(Number.isInteger(desired) && desired >= 0 && desired < 4 && room.seats[desired] === null, 409, '该座位已有人，或房间已满');
        room.seats[desired] = user.id;
        room.ready[desired] = false;
        seat = desired;
        if (!room.ownerId) room.ownerId = user.id;
      }
    } else {
      seat = this.member(room, user);
      if (input.kind === 'leave' && room.testMode) {
        room.seats = [null, null, null, null];
        room.ready = [false, false, false, false];
        room.bots = [];
        room.ownerId = null;
        room.matchId = null;
        room.match = null;
        this.recordReceipt(room, user.id, input.id, fingerprint, input.kind);
        await this.saveRoom(room, expectedRevision);
        return { left:true, code };
      }
      if (ROOM_COMMANDS.has(input.kind)) {
        requireTrue(!active, 409, '对局进行中不能修改房间设置或座位');
        match = await this.roomCommand(room, user, input, seat) || match;
      } else {
        requireTrue(active, 409, '当前没有正在进行的对局');
        requireTrue(!this.playerControls(room, user.id).skipCalls || !CALL_KINDS.has(input.kind), 400, '已开启免鸣，请先关闭“鸣”再碰杠');
        match = this.gameCommand(room, match, seat, input);
      }
    }
    room.match = match;
    await this.advanceAutomatic(room, match);
    this.recordReceipt(room, user.id, input.id, fingerprint, input.kind);
    await this.saveRoom(room, expectedRevision);
    await this.ensureArchived(room);
    return input.kind === 'leave' ? { left:true, code } : this.view(room, user);
  }

  async join(user, code, input = {}) {
    const room = await this.room(code);
    if (room.seats.includes(user.id) && room.match && room.match.status === 'active') return this.view(room, user);
    return this.command(user, code, {
      ...input,
      id:input.id || randomUUID(),
      kind:'join',
      expectedRevision:input.expectedRevision === undefined ? room.revision : input.expectedRevision,
    });
  }

  async setControls(user, code, input = {}) {
    const room = await this.room(code);
    const expectedRevision = room.revision;
    this.member(room, user);
    const keys = input && typeof input === 'object' && !Array.isArray(input) ? Object.keys(input) : [];
    const preferences = keys.filter(key => !['matchId','handNo'].includes(key));
    requireTrue(preferences.length > 0 && preferences.every(key => ['autoWin','skipCalls','autoCut'].includes(key) && typeof input[key] === 'boolean'), 400, '自动操作设置无效');
    const match = room.match;
    const hand = match && match.hands[match.hands.length - 1];
    if (keys.some(key => ['matchId','handNo'].includes(key))) {
      requireTrue(hand && hand.phase !== 'finished' && input.matchId === match.id && input.handNo === hand.handNo, 409, '牌局已更新，请在当前小局重新设置');
    }
    const previous = this.playerControls(room, user.id);
    if (preferences.every(key => previous[key] === input[key])) return this.view(room, user);
    if (!room.controls) room.controls = {};
    room.controls[user.id] = { ...previous, ...Object.fromEntries(preferences.map(key => [key, input[key]])) };
    await this.advanceAutomatic(room, match);
    room.revision++;
    await this.saveRoom(room, expectedRevision);
    await this.ensureArchived(room);
    return this.view(room, user);
  }

  async social(user, code, kind, input = {}) {
    const room = await this.room(code);
    const expectedRevision = room.revision;
    const seat = this.member(room, user);
    room.characters = room.seats.map((_, index) => cosmetics.character(room.characters?.[index], index).id);
    room.emotes = room.emotes || [null, null, null, null];
    if (kind === 'appearance') {
      requireTrue(cosmetics.characters.some(item => item.id === input.character), 400, '请选择有效角色');
      if (room.characters[seat] === input.character) return this.view(room, user);
      room.characters[seat] = input.character;
      room.revision++;
      await this.saveRoom(room, expectedRevision);
      return this.view(room, user);
    }
    requireTrue(isActionId(input.id), 400, '操作编号无效');
    const fingerprint = kind === 'interactions'
      ? canonical({ id:input.id, kind:'interaction', effect:input.effect, target:input.target, matchId:input.matchId, handNo:input.handNo })
      : canonical({ id:input.id, kind:'emote', emote:input.emote });
    const prior = this.receipt(room, user.id, input.id);
    if (prior) {
      requireTrue(prior.fingerprint === fingerprint, 409, '该操作编号已用于其他内容');
      return this.view(room, user);
    }
    if (kind === 'interactions') {
      requireTrue(cosmetics.interactions.some(effect => effect.id === input.effect), 400, '请选择有效互动道具');
      requireTrue(Number.isInteger(input.target) && input.target >= 0 && input.target < 4 && input.target !== seat, 400, '请选择其他玩家作为互动对象');
      const match = room.match;
      const hand = match && match.hands[match.hands.length - 1];
      requireTrue(hand && hand.phase !== 'commit', 409, '发牌后才能使用互动道具');
      requireTrue(match.seats.some(player => player.playerId === user.id), 403, '仅本局玩家可使用互动道具');
      requireTrue(input.matchId === match.id && input.handNo === hand.handNo, 409, '牌局已更新，请重新选择互动');
      requireTrue(room.seats[input.target], 400, '该玩家已离开房间');
      const state = this.interactionState(room, match);
      requireTrue((state.counts[user.id] || 0) < cosmetics.interactionLimit, 429, '本局互动次数已用完，每局最多 ' + cosmetics.interactionLimit + ' 次');
      const now = Date.now();
      state.counts[user.id] = (state.counts[user.id] || 0) + 1;
      state.events.push({ id:input.id, playerId:user.id, from:seat, target:input.target, effect:input.effect, matchId:match.id, handNo:hand.handNo, sentAt:new Date(now).toISOString(), expiresAt:new Date(now + cosmetics.interactionLifetime).toISOString() });
      room.interactionState = state;
    } else {
      requireTrue(kind === 'emotes' && cosmetics.emotion(input.emote), 400, '请选择有效表情');
      const now = Date.now();
      const previous = room.emotes[seat];
      requireTrue(!previous || now - Date.parse(previous.sentAt) >= cosmetics.emoteCooldown, 429, '每三秒只能发送一次表情');
      room.emotes[seat] = { id:input.id, emote:input.emote, character:room.characters[seat], sentAt:new Date(now).toISOString(), expiresAt:new Date(now + cosmetics.emoteLifetime).toISOString() };
    }
    this.recordReceipt(room, user.id, input.id, fingerprint, kind);
    await this.saveRoom(room, expectedRevision);
    return this.view(room, user);
  }

  interactionState(room, match) {
    const hand = match && match.hands[match.hands.length - 1];
    const state = room.interactionState;
    return hand && state && state.matchId === match.id && state.handNo === hand.handNo
      ? clone(state)
      : { matchId:match && match.id, handNo:hand && hand.handNo, counts:{}, events:[] };
  }

  async history(user) {
    return this.store.historyFor(user.id);
  }

  async exportMatch(user, id) {
    let match = await this.store.getArchivedMatch(id);
    if (!match) {
      const room = await this.store.findRoomByMatch(id);
      if (room && room.match && room.match.id === id) match = room.match;
    }
    requireTrue(match && match.seats.some(seat => seat.playerId === user.id), 403, '你无权访问此牌谱，或牌谱不存在');
    const active = match.status === 'active';
    if (!active) requireTrue(await this.store.retained(user.id, id), 404, '此牌谱已超出你的保存范围');
    const hands = match.hands.filter(hand => hand.phase === 'finished');
    requireTrue(hands.length > 0, 409, '暂时没有已结束的小局可供查看');
    const result = clone(match);
    delete result.roomCode;
    result.hands = clone(hands);
    result.scores = hands[hands.length - 1].scores.slice();
    return result;
  }
}

module.exports = { CloudService, HttpError, MAX_HANDS_PER_MATCH, requireTrue };
