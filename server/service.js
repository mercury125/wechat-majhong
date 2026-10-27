'use strict';

const { randomBytes, randomUUID, randomInt, createHash } = require('node:crypto');
const { EventEmitter } = require('node:events');
const { createHand, act, publicHand, clone, isActionId } = require('../miniprogram/lib/engine');
const { RULES_VERSION, SHUFFLE_VERSION } = require('../miniprogram/lib/shuffle');
const { canonical } = require('../miniprogram/lib/replay');
const cosmetics = require('../miniprogram/lib/cosmetics');
const {botAction,automaticAction}=require('./bots');

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const requireTrue = (condition, status, message) => { if (!condition) throw new HttpError(status, message); };
const digest = token => createHash('sha256').update(token).digest('hex');
function positive(value, label) {
  requireTrue(Number.isInteger(value) && value > 0 && value <= 0xffffffff,400,label + '必须是 1–4294967295 之间的整数');
  return value;
}
function nameValue(value) {
  requireTrue(typeof value === 'string' && value.trim().length > 0 && Array.from(value.trim()).length <= 32 && !/[\x00-\x1f\x7f]/.test(value),400,'昵称须包含 1–32 个可显示字符');
  return value.trim();
}

const COMMAND_KEYS = ['id','kind','tile','type','code','seat','handsPerMatch','ready','matchId','handNo'];
const ROOM_COMMANDS = new Set(['sit','leave','ready','settings']);
const RECEIPT_LIMIT = 4096;
const CALL_KINDS = new Set(['pon','exposedKong','concealedKong','addedKong']);
const CALL_NOTICE_LABELS = { pon:'碰', exposedKong:'明杠', concealedKong:'暗杠', addedKong:'补杠', win:'胡' };

class Service {
  constructor(store, options = {}) {
    this.store = store;
    this.clock = options.clock || (()=>new Date().toISOString());
    this.seed = options.seed || (()=>randomBytes(32).toString('hex'));
    this.dealer = options.dealer || (()=>randomInt(4));
    this.changes = new EventEmitter();
    this.changes.setMaxListeners(100);
    this.presence = new Map();
  }

  login(identity, name) {
    const nickname = name === undefined ? undefined : nameValue(name);
    const token = randomBytes(32).toString('base64url');
    const user = this.store.transaction(()=>{
      let user = this.store.identity(identity);
      if (!user) {
        user = {id:randomUUID(),identity,name:nickname || '牌友',history_limit:1000};
        this.store.db.prepare('INSERT INTO users(id,identity,name) VALUES(?,?,?)').run(user.id,identity,user.name);
      } else if (nickname !== undefined && nickname !== user.name) {
        this.store.db.prepare('UPDATE users SET name=? WHERE id=?').run(nickname,user.id);
        user = {...user,name:nickname};
      }
      this.store.db.prepare('DELETE FROM sessions WHERE expires_at<?').run(Date.now());
      this.store.db.prepare('INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(?,?,?)').run(digest(token),user.id,Date.now()+30*86400000);
      return user;
    });
    return {token,user:this.profile(user)};
  }

  authenticate(token) {
    requireTrue(typeof token === 'string' && token.length >= 32 && token.length <= 128,401,'请先登录');
    const session = this.store.db.prepare('SELECT user_id FROM sessions WHERE token_hash=? AND expires_at>?').get(digest(token),Date.now());
    requireTrue(session,401,'登录已过期，请重新登录');
    this.presence.set(session.user_id,Date.now());
    return this.store.user(session.user_id);
  }

  logout(token) { this.store.db.prepare('DELETE FROM sessions WHERE token_hash=?').run(digest(token)); }

  profile(user) { return {id:user.id,name:user.name,historyMatchLimit:user.history_limit}; }

  updateProfile(user, body) {
    const name = body.name === undefined ? user.name : nameValue(body.name);
    const limit = body.historyMatchLimit === undefined ? user.history_limit : positive(body.historyMatchLimit,'牌谱保存场数');
    const count = this.store.db.prepare('SELECT COUNT(*) AS n FROM history WHERE user_id=?').get(user.id).n;
    requireTrue(limit >= count || body.confirmPrune === true,409,'降低上限将移除 ' + (count-limit) + ' 场历史对局，请确认后继续');
    return this.store.transaction(()=>{
      this.store.db.prepare('UPDATE users SET name=?,history_limit=? WHERE id=?').run(name,limit,user.id);
      this.store.prune(user.id,limit);
      return this.profile(this.store.user(user.id));
    });
  }

  room(code) {
    requireTrue(typeof code === 'string' && /^[A-Z0-9]{8}$/.test(code),404,'房间不存在，请检查房间号');
    const room = this.store.room(code);
    requireTrue(room,404,'房间不存在，请检查房间号');
    return room;
  }

  member(room, user) {
    const seat = room.seats.indexOf(user.id);
    requireTrue(seat >= 0,403,'只有本房间的入座玩家才能访问');
    return seat;
  }

  activeRoom(user) {
    return this.store.rooms().find(room=>room.seats.includes(user.id) && room.matchId && this.store.match(room.matchId)?.status==='active');
  }

  playerControls(room,id) { return {autoWin:false,skipCalls:false,autoCut:false,...room.controls?.[id]}; }

  setControls(user,code,input) {
    const room=this.room(code);this.member(room,user);
    const keys=input&&typeof input==='object'&&!Array.isArray(input)?Object.keys(input):[];
    const preferences=keys.filter(key=>!['matchId','handNo'].includes(key));
    requireTrue(preferences.length>0&&preferences.every(key=>['autoWin','skipCalls','autoCut'].includes(key)&&typeof input[key]==='boolean'),400,'自动操作设置无效');
    const match=room.matchId&&this.store.match(room.matchId),hand=match&&match.hands[match.hands.length-1],wasComplete=match&&match.status==='complete';
    if(keys.some(key=>['matchId','handNo'].includes(key)))requireTrue(hand&&hand.phase!=='finished'&&input.matchId===match.id&&input.handNo===hand.handNo,409,'牌局已更新，请在当前小局重新设置');
    const previous=this.playerControls(room,user.id);
    if(preferences.every(key=>previous[key]===input[key]))return this.view(room,user);
    if(!room.controls)room.controls={};room.controls[user.id]={...previous,...Object.fromEntries(preferences.map(key=>[key,input[key]]))};
    this.advanceAutomatic(room,match);
    room.revision++;
    this.saveCommand(room,match,wasComplete);
    return this.view(room,user);
  }

  view(room, user) {
    const seat = this.member(room,user);
    const now=Date.parse(this.clock());
    const storedMatch = room.matchId && this.store.match(room.matchId);
    const match = storedMatch && storedMatch.seats.some(participant=>participant.playerId===user.id) ? storedMatch : null;
    const controls=this.playerControls(room,user.id),hand=match&&publicHand(match.hands[match.hands.length-1],seat);
    const interactionState=this.interactionState(room,match);
    if(hand&&controls.skipCalls)hand.actions=hand.actions.filter(action=>!CALL_KINDS.has(action.kind));
    return {
      code:room.code,ownerId:room.ownerId,seat,revision:room.revision,ready:room.ready,settings:room.settings,matchId:room.matchId,testMode:room.testMode===true,
      controls,
      characters:room.seats.map((_,i)=>cosmetics.character(room.characters?.[i],i).id),
      emotes:room.seats.map((_,i)=>room.emotes?.[i]&&Date.parse(room.emotes[i].expiresAt)>now?room.emotes[i]:null),
      interactions:interactionState.events.filter(event=>Date.parse(event.expiresAt)>now),
      callNotices:(room.callNotices||[]).filter(notice=>Date.parse(notice.expiresAt)>now).map(clone),
      interactionRemaining:cosmetics.interactionLimit-(interactionState.counts[user.id]||0),
      seats:room.seats.map(id=>id?{id,name:this.store.user(id).name,bot:!!room.bots?.includes(id),online:!!room.bots?.includes(id)||Date.now()-(this.presence.get(id)||0)<45000}:null),
      match:match?{id:match.id,status:match.status,settings:match.settings,seats:match.seats,scores:match.scores,continueReady:match.continueReady,winStreak:this.winStreak(match),hand}:null,
    };
  }

  winStreak(match){
    const last=match.hands[match.hands.length-1];
    if(last.phase!=='finished'||last.result?.kind!=='win')return null;
    const seat=last.result.winner;let count=0;
    for(let index=match.hands.length-1;index>=0;index--){const result=match.hands[index].result;if(!result||result.kind!=='win'||result.winner!==seat)break;count++;}
    return {seat,count};
  }

  myRooms(user) { return this.store.rooms().filter(room=>room.seats.includes(user.id)).map(room=>({code:room.code,testMode:room.testMode===true,active:!!(room.matchId&&this.store.match(room.matchId)?.status==='active')})); }

  createRoom(user, body = {}) {
    requireTrue(!this.activeRoom(user),409,'请先重连当前对局，再创建其他房间');
    requireTrue(body.testMode===undefined||typeof body.testMode==='boolean',400,'测试模式设置无效');
    let code;
    do { code = randomBytes(5).toString('hex').slice(0,8).toUpperCase(); } while(this.store.room(code));
    const room = {code,ownerId:user.id,seats:[user.id,null,null,null],ready:[false,false,false,false],characters:cosmetics.defaults.slice(),emotes:[null,null,null,null],settings:{handsPerMatch:positive(body.handsPerMatch===undefined?8:body.handsPerMatch,'每场局数')},matchId:null,revision:1,receipts:[],testMode:body.testMode===true,bots:[]};
    this.store.transaction(()=>{
      if(room.testMode){
        for(let seat=1;seat<4;seat++){
          const id=randomUUID();
          this.store.db.prepare('INSERT INTO users(id,identity,name) VALUES(?,?,?)').run(id,'bot:'+code+':'+seat,'机器人'+'一二三'[seat-1]+'号');
          room.seats[seat]=id;room.bots.push(id);
        }
        this.advanceAutomatic(room,null);
      }
      this.store.saveRoom(room);
    });
    return this.view(room,user);
  }

  receipt(room, userId, id) {
    return (room.receipts || []).find(receipt=>receipt.userId===userId&&receipt.id===id);
  }

  recordReceipt(room, userId, id, fingerprint) {
    room.revision++;
    room.receipts.push({userId,id,fingerprint,revision:room.revision});
    // Retries older than this window still fail their stale revision.
    room.receipts=room.receipts.slice(-RECEIPT_LIMIT);
  }

  saveCommand(room, match, wasComplete) {
    this.store.transaction(()=>{
      if (match) this.store.saveMatch(match);
      this.store.saveRoom(room);
      if (match&&match.status==='complete'&&!wasComplete) {
        const participants=room.testMode?match.seats.filter(participant=>participant.playerId===room.ownerId):match.seats;
        for(const participant of participants) this.store.db.prepare('INSERT OR IGNORE INTO history(user_id,match_id) VALUES(?,?)').run(participant.playerId,match.id);
        for(const participant of participants) this.store.prune(participant.playerId,this.store.user(participant.playerId).history_limit);
      }
    });
    this.changes.emit(room.code);
  }

  social(user,code,kind,input={}) {
    const room=this.room(code),seat=this.member(room,user);
    room.characters=room.seats.map((_,i)=>cosmetics.character(room.characters?.[i],i).id);
    room.emotes=room.emotes||[null,null,null,null];
    if(kind==='appearance') {
      requireTrue(cosmetics.characters.some(item=>item.id===input.character),400,'请选择有效角色');
      if(room.characters[seat]===input.character) return this.view(room,user);
      room.characters[seat]=input.character;
      room.revision++;
    } else if(kind==='interactions') {
      requireTrue(cosmetics.interactions.some(effect=>effect.id===input.effect),400,'请选择有效互动道具');
      requireTrue(isActionId(input.id),400,'互动编号无效');
      requireTrue(Number.isInteger(input.target)&&input.target>=0&&input.target<4&&input.target!==seat,400,'请选择其他玩家作为互动对象');
      const fingerprint=canonical({id:input.id,kind:'interaction',effect:input.effect,target:input.target,matchId:input.matchId,handNo:input.handNo});
      const prior=this.receipt(room,user.id,input.id);
      if(prior){requireTrue(prior.fingerprint===fingerprint,409,'该操作编号已用于其他内容');return this.view(room,user);}
      const match=room.matchId&&this.store.match(room.matchId),hand=match&&match.hands[match.hands.length-1];
      requireTrue(hand&&hand.phase!=='commit',409,'发牌后才能使用互动道具');
      requireTrue(match.seats.some(player=>player.playerId===user.id),403,'仅本局玩家可使用互动道具');
      requireTrue(input.matchId===match.id&&input.handNo===hand.handNo,409,'牌局已更新，请重新选择互动');
      requireTrue(room.seats[input.target],400,'该玩家已离开房间');
      const state=this.interactionState(room,match),duplicate=state.events.find(event=>event.playerId===user.id&&event.id===input.id);
      if(duplicate){requireTrue(duplicate.effect===input.effect&&duplicate.target===input.target,409,'该操作编号已用于其他内容');return this.view(room,user);}
      requireTrue((state.counts[user.id]||0)<cosmetics.interactionLimit,429,'本局互动次数已用完，每局最多 '+cosmetics.interactionLimit+' 次');
      const now=Date.parse(this.clock());
      state.counts[user.id]=(state.counts[user.id]||0)+1;
      state.events.push({id:input.id,playerId:user.id,from:seat,target:input.target,effect:input.effect,matchId:match.id,handNo:hand.handNo,sentAt:new Date(now).toISOString(),expiresAt:new Date(now+cosmetics.interactionLifetime).toISOString()});
      room.interactionState=state;
      this.recordReceipt(room,user.id,input.id,fingerprint);
    } else {
      requireTrue(kind==='emotes'&&cosmetics.emotion(input.emote),400,'请选择有效表情');
      requireTrue(isActionId(input.id),400,'表情编号无效');
      const fingerprint=canonical({id:input.id,kind:'emote',emote:input.emote});
      const prior=this.receipt(room,user.id,input.id);
      if(prior) {
        requireTrue(prior.fingerprint===fingerprint,409,'该操作编号已用于其他内容');
        return this.view(room,user);
      }
      const now=Date.parse(this.clock()),previous=room.emotes[seat];
      requireTrue(!previous||now-Date.parse(previous.sentAt)>=cosmetics.emoteCooldown,429,'每三秒只能发送一次表情');
      room.emotes[seat]={id:input.id,emote:input.emote,character:room.characters[seat],sentAt:new Date(now).toISOString(),expiresAt:new Date(now+cosmetics.emoteLifetime).toISOString()};
      this.recordReceipt(room,user.id,input.id,fingerprint);
    }
    this.store.saveRoom(room);
    this.changes.emit(code);
    return this.view(room,user);
  }

  interactionState(room,match) {
    const hand=match&&match.hands[match.hands.length-1],state=room.interactionState;
    return hand&&state&&state.matchId===match.id&&state.handNo===hand.handNo?clone(state):{matchId:match&&match.id,handNo:hand&&hand.handNo,counts:{},events:[]};
  }

  startMatch(room) {
    for(const id of room.seats) {
      const other=this.activeRoom({id});
      requireTrue(!other,409,'有玩家正在其他对局中');
    }
    const id=randomUUID();const at=this.clock();
    const match={schemaVersion:1,id,roomCode:room.code,testMode:room.testMode===true,settings:clone(room.settings),rulesVersion:RULES_VERSION,shuffleVersion:SHUFFLE_VERSION,seats:room.seats.map(id=>({playerId:id,name:this.store.user(id).name})),status:'active',startedAt:at,endedAt:null,scores:[0,0,0,0],continueReady:[false,false,false,false],hands:[createHand({matchId:id,handNo:1,dealerSeat:this.dealer(),seedHex:this.seed(),startedAt:at})]};
    room.matchId=id;room.ready=[false,false,false,false];room.controls={};room.callNotices=[];
    return match;
  }

  roomCommand(user, room, input, seat) {
    if(input.kind==='sit') {
      requireTrue(Number.isInteger(input.seat)&&input.seat>=0&&input.seat<4&&room.seats[input.seat]===null,409,'请选择空座位');
      room.seats[seat]=null;room.ready[seat]=false;room.seats[input.seat]=user.id;room.ready[input.seat]=false;
      if(room.characters){room.characters[input.seat]=room.characters[seat];room.characters[seat]=cosmetics.defaults[seat];}
      if(room.emotes){room.emotes[seat]=null;room.emotes[input.seat]=null;}
      return null;
    }
    if(input.kind==='leave') {
      room.seats[seat]=null;room.ready[seat]=false;
      if(room.characters)room.characters[seat]=cosmetics.defaults[seat];
      if(room.emotes)room.emotes[seat]=null;
      if(room.ownerId===user.id) room.ownerId=room.seats.find(Boolean)||null;
      return null;
    }
    if(input.kind==='ready') {
      requireTrue(typeof input.ready==='boolean',400,'准备状态无效');
      room.ready[seat]=input.ready;
      // The last ready player starts the match immediately; no owner start step.
      if(input.ready&&room.seats.every(Boolean)&&room.ready.every(Boolean)) return this.startMatch(room);
      return null;
    }
    if(input.kind==='settings') {
      requireTrue(room.ownerId===user.id,403,'只有房主可以修改每场局数');
      room.settings.handsPerMatch=positive(input.handsPerMatch,'每场局数');room.ready=[false,false,false,false];
      return null;
    }
  }

  gameCommand(room, match, seat, input) {
    const hand=match.hands[match.hands.length-1];
    requireTrue(match.rulesVersion===RULES_VERSION&&hand.rulesVersion===RULES_VERSION,409,'此对局使用了已停止支持的规则版本');
    requireTrue(input.matchId===match.id&&input.handNo===hand.handNo,409,'操作指向已过期的对局或小局');
    if(input.kind==='continue') {
      requireTrue(hand.phase==='finished',409,'本局尚未结束');
      requireTrue(!match.continueReady[seat],409,'你已准备进入下一局');
      match.continueReady[seat]=true;
      if(match.continueReady.every(Boolean)) {
        room.controls={};room.callNotices=[];
        const dealer=hand.result.kind==='win'?hand.result.winner:hand.dealerSeat;
        match.hands.push(createHand({matchId:match.id,handNo:hand.handNo+1,dealerSeat:dealer,rulesVersion:match.rulesVersion,seedHex:this.seed(),scores:match.scores,startedAt:this.clock()}));
        match.continueReady=[false,false,false,false];
      }
      return match;
    }
    const action={id:input.id,kind:input.kind};
    for(const key of ['tile','type','code']) if(input[key]!==undefined) action[key]=input[key];
    try { match.hands[match.hands.length-1]=act(hand,seat,action,this.clock()); }
    catch(error) { throw new HttpError(400,error.message); }
    const updated=match.hands[match.hands.length-1];
    for(const event of updated.events.slice(hand.events.length)){
      const label=CALL_NOTICE_LABELS[event.kind];
      if(!label)continue;
      const now=Date.parse(this.clock());
      room.callNotices=(room.callNotices||[]).filter(notice=>Date.parse(notice.expiresAt)>now);
      room.callNotices.push({id:match.id+':'+updated.handNo+':'+event.seq,seat:event.seat,kind:event.kind,label,expiresAt:new Date(now+1500).toISOString()});
    }
    if(updated.phase==='finished')room.controls={};
    match.scores=updated.scores.slice();
    if(updated.phase==='finished'&&match.hands.length===match.settings.handsPerMatch) {match.status='complete';match.endedAt=this.clock();}
    return match;
  }

  advanceAutomatic(room,match) {
    while(true){
      if(!match||match.status==='complete'){
        for(let seat=0;seat<4;seat++)if(room.bots?.includes(room.seats[seat]))room.ready[seat]=true;
        return;
      }
      const hand=match.hands[match.hands.length-1];let choice;
      for(let seat=0;seat<4;seat++){
        const id=room.seats[seat];if(!id)continue;
        const bot=room.bots?.includes(id);
        const action=hand.phase==='finished'?(bot&&!match.continueReady[seat]?{kind:'continue'}:null):
          bot?botAction(hand,seat):automaticAction(hand,seat,this.playerControls(room,id));
        if(action){choice={seat,action,bot};break;}
      }
      if(!choice)return;
      this.gameCommand(room,match,choice.seat,{...choice.action,id:(choice.bot?'bot_':'auto_')+randomUUID(),matchId:match.id,handNo:hand.handNo});
    }
  }

  command(user, code, input) {
    const room = this.room(code);
    requireTrue(input && isActionId(input.id),400,'操作编号无效');
    const normalized = {};
    for (const key of COMMAND_KEYS) if (input[key]!==undefined) normalized[key]=input[key];
    const fingerprint = canonical(normalized);
    const prior = this.receipt(room,user.id,input.id);
    if (prior) {
      requireTrue(prior.fingerprint===fingerprint,409,'该操作编号已用于其他内容');
      if(input.kind==='leave') return {left:true,code};
      return this.view(room,user);
    }
    // Acknowledgements are safe to apply against an older room revision: every
    // client sees the same commit and must be able to acknowledge concurrently.
    const acknowledging = input.kind === 'ack';
    // Readiness may race with other players, but cannot cross a match or settings change.
    const preparing = input.kind==='ready'&&input.handsPerMatch===room.settings.handsPerMatch&&
      (input.matchId===undefined?null:input.matchId)===room.matchId&&
      Number.isInteger(input.expectedRevision)&&input.expectedRevision>0&&input.expectedRevision<=room.revision;
    requireTrue(acknowledging || preparing || Number.isInteger(input.expectedRevision)&&input.expectedRevision===room.revision,409,'牌桌状态已更新，请刷新后重试');
    let match = room.matchId && this.store.match(room.matchId);
    const wasComplete = match && match.status==='complete';
    const active = match && match.status==='active';
    let seat = room.seats.indexOf(user.id);
    if(input.kind==='join') {
      requireTrue(!room.testMode||room.ownerId===user.id,403,'单人测试房间不允许其他玩家加入');
      requireTrue(!active,409,'本场对局已经开始');
      requireTrue(!this.activeRoom(user),409,'请先重连当前对局');
      if(seat<0) {
        const desired=input.seat===undefined?room.seats.indexOf(null):input.seat;
        requireTrue(Number.isInteger(desired)&&desired>=0&&desired<4&&room.seats[desired]===null,409,'该座位已有人，或房间已满');
        room.seats[desired]=user.id;room.ready[desired]=false;seat=desired;
        if(!room.ownerId)room.ownerId=user.id;
      }
    } else {
      seat=this.member(room,user);
      if(input.kind==='leave'&&room.testMode){
        room.seats=[null,null,null,null];room.ready=[false,false,false,false];room.bots=[];room.ownerId=null;room.matchId=null;
        this.recordReceipt(room,user.id,input.id,fingerprint);
        this.store.transaction(()=>{
          if(active)this.store.db.prepare('DELETE FROM matches WHERE id=?').run(match.id);
          this.store.saveRoom(room);
        });
        this.changes.emit(room.code);
        return {left:true,code};
      }
      if(ROOM_COMMANDS.has(input.kind)) {
        requireTrue(!active,409,'对局进行中不能修改房间设置或座位');
        match=this.roomCommand(user,room,input,seat)||match;
      } else {
        requireTrue(active,409,'当前没有正在进行的对局');
        requireTrue(!this.playerControls(room,user.id).skipCalls||!CALL_KINDS.has(input.kind),400,'已开启免鸣，请先关闭“鸣”再碰杠');
        match=this.gameCommand(room,match,seat,input);
      }
    }
    this.advanceAutomatic(room,match);
    this.recordReceipt(room,user.id,input.id,fingerprint);
    this.saveCommand(room,match,wasComplete);
    return input.kind==='leave'?{left:true,code}:this.view(room,user);
  }

  join(user, code, input={}) {
    const room=this.room(code);
    if(room.seats.includes(user.id)&&room.matchId&&this.store.match(room.matchId)?.status==='active')return this.view(room,user);
    return this.command(user,code,{...input,id:input.id||randomUUID(),kind:'join',expectedRevision:input.expectedRevision===undefined?room.revision:input.expectedRevision});
  }

  history(user) {
    return this.store.history(user.id).map(match=>({id:match.id,testMode:match.testMode===true,startedAt:match.startedAt,endedAt:match.endedAt,seats:match.seats,hands:match.hands.length,handsPerMatch:match.settings.handsPerMatch,scores:match.scores,status:match.status}));
  }

  exportMatch(user, id) {
    const match=this.store.match(id);
    requireTrue(match&&match.seats.some(seat=>seat.playerId===user.id),403,'你无权访问此牌谱，或牌谱不存在');
    requireTrue(match.status==='active'||this.store.retained(user.id,id),404,'此牌谱已超出你的保存范围');
    const hands=match.hands.filter(hand=>hand.phase==='finished');
    requireTrue(hands.length>0,409,'暂时没有已结束的小局可供查看');
    const result=clone(match);
    delete result.roomCode;
    result.hands=clone(hands);result.scores=hands[hands.length-1].scores.slice();
    return result;
  }
}

module.exports={Service,HttpError};
