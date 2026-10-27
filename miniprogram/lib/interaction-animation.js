'use strict';

function interactionAnimations(motion,now=Date.now()) {
  const lifetime=motion.expiresAt-motion.startedAt,age=Math.max(0,(now-motion.startedAt)/lifetime);
  if(!Number.isFinite(age)||age>=1)return [];
  const {dx,dy,bucketX,lift}=motion,target={x:dx,y:dy},bucket={x:dx+bucketX,y:dy-lift},tip=bucketX>0?-65:65;
  const frame=(offset,values={})=>({offset,x:0,y:0,angle:0,sx:1,sy:1,opacity:1,...values});
  const track=(part,frames)=>{
    const next=frames.findIndex(frame=>frame.offset>age),before=frames[Math.max(0,next-1)],after=frames[next];
    const amount=(age-before.offset)/(after.offset-before.offset),first={offset:age};
    for(const key of ['x','y','angle','sx','sy','opacity'])first[key]=before[key]+(after[key]-before[key])*amount;
    return {part,keyFrames:[first,...frames.slice(next)].map(f=>{
      const angle=f.angle*Math.PI/180,cos=Math.cos(angle),sin=Math.sin(angle);
      return {offset:(f.offset-age)/(1-age),opacity:f.opacity,matrix:[cos*f.sx,sin*f.sx,-sin*f.sy,cos*f.sy,f.x,f.y]};
    })};
  };
  if(motion.effect==='water') {
    const eyes=[frame(0),frame(.47),frame(.5,{sy:.08}),frame(.52,{sy:.08}),frame(.55),frame(.71),frame(.74,{sy:.08}),frame(.77,{sy:.08}),frame(.8),frame(1)];
    return [
      track('bucket',[frame(0,{angle:-12,sx:.8,sy:.8}),frame(.1,{x:dx*.5,y:dy*.5-65,angle:12}),frame(.2,bucket),frame(.28,{...bucket,angle:tip}),frame(.41,{...bucket,angle:tip}),frame(.49,{...bucket,angle:tip,opacity:0}),frame(1,{...bucket,angle:tip,opacity:0})]),
      track('stream',[frame(0,{...target,sy:0,opacity:0}),frame(.26,{...target,sy:0,opacity:0}),frame(.31,target),frame(.43,target),frame(.5,{...target,sy:.3,opacity:0}),frame(1,{...target,sy:.3,opacity:0})]),
      track('cube',[frame(0,{...target,opacity:0}),frame(.35,{...target,opacity:0}),frame(.43,target),frame(.88,target),frame(1,{...target,opacity:0})]),
      track('eye-left',eyes),track('eye-right',eyes),
    ];
  }
  return [
    track('projectile',[frame(0,{angle:-20,sx:.9,sy:.9}),frame(.12,{x:dx*.5,y:dy*.5-65,angle:130}),frame(.23,{...target,angle:245,sx:.9,sy:.9}),frame(.25,{...target,angle:260,sx:.4,sy:.4,opacity:0}),frame(1,{...target,angle:260,sx:.4,sy:.4,opacity:0})]),
    track('burst',[frame(0,{sx:.2,sy:.2,opacity:0}),frame(.22,{sx:.2,sy:.2,opacity:0}),frame(.26,{sx:.75,sy:.75}),frame(.38,{sx:1.6,sy:1.6,opacity:0}),frame(1,{sx:1.6,sy:1.6,opacity:0})]),
    track('stain',[frame(0,{sx:.2,sy:.2,opacity:0}),frame(.23,{sx:.2,sy:.2,opacity:0}),frame(.31,{sx:1.15,sy:1.15}),frame(.4),frame(.82),frame(1,{sx:1.05,sy:1.05,opacity:0})]),
    ...motion.pieces.map(piece=>track('piece-'+piece.key,[frame(0,{sx:.2,sy:.2,opacity:0}),frame(.22,{sx:.2,sy:.2,opacity:0}),frame(.25),frame(.44,{x:piece.x,y:piece.y,angle:piece.turn,sx:.75,sy:.75}),frame(.61,{x:piece.x,y:piece.y,angle:piece.turn,sx:.25,sy:.25,opacity:0}),frame(1,{x:piece.x,y:piece.y,angle:piece.turn,sx:.25,sy:.25,opacity:0})])),
  ];
}

module.exports={interactionAnimations};
