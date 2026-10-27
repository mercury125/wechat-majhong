'use strict';
(function(root) {
  const characters = [
    {id:'ironclad',name:'战士',color:'#8e3235',pose:'执剑迎战',sheet:'/assets/characters/ironclad-sheet.webp'},
    {id:'silent',name:'猎人',color:'#28634b',pose:'双刃蓄势',sheet:'/assets/characters/silent-sheet.webp'},
    {id:'defect',name:'机器人',color:'#276889',pose:'唤起充能球',sheet:'/assets/characters/defect-sheet.webp'},
    {id:'watcher',name:'观者',color:'#69508b',pose:'持杖静心',sheet:'/assets/characters/watcher-sheet.webp'},
  ];
  const emotions = [
    {id:'greet',name:'你好',frame:1}, {id:'joy',name:'开心',frame:2},
    {id:'smug',name:'得意',frame:3}, {id:'shock',name:'震惊',frame:4},
    {id:'cry',name:'哭哭',frame:5},
  ];
  const commonEmotions = [
    {id:'common_laugh',name:'笑哭',emoji:'😂'}, {id:'common_like',name:'点赞',emoji:'👍'},
    {id:'common_think',name:'思考',emoji:'🤔'}, {id:'common_cry',name:'大哭',emoji:'😭'},
    {id:'common_shock',name:'惊呆',emoji:'😱'}, {id:'common_pray',name:'拜托',emoji:'🙏'},
    {id:'common_clap',name:'鼓掌',emoji:'👏'}, {id:'common_cool',name:'得意',emoji:'😎'},
  ];
  const defaults = characters.map(character=>character.id);
  const interactions = [{id:'water',name:'泼水',emoji:'🪣'},{id:'tomato',name:'丢番茄',emoji:'🍅'}];
  const character = (id,seat=0)=>characters.find(item=>item.id===id)||characters[seat%4]||characters[0];
  const emotion = id=>emotions.find(item=>item.id===id)||commonEmotions.find(item=>item.id===id);
  const api={characters,emotions,commonEmotions,interactions,defaults,character,emotion,emoteLifetime:3000,emoteCooldown:3000,interactionLimit:50,interactionLifetime:3000};
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.MahjongCosmetics=api;
})(typeof globalThis==='object'?globalThis:this);
