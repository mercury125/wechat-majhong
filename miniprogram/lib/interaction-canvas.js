'use strict';

const {interactionAnimations}=require('./interaction-animation');

function paintInteraction(ctx,motion,now) {
  const tracks=interactionAnimations(motion,now),poses=Object.fromEntries(tracks.map(track=>[track.part,track.keyFrames[0]]));
  const ellipse=(x,y,rx,ry,color)=>{ctx.beginPath();ctx.ellipse(x,y,rx,ry,0,0,Math.PI*2);ctx.fillStyle=color;ctx.fill();};
  const part=(name,draw,impact=false)=>{
    const pose=poses[name];if(!pose||pose.opacity<=0)return;
    ctx.save();ctx.translate(motion.x+(impact?motion.dx:0),motion.y+(impact?motion.dy:0));ctx.transform(...pose.matrix);ctx.globalAlpha=pose.opacity;draw();ctx.restore();
  };
  const roundRect=(x,y,w,h,r)=>{
    ctx.beginPath();ctx.moveTo(x+r,y);ctx.arcTo(x+w,y,x+w,y+h,r);ctx.arcTo(x+w,y+h,x,y+h,r);ctx.arcTo(x,y+h,x,y,r);ctx.arcTo(x,y,x+w,y,r);ctx.closePath();
  };
  if(motion.effect==='water'){
    part('bucket',()=>{
      ctx.strokeStyle='#c5d5df';ctx.lineWidth=3;ctx.beginPath();ctx.arc(0,-9,19,Math.PI,Math.PI*2);ctx.stroke();
      const metal=ctx.createLinearGradient(-23,0,23,0);metal.addColorStop(0,'#7497ad');metal.addColorStop(.4,'#d3e3ea');metal.addColorStop(1,'#526d84');
      roundRect(-23,-8,46,36,8);ctx.fillStyle=metal;ctx.fill();ctx.strokeStyle='#526d84';ctx.stroke();ellipse(0,-8,22,6,'#7ee1fb');
    });
    part('stream',()=>{
      const water=ctx.createLinearGradient(-7,0,7,0);water.addColorStop(0,'#dffaff');water.addColorStop(.5,'#37bceb');water.addColorStop(1,'#93edff');
      ctx.fillStyle=water;ctx.fillRect(-7,-motion.lift,14,motion.lift+motion.side*.55);
    });
    part('cube',()=>{
      const side=motion.side,water=ctx.createLinearGradient(-side/2,-side/2,side/2,side/2);water.addColorStop(0,'#8ceaff');water.addColorStop(.55,'#45bde6');water.addColorStop(1,'#288ccc');
      roundRect(-side/2,-side/2,side,side,7);ctx.fillStyle=water;ctx.fill();ctx.strokeStyle='#b7f4ff';ctx.lineWidth=3;ctx.stroke();
      ctx.strokeStyle='#d6fbff';ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(-side*.4,-side*.32);ctx.quadraticCurveTo(0,-side*.22,side*.4,-side*.34);ctx.stroke();
      for(const [name,x] of [['eye-left',-side*.19],['eye-right',side*.19]]){
        ctx.save();ctx.translate(x,0);ctx.scale(1,poses[name].matrix[3]);ellipse(0,0,side*.075,side*.1,'#f4fdff');ellipse(side*.015,side*.025,side*.032,side*.055,'#173c59');ctx.restore();
      }
      ctx.strokeStyle='#194964';ctx.beginPath();ctx.arc(0,side*.14,side*.09,0,Math.PI);ctx.stroke();
    });
    return;
  }
  part('projectile',()=>{
    const red=ctx.createRadialGradient(-7,-8,1,0,0,24);red.addColorStop(0,'#ffb087');red.addColorStop(.45,'#f35936');red.addColorStop(1,'#ac1b22');ellipse(0,0,21,20,red);
    ctx.strokeStyle='#9e281d';ctx.lineWidth=2;ctx.stroke();
    for(const angle of [-.65,0,.65]){ctx.save();ctx.translate(0,-19);ctx.rotate(angle);ellipse(0,0,4,9,'#2a853d');ctx.restore();}
  });
  part('burst',()=>{ellipse(0,0,36,36,'#ff954a66');ctx.strokeStyle='#ffb354';ctx.lineWidth=4;ctx.stroke();},true);
  part('stain',()=>{
    for(const [x,y,r] of [[-22,-17,8],[24,8,9],[9,24,7],[14,-23,6],[-27,16,6]])ellipse(x,y,r,r,'#df3b28');
    ellipse(0,0,27,22,'#df3b28');ellipse(-10,-7,8,5,'#f67145');
  },true);
  for(const piece of motion.pieces)part('piece-'+piece.key,()=>{ellipse(0,0,8,6,'#ee482e');ellipse(1,0,1.5,2.5,'#ffdea1');},true);
}

// Match the seat CSS when a native node has not supplied its rectangle yet.
function avatarFallbacks(info,localSeat,menuTop=12){
  const vw=info.windowWidth,vh=info.windowHeight,safe=info.safeArea||{left:0,top:0,right:vw,bottom:vh};
  const left=safe.left||0,top=safe.top||0,width=(safe.right||vw)-left,height=(safe.bottom||vh)-top;
  const narrow=vw<=600,short=!narrow&&vh<=600,compact=vw<1100;
  const aw=short?50:narrow?52:compact?62:76,ah=short?58:narrow?60:compact?70:84,seatW=short?72:narrow?68:compact?80:104;
  const bounds=[
    {left:left+Math.max(narrow?12:short&&vh<360?120:short?70:60,width*.14),top:top+height-(narrow?76:short?90:120),width:narrow?32:short?44:56,height:narrow?38:short?50:64},
    {left:left+width-(narrow?8:16)-seatW/2-aw/2,top:top+height*(short?.24:narrow?.15:compact?.27:.28),width:aw,height:ah},
    {left:left+width*(narrow?.52:.66)-(short?44:aw)/2,top:top+(short?menuTop:narrow?10:height*.05),width:short?44:aw,height:short?44:ah},
    {left:left+(narrow?8:16)+seatW/2-aw/2,top:top+height*(short?.24:narrow?.15:compact?.27:.28),width:aw,height:ah},
  ];
  return Array.from({length:4},(_,seat)=>bounds[(seat-localSeat+4)%4]);
}

module.exports={paintInteraction,avatarFallbacks};
