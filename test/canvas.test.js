'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {interactionLayout}=require('../miniprogram/lib/layout');
const {paintInteraction,avatarFallbacks}=require('../miniprogram/lib/interaction-canvas');

test('canvas paints visible water and tomato stages with balanced state and no expired drawings',()=>{
  const source={left:10,top:20,width:40,height:40},target={left:200,top:100,width:40,height:40};
  for(const effect of ['water','tomato']){
    const motion=interactionLayout({id:effect,playerId:'sender',effect,sentAt:new Date(1000).toISOString(),expiresAt:new Date(4000).toISOString()},source,target,1000);
    for(const age of [0,360,900,1350,1650,2700,3000]){
      const calls=[];let depth=0;
      const context=new Proxy({save(){depth++;},restore(){depth--;assert.ok(depth>=0);},createLinearGradient:()=>({addColorStop(){}}),createRadialGradient:()=>({addColorStop(){}})},{get(object,name){return name in object?object[name]:(...args)=>{assert.ok(args.every(value=>typeof value!=='number'||Number.isFinite(value)),name+' contains an invalid coordinate');calls.push({name,args});};}});
      paintInteraction(context,motion,1000+age);assert.equal(depth,0);
      assert.equal(calls.some(call=>call.name==='fill'),age<3000,effect+' at '+age+' ms');
      if(age===0)assert.deepEqual(calls.find(call=>call.name==='translate').args,[30,40],'delivery starts at the sender');
      if(age===1650)assert.deepEqual(calls.find(call=>call.name==='translate').args,[effect==='water'?30:220,effect==='water'?40:120]);
    }
  }
});

test('fallback avatars follow each viewer and remain inside notched landscape and narrow viewports',()=>{
  for(const [width,height] of [[844,390],[812,375],[667,320],[1280,720],[390,844],[320,844]]){
    const info={windowWidth:width,windowHeight:height,safeArea:{left:width>height&&width<900?44:0,right:width-(width>height&&width<900?44:0),top:0,bottom:height-20}};
    const baseline=avatarFallbacks(info,0);
    for(let seat=0;seat<4;seat++){
      const rectangles=avatarFallbacks(info,seat);assert.deepEqual(rectangles[seat],baseline[0]);
      for(const rect of rectangles){assert.ok(Object.values(rect).every(Number.isFinite));assert.ok(rect.width>0&&rect.height>0);assert.ok(rect.left>=0&&rect.top>=0&&rect.left+rect.width<=width&&rect.top+rect.height<=height);}
    }
  }
});

test('opposite avatar fallback starts beside the top hand row',()=>{
  const avatars=avatarFallbacks({windowWidth:844,windowHeight:390,safeArea:{left:44,top:0,right:800,bottom:370}},0,8);
  assert.deepEqual(avatars[2],{left:44+756*.66-22,top:8,width:44,height:44});
  const desktop=avatarFallbacks({windowWidth:1440,windowHeight:900},0);
  assert.deepEqual(desktop[2],{left:1440*.66-38,top:45,width:76,height:84});
});
