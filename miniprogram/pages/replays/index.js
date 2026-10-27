'use strict';
const api=require('../../lib/api');
const {replayState,verifyHand}=require('../../lib/replay');
const {tableView,points,labels}=require('../../lib/presentation');
const {fail:setError}=require('../../lib/room-state');
const cloudAssets=require('../../lib/cloud-assets');
Page({
  data:{matches:[],match:null,handIndex:0,eventIndex:0,eventCount:0,perspective:0,revealAll:false,vm:null,playing:false,error:'',limit:1000,report:null,eventLabel:'',handNames:[],playerNames:[]},
  onLoad(query){this.target=query.match||null;},
  async onShow(){try{await this.refresh();if(this.target){const target=this.target;this.target=null;await this.open(target);}}catch(error){this.fail(error);}},
  onHide(){this.pause();},onUnload(){this.pause();},
  fail(error){setError(this,error,'暂时无法查看牌谱，请稍后重试。');},
  async refresh(){await cloudAssets.ensure();const [history,profile]=await Promise.all([api.request('/api/history'),api.request('/api/me')]);this.user=profile.user;this.setData({matches:history.matches.map(match=>({...match,date:match.endedAt.replace('T',' ').slice(0,16),score:points(match.scores[match.seats.findIndex(seat=>seat.playerId===profile.user.id)])})),limit:profile.user.historyMatchLimit});},
  openEvent(event){this.open(event.currentTarget.dataset.id).catch(error=>this.fail(error));},
  async open(id){
    this.pause();const match=await api.request('/api/matches/'+id);
    const perspective=Math.max(0,match.seats.findIndex(seat=>seat.playerId===this.user.id));
    this.setData({match,handIndex:0,eventIndex:0,perspective,revealAll:false,handNames:match.hands.map(hand=>'第 '+hand.handNo+' 局'),playerNames:match.seats.map(seat=>seat.name),error:''});
    this.selectHand(0);
  },
  selectHand(index){
    this.pause();const hand=this.data.match.hands[index];
    const opening=hand.events.reduce((end,event,i)=>event.kind==='deal'?i+1:end,0);
    this.setData({handIndex:index,eventIndex:opening,eventCount:hand.events.length,report:verifyHand(hand,api.observedCode(hand))});
    this.render();
  },
  render(){
    const match=this.data.match,hand=match.hands[this.data.handIndex];
    const state=replayState(hand,this.data.eventIndex);
    const local=this.data.perspective;
    const visible={...hand,...state,drawSeat:state.lastDraw===null?null:state.actor,actions:[],players:state.players.map((player,seat)=>({...player,hand:this.data.revealAll||seat===local?player.hand:Array(player.hand.length).fill(null)}))};
    const room={seat:local,seats:match.seats.map(seat=>({id:seat.playerId,name:seat.name,online:true})),match:{...match,hand:visible}};
    const event=hand.events[this.data.eventIndex-1];
    this.setData({vm:tableView(room),eventLabel:event?event.seq+' · '+(event.kind==='draw'?'摸牌':event.kind==='discard'?(event.tsumogiri?'摸切':'手切'):labels[event.kind]||'操作')+' · '+match.seats[event.seat].name:'尚未确认发牌前校验码'});
  },
  step(event){this.pause();this.setData({eventIndex:Math.max(0,Math.min(this.data.eventCount,this.data.eventIndex+Number(event.currentTarget.dataset.delta)))});this.render();},
  seek(event){this.pause();this.setData({eventIndex:Number(event.detail.value)});this.render();},
  handChange(event){this.selectHand(Number(event.detail.value));},
  perspective(event){this.setData({perspective:Number(event.detail.value)});this.render();},
  reveal(event){this.setData({revealAll:event.detail.value});this.render();},
  play(){
    if(this.data.playing){this.pause();return;}
    if(this.data.eventIndex===this.data.eventCount)this.setData({eventIndex:0});
    this.setData({playing:true});
    this.timer=setInterval(()=>{if(this.data.eventIndex>=this.data.eventCount){this.pause();return;}this.setData({eventIndex:this.data.eventIndex+1});this.render();},600);
  },
  pause(){clearInterval(this.timer);this.setData({playing:false});},
  back(){if(this.data.match){this.pause();this.setData({match:null,vm:null});}else wx.navigateBack();},
  verify(){wx.navigateTo({url:'/pages/verify/index?match='+this.data.match.id+'&hand='+(this.data.handIndex+1)});},
  calculator(){wx.navigateTo({url:'/pages/verify/index'});},
  async export(){try{await api.exportJson(this.data.match,'牌谱-'+this.data.match.id);}catch(error){this.fail(error);}},
  limitInput(event){this.setData({limit:event.detail.value});},
  async saveLimit(){
    try{await api.request('/api/me','PATCH',{historyMatchLimit:Number(this.data.limit)});await this.refresh();this.setData({error:''});}
    catch(error){
      if(error.status!==409){this.fail(error);return;}
      wx.showModal({title:'删除较早的牌谱？',content:error.message,confirmText:'确认删除',cancelText:'取消',success:async result=>{if(result.confirm){try{await api.request('/api/me','PATCH',{historyMatchLimit:Number(this.data.limit),confirmPrune:true});await this.refresh();this.setData({error:''});}catch(next){this.fail(next);}}}});
    }
  },
});
