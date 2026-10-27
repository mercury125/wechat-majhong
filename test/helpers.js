'use strict';
const {Store}=require('../server/store');
const {Service}=require('../server/service');
let serial=0;

function table(options={}) {
  const store=new Store(options.filename||':memory:');
  let tick=0,seed=0;
  const service=new Service(store,{clock:()=>new Date(Date.UTC(2026,0,1)+tick++).toISOString(),dealer:()=>2,seed:()=>(seed++).toString(16).padStart(64,'0')});
  const logins=Array.from({length:5},(_,i)=>service.login('test:'+i,'Friend '+i));
  const users=logins.map(login=>service.authenticate(login.token));
  const room=service.createRoom(users[0],{handsPerMatch:options.handsPerMatch||1});
  for(let i=1;i<4;i++) service.join(users[i],room.code,{seat:i});
  const command=(seat,input)=>{
    const current=store.room(room.code);
    const match=current.matchId&&store.match(current.matchId);
    const hand=match&&match.hands[match.hands.length-1];
    return service.command(users[seat],room.code,{id:'test-'+serial++,...(hand?{matchId:match.id,handNo:hand.handNo}:{}),...input,expectedRevision:current.revision});
  };
  const start=()=>{let result;for(let i=0;i<4;i++)result=command(i,{kind:'ready',ready:true});return result;};
  return {store,service,logins,users,code:room.code,command,start};
}

function play(table, options={}) {
  const observed={};
  let moves=0;
  while(true) {
    const room=table.store.room(table.code);
    const match=table.store.match(room.matchId);
    const hand=match.hands[match.hands.length-1];
    observed[hand.handNo]=hand.wallCode;
    if(match.status==='complete') return {match,observed,moves};
    if(++moves>10000) throw new Error('Simulation did not terminate');
    let seat,action;
    if(hand.phase==='commit') {seat=hand.acknowledgements.findIndex(value=>!value);action={kind:'ack',code:hand.wallCode};}
    else if(hand.phase==='finished') {seat=match.continueReady.findIndex(value=>!value);action={kind:'continue'};}
    else {
      seat=hand.phase==='own'?hand.actor:hand.pending.responses.findIndex(value=>value===null);
      const actions=require('../miniprogram/lib/engine').legalActions(hand,seat);
      action=actions.find(a=>(!options.noWin||a.kind!=='win')&&['win','float','concealedKong','addedKong','exposedKong','pon'].includes(a.kind))||actions.find(a=>a.kind!=='win');
    }
    table.command(seat,action);
  }
}
module.exports={table,play};
