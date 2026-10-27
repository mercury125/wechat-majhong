'use strict';
const api=require('../../lib/api');
const {tableView,labels,characterView}=require('../../lib/presentation');
const {typeOf}=require('../../lib/tiles');
const {discardTransitions,DISCARD_GAP_MS,interactionLayout,streakBadge,oppositeAvatarLayout}=require('../../lib/layout');
const cosmetics=require('../../lib/cosmetics');
const {paintInteraction,avatarFallbacks}=require('../../lib/interaction-canvas');
const cloudAssets=require('../../lib/cloud-assets');
const {acceptRoom,dataPatch,fail:setError,tileAction,safeAreaStyle}=require('../../lib/room-state');
Page({
  data:{safeStyle:'',oppositeAvatarStyle:'',room:null,vm:null,selected:null,selectedAction:null,selectedWild:false,busy:false,error:'',showResult:true,settingsOpen:false,codeExpanded:false,paymentsExpanded:false,helpExpanded:false,sortEnabled:true,emoteOpen:false,characterOpen:false,emotePack:'character',winEffect:null,interactionTarget:null,interactionName:'',interactionEffects:[],callEffects:[],selectedCharacter:'ironclad',characters:cosmetics.characters.map((item,index)=>characterView(item.id,index))},
  onLoad(query){this.code=query.room;this.handOrder=[];this.setData({safeStyle:safeAreaStyle(wx)});},
  onShow(){this.setData({winEffect:null,characterOpen:false,emoteOpen:false,settingsOpen:false,safeStyle:safeAreaStyle(wx)});this.clearDiscardGaps();this.clearInteractions();this.discardBaseline=false;this.stopped=false;this.render();cloudAssets.ensure().then(()=>{if(!this.stopped){this.setData({characters:cosmetics.characters.map((item,index)=>characterView(item.id,index))});if(this.data.room)this.render();}});this.stop=api.watchRoom(this.code,room=>this.accept(room),error=>this.fail(error));},
  onResize(){this.oppositeLayoutKey=null;this.dragCancel();this.clearInteractions();this.setData({safeStyle:safeAreaStyle(wx)},()=>this.render());},
  onHide(){this.stopped=true;this.oppositeLayoutKey=null;this.oppositeAvatarRect=null;this.dragCancel();clearTimeout(this.emoteTimer);clearTimeout(this.winTimer);this.clearCalls();this.clearDiscardGaps();this.clearInteractions();if(this.stop)this.stop();},onUnload(){this.onHide();},
  fail(error){setError(this,error,'操作失败，请稍后重试。');if(error.status===401)wx.reLaunch({url:'/pages/lobby/index'});},
  update(values,callback){const patch=dataPatch(this.data,values);if(Object.keys(patch).length)this.setData(patch,callback);else if(callback)callback();},
  viewOptions(){return {sortEnabled:this.data.sortEnabled,handOrder:this.handOrder,discardGaps:this.discardGaps||[]};},
  render(){
    clearTimeout(this.emoteTimer);
    const room=this.data.room;if(!room||!room.match)return;
    const vm=tableView(room,this.viewOptions()),target=vm.interactionTargets.some(target=>target.seat===this.data.interactionTarget)?this.data.interactionTarget:vm.interactionTargets[0]?.seat;
    this.update({vm,interactionTarget:target===undefined?null:target,interactionName:vm.interactionTargets.find(player=>player.seat===target)?.name||'',selectedAction:tileAction(room.match.hand,this.data.selected)},()=>this.alignOppositeAvatar(()=>this.renderInteractions(this.data.room)));
    const expires=(room.emotes||[]).filter(Boolean).map(emote=>Date.parse(emote.expiresAt)).filter(time=>time>Date.now());
    if(!this.stopped&&expires.length)this.emoteTimer=setTimeout(()=>this.render(),Math.min(...expires)-Date.now()+20);
  },
  alignOppositeAvatar(done){
    const top=this.data.vm&&this.data.vm.players.find(player=>player.position==='top');
    if(!top||typeof wx.createSelectorQuery!=='function'){done();return;}
    const info=typeof wx.getWindowInfo==='function'?wx.getWindowInfo():{};
    const key=[top.hand.length,top.hand.some(face=>face.last),top.hand.some(face=>face.gap),info.windowWidth,info.windowHeight,this.data.safeStyle].join(':');
    if(key===this.oppositeLayoutKey){if(this.oppositeAvatarRect)done();return;}
    this.oppositeLayoutKey=key;this.oppositeAvatarRect=null;
    try{
      const query=wx.createSelectorQuery();
      for(const selector of ['.table','.opponent-rack.top .tiles','.seat.top','.seat.top .avatar'])query.select(selector).boundingClientRect();
      query.exec(rects=>{
        if(this.stopped||key!==this.oppositeLayoutKey)return;
        const placed=oppositeAvatarLayout(...(rects||[]));
        if(!placed){this.oppositeLayoutKey=null;done();return;}
        this.oppositeAvatarRect=placed.rect;
        this.update({oppositeAvatarStyle:placed.style},done);
      });
    }catch{this.oppositeLayoutKey=null;done();}
  },
  accept(room){
    if(this.stopped||!acceptRoom(this.data.room,room))return;
    room=JSON.parse(JSON.stringify(room));
    this.confirmedControls={...(room.controls||{})};
    if(this.controlsPending){
      const pending=this.controlsPending,hand=room.match&&room.match.hand;
      if(!hand||hand.phase==='finished'||hand.matchId!==pending.matchId||hand.handNo!==pending.handNo)this.controlsPending=null;
      else room.controls={...(room.controls||{}),...pending.values};
    }
    if(this.discardPending){
      const pending=this.discardPending;
      const hand=room.match&&room.match.hand;
      const player=hand&&hand.players[pending.seat];
      const confirmed=player&&player.discards&&player.discards.some(discard=>discard.id===pending.tile);
      if(confirmed)this.discardPending=null;
      else if(Date.now()<pending.expiresAt){
        this.applyDiscardToRoom(room,pending);
      }
    }
    if(this.emotePending){
      const pending=this.emotePending;
      const serverEmote=room.emotes&&room.emotes[pending.seat];
      if(serverEmote&&serverEmote.id===pending.id)this.emotePending=null;
      else if(Date.now()<pending.expiresAt){
        room.emotes=room.emotes||[null,null,null,null];
        room.emotes[pending.seat]=pending.data;
      }
    }
    if(!room.match){wx.navigateBack();return;}
    const hand=room.match.hand;
    const previous=this.data.room&&this.data.room.match&&this.data.room.match.hand;
    if(!previous||previous.handNo!==hand.handNo||previous.matchId!==hand.matchId){
      clearTimeout(this.winTimer);
      this.clearDiscardGaps();
      this.clearInteractions();
      this.clearCalls();
      this.handOrder=[];
      this.setData({selected:null,selectedWild:false,showResult:true,winEffect:null});
    }else{
      if(previous.phase!=='finished'&&hand.phase==='finished'&&hand.result&&hand.result.kind==='win')this.playWinEffect(room);
      if(previous.phase!==hand.phase||previous.actor!==hand.actor||previous.lastDraw!==hand.lastDraw)this.setData({selected:null,selectedAction:null,selectedWild:false});
    }
    const suppressed=this.suppressedDiscardIds||new Set();
    const motions=(this.discardBaseline===false?[]:discardTransitions(previous,hand,room.seat,this.data.sortEnabled,this.handOrder)).filter(motion=>!suppressed.has(motion.tileId));
    this.discardBaseline=true;
    this.addDiscardGaps(motions);
    const role=room.characters&&room.characters[room.seat];
    this.update({room,error:'',...(role?{selectedCharacter:role}:{})});this.render();this.renderCalls(room);
    if(hand.phase==='commit')this.acknowledge(room);
  },
  async acknowledge(room){
    if(this.ackPending||room.match.hand.acknowledgements[room.seat])return;
    this.ackPending=true;
    try{api.rememberCommitment(room.match.hand);this.accept(await api.command(room,{kind:'ack',code:room.match.hand.wallCode}));}
    catch(error){if(error.status===409){try{this.accept(await api.request('/api/rooms/'+this.code));}catch(refreshError){this.fail(refreshError);}}else this.fail(error);}
    finally{this.ackPending=false;const latest=this.data.room;if(!this.stopped&&latest&&latest.match.hand.phase==='commit'&&!latest.match.hand.acknowledgements[latest.seat]&&!this.data.error)setTimeout(()=>this.acknowledge(latest),100);}
  },
  applyDiscardToRoom(room,pending){
    const hand=room.match&&room.match.hand,player=hand&&hand.players[pending.seat];
    if(!hand||!player)return room;
    player.hand=(player.hand||[]).filter(id=>id!==pending.tile);
    player.discards=player.discards||[];
    if(!player.discards.some(discard=>discard.id===pending.tile))player.discards.push(pending.discard);
    if(hand.lastDraw===pending.tile)hand.lastDraw=null;
    hand.phase='responses';
    hand.actions=[];
    return room;
  },
  optimisticDiscard(action){
    const room=JSON.parse(JSON.stringify(this.data.room));
    const hand=room.match&&room.match.hand,player=hand&&hand.players[room.seat];
    if(!hand||!player||!player.hand.includes(action.tile))return null;
    const pending={seat:room.seat,tile:action.tile,discard:{id:action.tile,claimed:false,tsumogiri:hand.lastDraw===action.tile},expiresAt:Date.now()+5000};
    this.discardPending=pending;
    this.suppressedDiscardIds=this.suppressedDiscardIds||new Set();
    this.suppressedDiscardIds.add(action.tile);
    return this.applyDiscardToRoom(room,pending);
  },
  clearCalls(){
    for(const timer of this.callTimers||[])clearTimeout(timer);
    this.callTimers=[];this.callSeen=new Set();this.callUntil={};this.update({callEffects:[]});
  },
  renderCalls(room){
    if(!this.callSeen)this.clearCalls();
    for(const notice of room.callNotices||[]){
      const now=Date.now(),remaining=Date.parse(notice.expiresAt)-now;
      if(remaining<=0||this.callSeen.has(notice.id))continue;
      this.callSeen.add(notice.id);
      const effect={...notice,position:['bottom','right','top','left'][(notice.seat-room.seat+4)%4]};
      const delay=Math.max(0,(this.callUntil[notice.seat]||0)-now);
      this.callUntil[notice.seat]=now+delay+1500;
      const show=()=>{
        if(this.stopped)return;
        this.update({callEffects:this.data.callEffects.filter(item=>item.seat!==notice.seat).concat(effect)});
        this.callTimers.push(setTimeout(()=>{if(!this.stopped)this.update({callEffects:this.data.callEffects.filter(item=>item.id!==notice.id)});},1500));
      };
      if(delay)this.callTimers.push(setTimeout(show,delay));else show();
    }
  },
  optimisticCall(){
    const room=JSON.parse(JSON.stringify(this.data.room));
    if(room.match&&room.match.hand)room.match.hand.actions=[];
    return room;
  },
  async send(action){
    if(this.data.busy)return;
    const isCall=['win','pon','exposedKong','concealedKong','addedKong','pass'].includes(action.kind);
    const optimistic=action.kind==='discard'?this.optimisticDiscard(action):(isCall?this.optimisticCall():null);
    this.setData({busy:true,error:'',...(optimistic?{room:optimistic,selected:null,selectedAction:null,selectedWild:false}:{})},()=>{if(optimistic)this.render();});
    try{this.accept(await api.command(optimistic||this.data.room,action));this.setData({selected:null,selectedAction:null,selectedWild:false});}
    catch(error){
      this.discardPending=null;
      if(action.kind==='discard'&&this.suppressedDiscardIds)this.suppressedDiscardIds.delete(action.tile);
      this.fail(error);
      try{this.accept(await api.request('/api/rooms/'+this.code));}catch{}
    }
    finally{this.discardPending=null;this.setData({busy:false});}
  },
  select(event){
    if(this.skipTap||this.data.busy||!this.data.room||!this.data.room.match)return;
    const id=event.detail.id;
    const hand=this.data.room.match.hand;
    const action=tileAction(hand,id);
    if(this.data.selected===id&&action)return this.send(action);
    this.setData({selected:id,selectedAction:action,selectedWild:typeOf(id)===hand.wildcardType});
    if(!action&&typeOf(id)===hand.wildcardType)this.setData({error:'牌墙剩余不足五张，不能飘癞子。'});
  },
  toggleSort(){const sortEnabled=!this.data.sortEnabled;this.setData({sortEnabled,selected:null,selectedAction:null},()=>this.render());},
  async toggleControl(event){
    if(this.data.busy||this.data.room.match.hand.phase==='finished')return;
    const key=event.currentTarget.dataset.key,controls=this.data.room.controls||{};
    const hand=this.data.room.match.hand;
    const value=!controls[key];
    if(!this.controlsPending)this.controlsPending={matchId:hand.matchId,handNo:hand.handNo,values:{}};
    this.controlsPending.values[key]=value;
    this.update({room:{...this.data.room,controls:{...controls,[key]:value}},error:'',selected:null,selectedAction:null},()=>this.render());
    if(!this.controlsSaving)this.controlsSaving=this.saveControls().finally(()=>{this.controlsSaving=null;});
    return this.controlsSaving;
  },
  async saveControls(){
    while(this.controlsPending){
      const pending=this.controlsPending,values={...pending.values};
      try{
        const room=await api.request('/api/rooms/'+this.code+'/controls','PATCH',{...values,matchId:pending.matchId,handNo:pending.handNo});
        if(this.controlsPending===pending){
          for(const key of Object.keys(values))if(pending.values[key]===values[key])delete pending.values[key];
          if(!Object.keys(pending.values).length)this.controlsPending=null;
        }
        this.accept(room);
      }catch(error){
        if(this.controlsPending===pending){this.controlsPending=null;this.update({room:{...this.data.room,controls:{...this.confirmedControls}}});this.render();}
        try{this.accept(await api.request('/api/rooms/'+this.code));}catch{}
        if(this.controlsPending&&this.controlsPending!==pending&&error.status!==401)continue;
        this.fail(error);return;
      }
    }
  },
  decision(event){
    const offered=this.data.vm&&this.data.vm.decisions[Number(event.currentTarget.dataset.index)];
    const action=offered&&this.data.room.match.hand.actions.find(item=>item.kind===offered.kind&&item.type===offered.type&&item.tile===offered.tile);
    if(action)return this.send(action);
  },
  playWinEffect(room){
    clearTimeout(this.winTimer);
    const hand=room.match.hand,badge=streakBadge(room.match.winStreak&&room.match.winStreak.count),duration=badge?2200:1600;
    this.setData({winEffect:{winner:room.match.seats[hand.result.winner].name,kind:labels[hand.result.classification]||'自摸胡牌',badge,duration,sparks:Array.from({length:12},(_,i)=>i*30)},showResult:true});
    this.winTimer=setTimeout(()=>{if(!this.stopped)this.setData({winEffect:null});},duration);
  },
  clearDiscardGaps(){
    for(const timer of this.discardTimers||[])clearTimeout(timer);
    this.discardTimers=[];this.discardGaps=[];
  },
  addDiscardGaps(motions){
    const cuts=motions,now=Date.now();
    cuts.forEach((motion,index)=>{
      const delay=index*Math.min(80,600/cuts.length);
      // Keyed native slots preserve their CSS animation across data refreshes.
      this.discardGaps.push({...motion,startedAt:now+delay,delay});
      this.discardTimers.push(setTimeout(()=>{
        if(this.stopped)return;
        this.discardGaps=this.discardGaps.filter(gap=>gap.seq!==motion.seq);this.render();
      },delay+DISCARD_GAP_MS));
    });
  },
  dragStart(event){
    this.skipTap=false;
    if(this.data.sortEnabled||this.data.busy)return;
    const hand=this.data.room&&this.data.room.match&&this.data.room.match.hand;
    if(!hand)return;
    const touch=event.touches&&event.touches[0];if(!touch)return;
    this.drag={index:Number(event.currentTarget.dataset.index),x:touch.clientX,y:touch.clientY};
  },
  dragEnd(event){
    const drag=this.drag;this.drag=null;
    if(!drag||this.data.sortEnabled||this.data.busy||!this.data.vm||!this.data.vm.self)return;
    const touch=event.changedTouches&&event.changedTouches[0];if(!touch)return;
    if(Math.abs(touch.clientX-drag.x)<8&&Math.abs(touch.clientY-drag.y)<8)return;
    this.skipTap=true;
    wx.createSelectorQuery().in(this).selectAll('.hand-slot').boundingClientRect(rects=>{
      if(!rects||rects.length<2)return;
      const ids=this.data.vm.self.hand.filter(face=>!face.gap).map(face=>face.id);
      const [moved]=ids.splice(drag.index,1);
      let insert=rects.filter(rect=>touch.clientX>rect.left+rect.width/2).length;
      if(drag.index<insert)insert--;
      ids.splice(Math.max(0,Math.min(ids.length,insert)),0,moved);
      this.handOrder=ids;
      this.setData({selected:null,selectedAction:null});
      this.render();
    }).exec();
  },
  dragCancel(){this.drag=null;this.skipTap=false;},
  next(){this.send({kind:'continue'});},
  restart(){return this.send({kind:'ready',ready:!this.data.room.ready[this.data.room.seat]});},
  async exitTest(){
    if(this.data.busy)return;
    this.setData({busy:true,error:''});
    try{await api.command(this.data.room,{kind:'leave'});this.onHide();wx.removeStorageSync('lastRoom');wx.reLaunch({url:'/pages/lobby/index'});}
    catch(error){this.fail(error);}finally{this.setData({busy:false});}
  },
  toggleSettings(){this.setData({settingsOpen:!this.data.settingsOpen,emoteOpen:false,characterOpen:false});},
  toggleEmotes(){this.setData({emoteOpen:!this.data.emoteOpen,characterOpen:false,settingsOpen:false});},
  toggleCharacter(){this.setData({characterOpen:!this.data.characterOpen,emoteOpen:false,settingsOpen:false});},
  async chooseCharacter(event){
    const character=event.currentTarget.dataset.id;
    if(this.data.busy||!cosmetics.character(character))return;
    this.setData({busy:true,error:''});
    try{this.accept(await api.request('/api/rooms/'+this.code+'/appearance','POST',{character}));this.setData({characterOpen:false});}
    catch(error){this.fail(error);}finally{this.setData({busy:false});}
  },
  chooseEmotePack(event){this.setData({emotePack:event.currentTarget.dataset.pack});},
  chooseInteractionTarget(event){const target=this.data.vm.interactionTargets.find(player=>player.seat===Number(event.currentTarget.dataset.seat));if(target)this.setData({interactionTarget:target.seat,interactionName:target.name});},
  openInteraction(event){if(!this.data.vm?.interactionTargets.some(player=>player.seat===Number(event.currentTarget.dataset.seat)))return;this.chooseInteractionTarget(event);this.setData({emoteOpen:true,emotePack:'interaction',characterOpen:false,settingsOpen:false});},
  async interaction(event){
    const vm=this.data.vm,target=this.data.interactionTarget;
    if(this.data.busy||!vm||!vm.canInteract||vm.interactionRemaining<=0||!vm.interactionTargets.some(player=>player.seat===target))return;
    const hand=this.data.room.match.hand,effect=event.currentTarget.dataset.effect,id=api.actionId(),now=Date.now();
    const playerId=this.data.room.seats[this.data.room.seat]&&this.data.room.seats[this.data.room.seat].id;
    const optimistic=JSON.parse(JSON.stringify(this.data.room));
    optimistic.interactions=(optimistic.interactions||[]).concat([{id,playerId,from:this.data.room.seat,target,effect,matchId:hand.matchId,handNo:hand.handNo,sentAt:new Date(now).toISOString(),expiresAt:new Date(now+cosmetics.interactionLifetime).toISOString()}]);
    optimistic.interactionRemaining=Math.max(0,Number(optimistic.interactionRemaining===undefined?cosmetics.interactionLimit:optimistic.interactionRemaining)-1);
    this.setData({room:optimistic,busy:true,error:'',emoteOpen:false},()=>this.render());
    try{const room=await api.request('/api/rooms/'+this.code+'/interactions','POST',{id,effect,target,matchId:hand.matchId,handNo:hand.handNo});this.accept(room);}
    catch(error){this.setData({emoteOpen:true});this.fail(error);try{this.accept(await api.request('/api/rooms/'+this.code));}catch{}}
    finally{this.setData({busy:false});}
  },
  clearInteractions(){
    clearTimeout(this.interactionRetry);
    if(this.interactionCanvas&&this.interactionFrame!=null)this.interactionCanvas.cancelAnimationFrame(this.interactionFrame);
    if(this.interactionContext)this.interactionContext.clearRect(0,0,this.interactionCanvas.width,this.interactionCanvas.height);
    this.interactionFrame=null;this.interactionCanvas=null;this.interactionContext=null;
    this.interactionMotions=new Map();this.interactionSeen=new Set();this.interactionPending=new Set();this.setData({interactionEffects:[]});
  },
  renderInteractions(room){
    if(this.stopped||typeof wx.createSelectorQuery!=='function')return;
    const seen=this.interactionSeen,pending=this.interactionPending,events=(room.interactions||[]).filter(event=>!seen.has(event.playerId+':'+event.id)&&!pending.has(event.playerId+':'+event.id)&&Date.parse(event.expiresAt)>Date.now());
    if(!events.length)return;
    for(const event of events)pending.add(event.playerId+':'+event.id);
    const query=wx.createSelectorQuery();query.select('#interaction-canvas').fields({node:true,size:true});
    for(let seat=0;seat<4;seat++)query.select('#interaction-avatar-'+seat).boundingClientRect();
    query.exec(([surface,...anchors])=>{
      if(this.stopped||seen!==this.interactionSeen||this.data.room.code!==room.code||this.data.room.match.id!==room.match.id||this.data.room.match.hand.handNo!==room.match.hand.handNo)return;
      for(const event of events)pending.delete(event.playerId+':'+event.id);
      if(!surface?.node||!(surface.width>0&&surface.height>0)){
        clearTimeout(this.interactionRetry);this.interactionRetry=setTimeout(()=>{if(!this.stopped&&seen===this.interactionSeen)this.renderInteractions(this.data.room);},50);return;
      }
      const info=typeof wx.getWindowInfo==='function'?wx.getWindowInfo():wx.getSystemInfoSync(),fallbacks=avatarFallbacks(info,room.seat);
      if(this.oppositeAvatarRect)fallbacks[(room.seat+2)%4]=this.oppositeAvatarRect;
      if(this.interactionCanvas!==surface.node){
        const ratio=info.pixelRatio||1;this.interactionCanvas=surface.node;surface.node.width=Math.round(surface.width*ratio);surface.node.height=Math.round(surface.height*ratio);
        this.interactionContext=surface.node.getContext('2d');this.interactionContext.scale(ratio,ratio);
      }
      let index=this.data.interactionEffects.length;
      for(const event of events){
        const rect=seat=>anchors[seat]?.width>0&&anchors[seat]?.height>0?anchors[seat]:fallbacks[seat];
        const motion=interactionLayout(event,rect(event.from),rect(event.target));
        const effect=cosmetics.interactions.find(effect=>effect.id===event.effect);if(!motion||!effect)continue;
        seen.add(motion.key);
        const path='interactionEffects['+index+']';index++;
        this.interactionMotions.set(motion.key,{motion,path});
        this.setData({[path]:{key:motion.key,effect:motion.effect,active:true,staticStyle:'left:'+(motion.x+motion.dx)+'px;top:'+(motion.y+motion.dy)+'px',faceStyle:'left:'+(-motion.side/2)+'px;top:'+(-motion.side/2)+'px;width:'+motion.side+'px;height:'+motion.side+'px',label:(room.seats[event.from]?.name||'牌友')+'向'+(room.seats[event.target]?.name||'牌友')+effect.name}});
      }
      if(this.interactionFrame==null)this.drawInteractions();
    });
  },
  drawInteractions(){
    if(this.stopped||!this.interactionCanvas)return;
    const canvas=this.interactionCanvas,ctx=this.interactionContext,now=Date.now(),patch={};
    ctx.clearRect(0,0,canvas.width,canvas.height);
    for(const [key,{motion,path}] of this.interactionMotions){
      if(now>=motion.expiresAt){this.interactionMotions.delete(key);patch[path]={key,active:false};}
      else paintInteraction(ctx,motion,now);
    }
    if(Object.keys(patch).length)this.setData(patch);
    this.interactionFrame=this.interactionMotions.size?canvas.requestAnimationFrame(()=>{this.interactionFrame=null;this.drawInteractions();}):null;
  },
  async emote(event){
    if(this.data.busy||this.emotePending||this.data.vm&&this.data.vm.self.emote)return;
    const emote=event.currentTarget.dataset.emote;
    const id=api.actionId();
    const seat=this.data.room.seat;
    const now=Date.now();
    const data={id,emote,character:this.data.room.characters&&this.data.room.characters[seat],sentAt:new Date(now).toISOString(),expiresAt:new Date(now+3000).toISOString()};
    const optimistic=JSON.parse(JSON.stringify(this.data.room));
    optimistic.emotes=optimistic.emotes||[null,null,null,null];
    optimistic.emotes[seat]=data;
    this.emotePending={id,seat,data,expiresAt:now+3000};
    this.setData({room:optimistic,busy:true,error:'',emoteOpen:false},()=>this.render());
    try{
      const room=await api.request('/api/rooms/'+this.code+'/emotes','POST',{id,emote});
      this.emotePending=null;
      this.accept(room);
    }catch(error){
      this.emotePending=null;
      this.setData({emoteOpen:true});
      this.fail(error);
      try{this.accept(await api.request('/api/rooms/'+this.code));}catch{}
    }finally{this.setData({busy:false});}
  },
  closeResult(){this.setData({showResult:false});},
  openResult(){this.setData({showResult:true});},
  toggleCode(){this.setData({codeExpanded:!this.data.codeExpanded});},
  togglePayments(){this.setData({paymentsExpanded:!this.data.paymentsExpanded});},
  toggleHelp(){this.setData({helpExpanded:!this.data.helpExpanded});},
  copyCode(){wx.setClipboardData({data:this.data.room.match.hand.wallCode});},
  replays(){wx.navigateTo({url:'/pages/replays/index?match='+this.data.room.match.id});},
  verify(){wx.navigateTo({url:'/pages/verify/index?match='+this.data.room.match.id+'&hand='+this.data.room.match.hand.handNo});},
  lobby(){
    const pages=getCurrentPages(),previous=pages[pages.length-2];
    if(previous&&previous.route==='pages/lobby/index'){previous.stayInLobby=true;wx.navigateBack();}
    else wx.reLaunch({url:'/pages/lobby/index'});
  },
  onShareAppMessage(){return this.data.room&&this.data.room.testMode?{title:'邀请你来好友麻将一起玩',path:'/pages/lobby/index'}:{title:'来好友麻将一起玩 · 房间 '+this.code,path:'/pages/lobby/index?room='+this.code};},
});
