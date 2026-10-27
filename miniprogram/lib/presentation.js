'use strict';

const {tile,typeOf}=require('./tiles');
const {arrangeHand,decisionLayout,withDiscardGaps,settlementLayout,streakBadge,meldLayout}=require('./layout');
const cosmetics=require('./cosmetics');
const cloudAssets=require('./cloud-assets');
const labels={ack:'确认牌山',win:'自摸胡牌',pon:'碰',exposedKong:'明杠',concealedKong:'暗杠',addedKong:'补杠',float:'飘癞子',pass:'过',black:'黑摸',wildcard:'带癞自摸',jiahei:'夹黑',draw:'流局',deal:'发牌',discard:'出牌',response:'碰杠响应',payment:'结算',drawHand:'流局'};
const points=units=>(units>0?'+':'')+(units/2);
const assetUrl=cloudAssets.assetUrl;

function characterView(id,seat) {
  const character=cosmetics.character(id,seat);
  return {...character,sheetUrl:assetUrl(character.sheet)};
}

function tiles(ids,wildcard,prefix,lastDraw) {
  return ids.map((id,index)=>({...tile(id),key:prefix+'_'+(id===null?index:id),wild:id!==null&&typeOf(id)===wildcard,last:id!==null&&id===lastDraw}));
}

function meldViews(player,seat,wildcard) {
  return player.melds.map((meld,index)=>{
    const view=meldLayout(meld,seat);
    return {
      key:'m'+seat+'_'+index,kind:meld.kind,label:labels[meld.kind],from:meld.from,relative:view.relative,source:view.source,
      tiles:view.tiles.map((slot,tileIndex)=>({
        ...tile(slot.id),key:'m'+seat+'_'+index+'_'+tileIndex,
        wild:slot.id!==null&&typeOf(slot.id)===wildcard,faceDown:Boolean(slot.faceDown),called:Boolean(slot.called),addedId:slot.addedId,
      })),
    };
  });
}

function emoteFace(emotion,character) {
  return emotion.emoji?emotion:{...emotion,sheet:assetUrl(character.sheet),x:-(emotion.frame%3)*100,y:-Math.floor(emotion.frame/3)*100};
}

function tableView(room, options={}) {
  if(!room||!room.match) return null;
  const hand=room.match.hand;
  const local=room.seat;
  const positions=['bottom','right','top','left'];
  const players=hand.players.map((player,seat)=>{
    const character=characterView(room.characters&&room.characters[seat],seat);
    const sent=room.emotes&&room.emotes[seat],emotion=sent&&cosmetics.emotion(sent.emote);
    const raw=player.hand.slice();
    let ids=raw;
    let separatedDraw=null;
    if(seat===local) {
      const latest=raw.includes(hand.lastDraw)?hand.lastDraw:null;
      ids=arrangeHand(raw,hand.wildcardType,latest,options.sortEnabled!==false,options.handOrder||[]);
      separatedDraw=latest;
    }
    const faces=tiles(ids,hand.wildcardType,'h'+seat,separatedDraw);
    if(seat!==local&&hand.drawSeat===seat&&faces.length)faces[faces.length-1].last=true;
    return {
      seat,position:positions[(seat-local+4)%4],name:room.match.seats[seat].name,character,avatar:emoteFace({frame:0},character),
      emote:emotion&&Date.parse(sent.expiresAt)>Date.now()?emoteFace(emotion,cosmetics.character(sent.character)):null,
      score:points(hand.scores[seat]),floats:hand.floats[seat],dealer:seat===hand.dealerSeat,acting:seat===hand.actor&&hand.phase==='own',online:room.seats[seat]&&room.seats[seat].online,
      hand:withDiscardGaps(faces,(options.discardGaps||[]).filter(gap=>gap.seat===seat)),
      melds:meldViews(player,seat,hand.wildcardType),
      discards:player.discards.map((discard,index)=>({...tile(discard.id),key:'d'+seat+'_'+index,claimed:discard.claimed,tsumogiri:discard.tsumogiri})),
      floated:tiles(player.floated,hand.wildcardType,'f'+seat),
    };
  });
  const actions=hand.actions||[];
  const payments=hand.payments.map((p,index)=>({key:'p'+index,kind:p.kind,text:room.match.seats[p.payer].name+' → '+room.match.seats[p.recipient].name+' '+p.amount/2+' 分 · '+(labels[p.kind]||'结算')+'（双方已飘 '+p.counts.join('/')+' 张）'}));
  const controls=room.controls||{};
  const calls=actions.filter(a=>!controls.skipCalls&&['pon','exposedKong','concealedKong','addedKong','pass'].includes(a.kind)).map(a=>({...a,label:labels[a.kind]+(a.type===undefined?'':'：'+tile(a.type*4).name)}));
  const decisions=actions.filter(a=>a.kind==='win').map(a=>({...a,label:labels.win})).concat(calls).map((action,index)=>{
    const view=decisionLayout(action,hand.lastDraw);
    return {...action,...view,preview:tiles(view.preview,hand.wildcardType,'choice'+index)};
  }).sort((a,b)=>a.priority-b.priority);
  const settled=settlementLayout(hand);
  const settlementPlayers=settled&&settled.map(row=>({
    ...row,name:players[row.seat].name,hand:tiles(row.hand,hand.wildcardType,'result'+row.seat),floated:players[row.seat].floated,
    melds:hand.players[row.seat].melds.map((meld,index)=>({key:'result_m'+row.seat+'_'+index,label:labels[meld.kind],tiles:tiles(meld.tiles,hand.wildcardType,'result_m'+row.seat+'_'+index)})),
  }));
  return {
    players,opponents:players.filter(p=>p.seat!==local),self:players[local],
    emoteChoices:cosmetics.emotions.map(emotion=>emoteFace(emotion,players[local].character)),commonEmotes:cosmetics.commonEmotions,readyCount:(room.ready||[]).filter(Boolean).length,
    interactionChoices:cosmetics.interactions,interactionTargets:players.filter(player=>player.seat!==local&&room.seats[player.seat]).map(player=>({seat:player.seat,name:room.seats[player.seat].name})),interactionLimit:cosmetics.interactionLimit,interactionRemaining:room.interactionRemaining===undefined?cosmetics.interactionLimit:room.interactionRemaining,canInteract:hand.phase!=='commit',
    indicator:{...tile(hand.indicatorId),last:false,wild:false},wildcard:{...tile(hand.wildcardType*4),last:false,wild:true},
    controls,decisions,rules:{version:hand.rulesVersion},
    payments,eventPayments:payments.filter(p=>['float','addedKong','exposedKong','concealedKong'].includes(p.kind)),winPayments:payments.filter(p=>['wildcard','black','jiahei'].includes(p.kind)),
    result:settled?{label:hand.result.kind==='draw'?'流局':room.match.seats[hand.result.winner].name+' · '+labels[hand.result.classification],complete:room.match.status==='complete',streak:streakBadge(room.match.winStreak&&room.match.winStreak.count),scores:settlementPlayers}:null,
    status:hand.phase==='commit'?'正在确认牌山 '+hand.acknowledgements.filter(Boolean).length+' / 4':hand.phase==='responses'?'等待碰杠响应':hand.phase==='finished'?'本局结束':'轮到 '+players[hand.actor].name+' 操作',
  };
}

module.exports={labels,points,tableView,characterView,emoteFace};
