'use strict';
const {createHand,conservation}=require('../miniprogram/lib/engine');
const {wallCode}=require('../miniprogram/lib/shuffle');

// Prepared legal tile partitions isolate rare transitions without changing production randomness.
function scenario(options={}) {
  const wildcard=options.wildcard===undefined?5:options.wildcard;
  const stock=new Set(Array.from({length:108},(_,i)=>i));
  const take=type=>{const id=[...stock].find(id=>Math.floor(id/4)===type);if(id===undefined)throw new Error('Fixture has too many copies of type '+type);stock.delete(id);return id;};
  const indicatorType=Math.floor(wildcard/9)*9+(wildcard%9+8)%9;
  const indicatorId=take(indicatorType);
  const hand=createHand({matchId:'prepared-scenario',handNo:1,dealerSeat:0,seedHex:'00'.repeat(32),startedAt:'2026-01-01T00:00:00.000Z'});
  const meldInputs=options.melds||[[],[],[],[]];
  hand.players=Array.from({length:4},(_,seat)=>({hand:[],melds:(meldInputs[seat]||[]).map(meld=>({kind:meld.kind,type:meld.type,tiles:Array.from({length:meld.kind==='pon'?3:4},()=>take(meld.type)),from:meld.from===undefined?seat:meld.from})),discards:[],floated:[]}));
  for(let seat=0;seat<4;seat++)hand.players[seat].hand=(options.hands&&options.hands[seat]||[]).map(take);
  for(let seat=0;seat<4;seat++){
    const target=(seat===0?14:13)-3*hand.players[seat].melds.length;
    while(hand.players[seat].hand.length<target){const id=[...stock].find(id=>Math.floor(id/4)!==wildcard);stock.delete(id);hand.players[seat].hand.push(id);}
    if(hand.players[seat].hand.length!==target)throw new Error('Invalid fixture hand size');
  }
  const count=options.remaining===undefined?10:options.remaining;
  const first=options.headType===undefined?null:take(options.headType);
  const last=options.tailType===undefined?null:take(options.tailType);
  const wall=[];
  if(first!==null)wall.push(first);
  const candidates=[...stock].sort((a,b)=>(Math.floor(b/4)===wildcard)-(Math.floor(a/4)===wildcard));
  while(wall.length<count-(last===null?0:1)){const id=candidates.shift();stock.delete(id);wall.push(id);}
  if(last!==null)wall.push(last);
  if(wall.length!==count)throw new Error('Invalid fixture wall length');
  for(const id of stock){if(Math.floor(id/4)===wildcard)hand.players[3].floated.push(id);else hand.players[3].discards.push({id,claimed:false});}
  const used=hand.players.flatMap(player=>player.hand.concat(player.melds.flatMap(meld=>meld.tiles),player.discards.map(d=>d.id),player.floated));
  hand.wall=wall.concat(used,[indicatorId]);hand.wallCode=wallCode(hand,hand.wall);
  hand.indicatorId=indicatorId;hand.wildcardType=wildcard;hand.head=0;hand.tail=count-1;hand.phase='own';hand.actor=0;hand.canWin=true;hand.acknowledgements=Array(4).fill('2026-01-01T00:00:00.000Z');
  hand.floats=hand.players.map(player=>player.floated.length);
  conservation(hand);
  return hand;
}
module.exports={scenario};
