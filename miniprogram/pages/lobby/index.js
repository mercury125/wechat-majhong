'use strict';
const api=require('../../lib/api');
const config=require('../../config');
const cosmetics=require('../../lib/cosmetics');
const {acceptRoom,fail:setError,safeAreaStyle}=require('../../lib/room-state');
const cloudAssets=require('../../lib/cloud-assets');
const characterChoices=()=>cosmetics.characters.map(character=>({...character,sheetUrl:cloudAssets.assetUrl(character.sheet)}));
Page({
  data:{safeStyle:'',user:null,name:'',joinCode:'',room:null,rooms:[],seatCards:[],handsPerMatch:8,busy:false,error:'',development:config.development,characters:characterChoices(),selectedCharacter:'ironclad'},
  onLoad(query={}){
    this.setData({safeStyle:safeAreaStyle(wx)});
    this.invite=typeof query.room==='string'?query.room.trim().toUpperCase():'';
    if(this.invite)this.setData({joinCode:this.invite});
    try{const saved=wx.getStorageSync('character');if(saved)this.setData({selectedCharacter:saved});}catch{}
  },
  async onShow(){
    this.setData({safeStyle:safeAreaStyle(wx)});
    this.navigating=false;
    const assets=cloudAssets.ensure().then(()=>this.setData({characters:characterChoices()}));
    const invite=wx.getStorageSync('invitedRoom');
    if(invite){this.invite=invite;this.setData({joinCode:invite});}
    try {if(!wx.getStorageSync('sessionToken')){await assets;return;}await Promise.all([assets,this.restore()]);}
    catch(error){
      if(error.status===401&&!config.development){
        try{await api.login();await this.restore();return;}catch(retryError){error=retryError;}
      }
      this.fail(error);if(error.status===401)this.setData({user:null,room:null});
    }
  },
  async restore(){
    const result=await api.request('/api/me');this.setData({user:result.user,rooms:result.rooms,error:''});
    if(this.invite)await this.joinCode(this.invite);
    else if(this.data.room)this.subscribe(this.data.room.code);
  },
  onHide(){if(this.stop)this.stop();},onUnload(){if(this.stop)this.stop();},
  field(event){this.setData({[event.currentTarget.dataset.key]:event.detail.value});},
  fail(error){setError(this,error,'无法完成操作，请稍后重试。');},
  async run(fn){if(this.data.busy)return;this.setData({busy:true,error:''});try{await fn();}catch(error){this.fail(error);}finally{this.setData({busy:false});}},
  login(event){return this.run(async()=>{const value=event&&event.detail&&event.detail.value;const name=(value&&value.nickname!==undefined?value.nickname:this.data.name).trim();await api.login(name||undefined);await this.restore();});},
  async enter(room){
    this.stayInLobby=false;
    const preferred=this.data.selectedCharacter;
    if(preferred&&room.characters&&room.characters[room.seat]&&room.characters[room.seat]!==preferred){
      try{room=await api.request('/api/rooms/'+room.code+'/appearance','POST',{character:preferred});}catch{}
    }
    this.accept(room);this.subscribe(room.code);
  },
  create(){return this.run(async()=>{const room=await api.request('/api/rooms','POST',{handsPerMatch:Number(this.data.handsPerMatch)});await this.enter(room);});},
  testMode(){return this.run(async()=>{const room=await api.request('/api/rooms','POST',{handsPerMatch:Number(this.data.handsPerMatch),testMode:true});await this.enter(room);});},
  join(){return this.run(()=>this.joinCode(this.data.joinCode));},
  async joinCode(code){code=code.trim().toUpperCase();if(!/^[A-Z0-9]{8}$/.test(code))throw new Error('请输入有效的 8 位房间号');const room=await api.request('/api/rooms/'+code+'/join','POST',{id:api.actionId()});await this.enter(room);},
  reconnect(event){const code=event.currentTarget.dataset.code;this.run(async()=>{const room=await api.request('/api/rooms/'+code);await this.enter(room);});},
  chooseCharacter(event){
    const character=event.currentTarget.dataset.id;
    if(!cosmetics.character(character))return;
    this.setData({selectedCharacter:character});
    try{wx.setStorageSync('character',character);}catch{}
    if(this.data.room&&this.data.user)return this.run(async()=>{this.accept(await api.request('/api/rooms/'+this.data.room.code+'/appearance','POST',{character}));});
  },
  subscribe(code){this.invite=null;wx.removeStorageSync('invitedRoom');if(this.stop)this.stop();this.stop=api.watchRoom(code,room=>this.accept(room),error=>this.fail(error));},
  accept(room){
    if(!acceptRoom(this.data.room,room))return;
    const role=room.characters&&room.characters[room.seat];
    this.setData({room,seatCards:room.seats.map((player,seat)=>({seat,player,ready:room.ready[seat]})),handsPerMatch:room.settings.handsPerMatch,error:'',...(role?{selectedCharacter:role}:{})});
    wx.setStorageSync('lastRoom',room.code);
    if(room.match&&room.match.status==='active'&&!this.navigating&&!this.stayInLobby)this.table();
  },
  table(){this.stayInLobby=false;this.navigating=true;wx.navigateTo({url:'/pages/table/index?room='+this.data.room.code});},
  send(input){return this.run(async()=>{try{this.accept(await api.command(this.data.room,input));}catch(error){if(error.status===409)this.accept(await api.request('/api/rooms/'+this.data.room.code));throw error;}});},
  ready(){return this.send({kind:'ready',ready:!this.data.room.ready[this.data.room.seat]});},
  saveSettings(){return this.send({kind:'settings',handsPerMatch:Number(this.data.handsPerMatch)});},
  sit(event){this.send({kind:'sit',seat:Number(event.currentTarget.dataset.seat)});},
  leave(){return this.run(async()=>{await api.command(this.data.room,{kind:'leave'});if(this.stop)this.stop();this.setData({room:null});});},
  history(){wx.navigateTo({url:'/pages/replays/index'});},
  calculator(){wx.navigateTo({url:'/pages/verify/index'});},
  copy(){wx.setClipboardData({data:this.data.room.code});},
  onShareAppMessage(){const room=this.data.room&&!this.data.room.testMode?this.data.room:null;return {title:room?'来好友麻将一起玩 · 房间 '+room.code:'邀请你来好友麻将一起玩',path:'/pages/lobby/index'+(room?'?room='+room.code:'')};},
});
