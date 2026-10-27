'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {arrangeHand,meldLayout,decisionLayout,discardTransitions,withDiscardGaps,DISCARD_GAP_MS,interactionLayout,settlementLayout,streakBadge}=require('../miniprogram/lib/layout');
const {interactionAnimations}=require('../miniprogram/lib/interaction-animation');

test('interactions travel between player anchors and resume at the original event age',()=>{
  const event={id:'throw',playerId:'sender',effect:'water',sentAt:new Date(1000).toISOString(),expiresAt:new Date(2000).toISOString()};
  const source={left:10,top:20,width:40,height:40},target={left:200,top:100,width:40,height:40};
  const motion=interactionLayout(event,source,target,1200);
  assert.equal(motion.key,'sender:throw');assert.equal(motion.effect,'water');assert.equal(motion.remaining,800);
  assert.match(motion.style,/left:30px;top:40px/);assert.match(motion.style,/--dx:190px;--dy:80px/);assert.match(motion.style,/--age:-200ms/);
  assert.match(motion.style,/--target-width:40px;--target-height:40px/);assert.equal(motion.pieces.length,8);assert.ok(motion.pieces.every(piece=>/--burst-x:/.test(piece.style)&&!piece.style.includes('NaN')));
  assert.match(interactionLayout(event,source,{...target,top:0,height:44},1200).style,/--pour-lift:-20px/,'top avatars keep the bucket on screen');
  assert.equal(interactionLayout(event,source,target,2000),null);assert.equal(interactionLayout(event,null,target,1200),null);
  assert.equal(interactionLayout(event,source,{...target,width:0},1200),null);
});

test('native interaction tracks animate bucket delivery, pouring, blinking and all eight tomato fragments',()=>{
  const source={left:10,top:20,width:40,height:40},target={left:200,top:100,width:40,height:40};
  const event={id:'native',playerId:'sender',effect:'water',sentAt:new Date(1000).toISOString(),expiresAt:new Date(4000).toISOString()};
  const motion=interactionLayout(event,source,target,1000),water=interactionAnimations(motion,1000);
  assert.deepEqual(water.map(track=>track.part),['bucket','stream','cube','eye-left','eye-right']);
  assert.deepEqual(water[0].keyFrames.find(frame=>frame.offset===.2).matrix.slice(4),[164,26]);
  assert.equal(water[1].keyFrames.find(frame=>frame.offset===.31).opacity,1);
  assert.deepEqual(water[2].keyFrames.find(frame=>frame.offset===.43).matrix.slice(4),[190,80]);
  assert.equal(water[3].keyFrames.find(frame=>frame.offset===.5).matrix[3],.08);
  const tomato=interactionAnimations({...motion,effect:'tomato'},1000);
  assert.equal(tomato.length,11);assert.equal(tomato.filter(track=>track.part.startsWith('piece-')).length,8);
  assert.deepEqual(tomato[0].keyFrames.find(frame=>frame.offset===.23).matrix.slice(4),[190,80]);
  assert.equal(tomato[1].keyFrames.find(frame=>frame.offset===.26).opacity,1);
  for(const track of [...water,...tomato]){
    assert.equal(track.keyFrames[0].offset,0);assert.equal(track.keyFrames.at(-1).offset,1);
    assert.ok(track.keyFrames.every((frame,index,frames)=>frame.matrix.length===6&&frame.matrix.every(Number.isFinite)&&frame.offset>=0&&frame.offset<=1&&(!index||frame.offset>frames[index-1].offset)));
  }
});

test('native effects resume their current stage instead of restarting when an event arrives late',()=>{
  const motion=interactionLayout({id:'late',playerId:'sender',effect:'water',sentAt:new Date(1000).toISOString(),expiresAt:new Date(4000).toISOString()},{left:10,top:20,width:40,height:40},{left:200,top:100,width:40,height:40},1000);
  const tracks=interactionAnimations(motion,2500);
  assert.equal(tracks.find(track=>track.part==='bucket').keyFrames[0].opacity,0,'the bucket has already poured');
  assert.equal(tracks.find(track=>track.part==='cube').keyFrames[0].opacity,1,'the target is already covered');
  assert.equal(tracks.find(track=>track.part==='eye-left').keyFrames[0].matrix[3],.08);
  assert.deepEqual(interactionAnimations(motion,4000),[]);assert.deepEqual(interactionAnimations(motion,4500),[]);
});

test('settlement reveals four complete hands only after the hand ends and preserves signed half-points',()=>{
  const hand={phase:'own',players:[{hand:[4,0]},{hand:[8]},{hand:[12]},{hand:[16]}],scores:[7,-3,-1,-3],result:{deltas:[3,-1,-1,-1]}};
  assert.equal(settlementLayout(hand),null);hand.phase='finished';const before=JSON.stringify(hand),rows=settlementLayout(hand);
  assert.equal(rows.length,4);assert.deepEqual(rows[0].hand,[0,4]);assert.deepEqual(rows.map(row=>row.delta),['+1.5','-0.5','-0.5','-0.5']);assert.deepEqual(rows.map(row=>row.total),['+3.5','-1.5','-0.5','-1.5']);assert.equal(JSON.stringify(hand),before);
});

test('winning streak labels cover double, triple and longer consecutive wins',()=>{
  assert.equal(streakBadge(1),null);assert.equal(streakBadge(undefined),null);assert.equal(streakBadge(2).english,'Double Kill');assert.equal(streakBadge(3).english,'Triple Kill');assert.equal(streakBadge(5).english,'Penta Kill');assert.equal(streakBadge(6).label,'6连胜');
});

test('discard motions distinguish drawn tiles and concealed hand cuts across all four perspectives',()=>{
  const previous={matchId:'motion',handNo:1,actor:0,wildcardType:26,lastDraw:40,players:[{hand:[12,8,4,40]}],discardEvents:[]};
  const events=[{seq:10,seat:0,tileId:8,handCount:4,hadDraw:true,tsumogiri:false},{seq:12,seat:1,tileId:44,handCount:11,hadDraw:true,tsumogiri:true},{seq:15,seat:2,tileId:20,handCount:8,hadDraw:false,tsumogiri:false}];
  const next={...previous,discardEvents:events};
  for(let seat=0;seat<4;seat++){
    const motions=discardTransitions(previous,next,seat);
    assert.deepEqual(motions.map(m=>m.seq),[10,12,15]);
    assert.equal(motions[1].sourceIndex,10);
    assert.ok(motions[0].sourceIndex>=0&&motions[0].sourceIndex<3);
    assert.ok(motions[2].sourceIndex>=0&&motions[2].sourceIndex<8,'post-Pon cut includes every old tile');
  }
  assert.equal(discardTransitions(previous,next,0)[0].sourceIndex,1,'own discard uses actual sorted tile');
  assert.equal(discardTransitions(previous,next,0,false,[12,8,4])[0].sourceIndex,1);
  assert.deepEqual(discardTransitions(next,next,0),[]);
  assert.deepEqual(discardTransitions(null,next,0),[]);
  assert.deepEqual(discardTransitions(previous,{...next,handNo:2},0),[]);
  assert.deepEqual(discardTransitions(previous,{...next,matchId:'another'},0),[]);
});

test('hand cuts and draw cuts leave a temporary empty slot that closes',()=>{
  const hand=[{id:0,key:'a'},{id:null,key:'b'},{id:40,key:'c',last:true}],cut={seq:1,sourceIndex:1,startedAt:1000,tsumogiri:false};
  const slots=withDiscardGaps(hand,[cut],1000);
  assert.equal(slots[1].gap,true);assert.equal(slots[1].id,undefined,'a hole is not a concealed or flying tile');
  assert.deepEqual(slots.filter(face=>!face.gap).map(face=>face.id),[0,null,40]);
  assert.deepEqual(slots.filter(face=>!face.gap).map(face=>face.handIndex),[0,1,2],'drag indexes exclude placeholders');
  assert.equal(slots.at(-1).last,true);assert.equal(hand.length,3,'projection never changes the real hand');
  assert.equal(withDiscardGaps(hand,[cut],1050)[1].style,'animation-delay:-50ms','browser redraws resume the gap');
  assert.equal(withDiscardGaps(hand,[{...cut,delay:0}],1050)[1].style,'animation-delay:0ms','native keyed slots retain their original delay');
  assert.equal(withDiscardGaps(hand,[cut],1000+DISCARD_GAP_MS).length,3);
  assert.equal(withDiscardGaps(hand,[{...cut,tsumogiri:true,sourceIndex:3}],1000).at(-1).gap,true,'draw cuts close the separated draw slot');
  assert.equal(withDiscardGaps(hand,[{...cut,sourceIndex:10}],1000).at(-1).gap,true,'fast batches clamp to the current hand');
});

test('decision badges distinguish each call and preview its tile without changing the action',()=>{
  for(const kind of ['pon','exposedKong','concealedKong','addedKong']){
    const action={kind,type:9},before={...action},view=decisionLayout(action,null);
    assert.equal(view.glyph,kind==='pon'?'碰':'杠');assert.equal(view.preview.length,kind==='pon'?3:4);
    assert.ok(view.preview.every(id=>Math.floor(id/4)===9));assert.deepEqual(action,before);
  }
  assert.deepEqual(decisionLayout({kind:'win'},0).preview,[0]);assert.equal(decisionLayout({kind:'win'},0).glyph,'胡');
  assert.deepEqual(decisionLayout({kind:'win'},null).preview,[]);assert.deepEqual(decisionLayout({kind:'pon'},null).preview,[]);
  assert.equal(decisionLayout({kind:'pass'}).glyph,'过');assert.deepEqual(decisionLayout({kind:'pass'}).preview,[]);
});

test('the latest physical draw, including zero and wildcards, is separated from sorting and manual ordering',()=>{
  const hand=[20,4,21,0,8];
  assert.deepEqual(arrangeHand(hand,5,20),[21,0,4,8,20]);
  assert.deepEqual(arrangeHand(hand,5,0),[20,21,4,8,0]);
  assert.deepEqual(arrangeHand(hand,5,20,false,[8,20,4]),[8,4,21,0,20]);
  assert.deepEqual(arrangeHand(hand,5,null),[20,21,0,4,8]);
  assert.deepEqual(arrangeHand(hand,5,99,false,[8,4]),[8,4,20,21,0]);
  assert.deepEqual(hand,[20,4,21,0,8]);
});

test('called tiles show all three sources for every seat; added kongs retain the original called tile',()=>{
  for(let seat=0;seat<4;seat++)for(const relative of [1,2,3]){
    const from=(seat+relative)%4;
    for(const kind of ['pon','exposedKong','addedKong']){
      const ids=kind==='pon'?[40,41,42]:[40,41,42,43];
      const before={kind,from,tiles:ids.slice()};
      const view=meldLayout(before,seat);
      const index=view.tiles.findIndex(tile=>tile.called);
      assert.equal(index,relative===3?0:relative===2?1:view.tiles.length-1);
      assert.equal(view.tiles[index].id,kind==='exposedKong'?43:42);
      assert.equal(view.relative,relative);
      assert.equal(view.source,{1:'下家',2:'对家',3:'上家'}[relative]);
      if(kind==='addedKong'){assert.equal(view.tiles.length,3);assert.equal(view.tiles[index].addedId,43);}
      const displayed=view.tiles.flatMap(tile=>tile.addedId===undefined?[tile.id]:[tile.id,tile.addedId]).sort();
      assert.deepEqual(displayed,ids.slice().sort());
      assert.deepEqual(before,{kind,from,tiles:ids});
    }
  }
});

test('concealed kongs hide the two ends and unknown sources do not invent a called direction',()=>{
  const hidden=meldLayout({kind:'concealedKong',from:2,tiles:[40,41,42,43]},2);
  assert.deepEqual(hidden.tiles.map(tile=>tile.faceDown),[true,false,false,true]);
  assert.ok(hidden.tiles.every(tile=>!tile.called));assert.equal(hidden.source,'自己');
  const unknown=meldLayout({kind:'addedKong',tiles:[40,41,42,43]},0);
  assert.equal(unknown.tiles.length,4);assert.ok(unknown.tiles.every(tile=>!tile.called));assert.equal(unknown.source,'来源未知');
});
