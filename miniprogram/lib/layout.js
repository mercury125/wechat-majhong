'use strict';
(function(root) {
  const DISCARD_GAP_MS=480;
  function oppositeAvatarLayout(table,hand,seat,avatar){
    if(![table,hand,seat,avatar].every(rect=>rect&&rect.width>0&&rect.height>0))return null;
    const iconLeft=Math.min(hand.right-table.left+12,table.width-avatar.width-8);
    const left=iconLeft-(seat.width-avatar.width)/2,top=Math.max(0,hand.bottom-table.top-avatar.height);
    return {style:'left:'+left+'px;top:'+top+'px;transform:none;',rect:{left:table.left+iconLeft,top:table.top+top,width:avatar.width,height:avatar.height}};
  }
  function arrangeHand(ids,wildcard,lastDraw,sortEnabled=true,manualOrder=[]) {
    const drawn=lastDraw!==null&&lastDraw!==undefined&&ids.includes(lastDraw)?lastDraw:null;
    const hand=ids.filter(id=>id!==drawn);
    let ordered;
    if(sortEnabled)ordered=hand.sort((a,b)=>(Math.floor(b/4)===wildcard)-(Math.floor(a/4)===wildcard)||a-b);
    else {
      const known=manualOrder.filter(id=>hand.includes(id));
      ordered=known.concat(hand.filter(id=>!known.includes(id)));
    }
    if(drawn!==null)ordered.push(drawn);
    return ordered;
  }
  function meldLayout(meld,seat) {
    const concealed=meld.kind==='concealedKong';
    const relative=Number.isInteger(meld.from)&&meld.from>=0&&meld.from<4?(meld.from-seat+4)%4:null;
    const added=meld.kind==='addedKong'&&relative>0;
    const tiles=meld.tiles.slice(0,added?3:meld.tiles.length).map((id,index)=>({id,called:false,faceDown:concealed&&(index===0||index===3)}));
    if(!concealed&&relative>0&&tiles.length) {
      const called=tiles.pop();called.called=true;
      const slot=relative===3?0:relative===2?1:tiles.length;
      if(added)called.addedId=meld.tiles[3];
      tiles.splice(slot,0,called);
    }
    return {tiles,relative,source:concealed?'自己':({1:'下家',2:'对家',3:'上家'}[relative]||'来源未知')};
  }
  function decisionLayout(action,lastDraw) {
    const kong=['exposedKong','concealedKong','addedKong'].includes(action.kind);
    const variant=action.kind==='win'?'win':kong?'kong':action.kind==='pon'?'pon':'pass';
    let preview=[];
    if((kong||action.kind==='pon')&&Number.isInteger(action.type)&&action.type>=0&&action.type<27)preview=Array.from({length:kong?4:3},(_,i)=>action.type*4+i);
    else if(action.kind==='win'&&Number.isInteger(lastDraw)&&lastDraw>=0&&lastDraw<108)preview=[lastDraw];
    return {glyph:{win:'胡',kong:'杠',pon:'碰',pass:'过'}[variant],variant,priority:{win:0,kong:1,pon:2,pass:3}[variant],preview};
  }
  function discardTransitions(previous,next,seat,sortEnabled=true,manualOrder=[]) {
    if(!previous||!next||previous.matchId!==next.matchId||previous.handNo!==next.handNo||!previous.discardEvents)return [];
    const seen=previous.discardEvents.length?previous.discardEvents[previous.discardEvents.length-1].seq:0;
    return (next.discardEvents||[]).filter(event=>event.seq>seen).map(event=>{
      const count=Math.max(1,event.handCount-Number(event.hadDraw));
      // A cosmetic slot gives concealed hands a consistent motion without exposing their order.
      let sourceIndex=event.tsumogiri?event.handCount-1:(Math.imul(event.seq,2654435761)>>>0)%count;
      if(event.seat===seat&&previous.actor===seat&&previous.players[seat].hand.includes(event.tileId))sourceIndex=arrangeHand(previous.players[seat].hand,previous.wildcardType,previous.lastDraw,sortEnabled,manualOrder).indexOf(event.tileId);
      return {...event,sourceIndex};
    });
  }
  function withDiscardGaps(hand,gaps,now=Date.now()) {
    const slots=hand.map((face,index)=>({...face,handIndex:index}));
    const active=gaps.filter(gap=>now<gap.startedAt+DISCARD_GAP_MS).slice().sort((a,b)=>b.sourceIndex-a.sourceIndex);
    for(const gap of active){
      const index=Math.max(0,Math.min(gap.sourceIndex,hand.length));
      const delay=gap.delay===undefined?gap.startedAt-now:gap.delay;
      slots.splice(index,0,{gap:true,key:'gap'+gap.seq,style:'animation-delay:'+Math.round(delay)+'ms'});
    }
    return slots;
  }
  function interactionLayout(event,source,target,now=Date.now()) {
    const remaining=Date.parse(event.expiresAt)-now;
    if(!source||!target||!(source.width>0&&source.height>0&&target.width>0&&target.height>0)||remaining<=0)return null;
    const x=source.left+source.width/2,y=source.top+source.height/2;
    const dx=target.left+target.width/2-x,dy=target.top+target.height/2-y;
    const bucketX=target.left<target.width?26:-26,lift=Math.min(54,target.top+target.height/2-42),side=Math.max(target.width,target.height);
    const pieces=Array.from({length:8},(_,index)=>{
      const angle=index*Math.PI/4,x=Math.round(Math.cos(angle)*64),y=Math.round(Math.sin(angle)*54),turn=index*63-130;
      return {key:index,x,y,turn,style:'--burst-x:'+x+'px;--burst-y:'+y+'px;--turn:'+turn+'deg'};
    });
    return {key:event.playerId+':'+event.id,effect:event.effect,x,y,side,remaining,pieces,dx,dy,bucketX,lift,startedAt:Date.parse(event.sentAt),expiresAt:Date.parse(event.expiresAt),style:'left:'+x+'px;top:'+y+'px;--dx:'+dx+'px;--dy:'+dy+'px;--mx:'+dx*.5+'px;--my:'+(dy*.5-65)+'px;--target-width:'+side+'px;--target-height:'+side+'px;--bucket-x:'+bucketX+'px;--pour-lift:'+lift+'px;--tip:'+(bucketX>0?-65:65)+'deg;--age:'+Math.min(0,Date.parse(event.sentAt)-now)+'ms'};
  }
  function settlementLayout(hand){
    if(!hand||hand.phase!=='finished'||!hand.result)return null;
    const points=units=>(units>0?'+':'')+units/2;
    return hand.players.map((player,seat)=>({seat,hand:player.hand.slice().sort((a,b)=>a-b),delta:points(hand.result.deltas[seat]),total:points(hand.scores[seat]),deltaUnits:hand.result.deltas[seat]}));
  }
  function streakBadge(count){
    if(!Number.isInteger(count)||count<2)return null;
    return {count,label:({2:'双连胜',3:'三连胜',4:'四连胜',5:'五连胜'}[count]||count+'连胜'),english:({2:'Double Kill',3:'Triple Kill',4:'Quadra Kill',5:'Penta Kill'}[count]||'Unstoppable'),level:Math.min(count,5)};
  }
  const api={arrangeHand,meldLayout,decisionLayout,discardTransitions,withDiscardGaps,DISCARD_GAP_MS,interactionLayout,settlementLayout,streakBadge,oppositeAvatarLayout};
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.MahjongLayout=api;
})(typeof globalThis==='object'?globalThis:this);
