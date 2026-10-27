'use strict';

const {legalActions}=require('../miniprogram/lib/engine');
const crypto=require('node:crypto');

function botAction(hand,seat) {
  const actions=legalActions(hand,seat);
  const ack=actions.find(action=>action.kind==='ack');
  if(ack)return {...ack,code:hand.wallCode};
  // Test opponents leave self-draw wins for the human to exercise.
  const priority=actions.find(action=>action.kind.endsWith('Kong'))||
    actions.find(action=>action.kind==='pon')||
    actions.find(action=>action.kind==='float'&&action.tile===hand.lastDraw);
  if(priority)return priority;
  const discards=actions.filter(action=>action.kind==='discard');
  if(discards.length)return discards[crypto.randomInt(discards.length)];
  return actions.find(action=>action.kind==='float')||
    actions.find(action=>action.kind==='pass')||null;
}

function automaticAction(hand,seat,controls) {
  const actions=legalActions(hand,seat);
  if(controls.autoWin){const win=actions.find(action=>action.kind==='win');if(win)return win;}
  if(controls.skipCalls){const pass=actions.find(action=>action.kind==='pass');if(pass)return pass;}
  if(controls.autoCut&&hand.lastDraw!==null&&hand.lastDraw!==undefined){
    return actions.find(action=>action.tile===hand.lastDraw&&['discard','float'].includes(action.kind))||null;
  }
  return null;
}

module.exports={botAction,automaticAction};
