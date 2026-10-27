'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {CloudDbStore}=require('../cloudfunctions/api/db-store');
const clone=value=>JSON.parse(JSON.stringify(value));

function database(initial){
  let saved=clone(initial);
  class Replacement{constructor(value){this.value=value;}}
  // Model the SDK's dotted-field updates, including empty objects being omitted.
  function write(target,key,value){
    if(value instanceof Replacement){target[key]=clone(value.value);return;}
    if(value!==null&&typeof value==='object'&&!Array.isArray(value)){
      if(!Object.keys(value).length)return;
      if(!(key in target))target[key]={};
      if(target[key]===null||typeof target[key]!=='object')throw new Error('Cannot create nested field in '+key);
      for(const [child,item] of Object.entries(value))write(target[key],child,item);
    }else target[key]=clone(value);
  }
  const db={
    command:{set:value=>new Replacement(value)},
    collection(name){
      assert.equal(name,'rooms');
      return {where(condition){
        return {async update({data}){
          assert.equal(Object.hasOwn(data,'_id'),false);
          if(condition._id!==saved._id||condition.revision!==saved.revision)return {stats:{updated:0}};
          const next=clone(saved);
          for(const [key,value] of Object.entries(data))write(next,key,value);
          saved=next;return {stats:{updated:1}};
        }};
      }};
    },
  };
  return {store:new CloudDbStore(db),get:()=>clone(saved)};
}

test('cloud room updates can replace a null match with a new match snapshot',async()=>{
  const original={_id:'ABCD1234',code:'ABCD1234',revision:1,matchId:null,match:null,controls:{},ready:[false,true,true,true]};
  const app=database(original),next={...original,revision:2,matchId:'new-match',match:{id:'new-match',hands:[],status:'active'},ready:[false,false,false,false]};
  await app.store.updateRoom(next,1);
  assert.deepEqual(app.get(),next);assert.equal(original.match,null);
});

test('cloud room snapshots clear old controls and interaction counts rather than merging them back',async()=>{
  const original={_id:'ABCD1234',code:'ABCD1234',revision:4,match:{id:'old-match',hands:[{handNo:1}]},controls:{player:{autoCut:true}},interactionState:{counts:{player:50},events:[{id:'old'}]},callNotices:[{id:'old-call'}]};
  const app=database(original),next={...original,revision:5,match:{id:'new-match',hands:[]},controls:{},interactionState:{counts:{},events:[]},callNotices:[]};
  await app.store.updateRoom(next,4);assert.deepEqual(app.get(),next);
  const ended={...next,revision:6,match:null};await app.store.updateRoom(ended,5);assert.deepEqual(app.get(),ended);
});

test('cloud room replacement retains the revision guard and does not overwrite a newer command',async()=>{
  const original={_id:'ABCD1234',code:'ABCD1234',revision:8,match:null,controls:{}};
  const app=database(original);
  await assert.rejects(app.store.updateRoom({...original,revision:9,match:{id:'stale'}},7),error=>error.status===409&&error.code==='ROOM_REVISION_CONFLICT');
  assert.deepEqual(app.get(),original);
});

test('four player profiles load in one query and an empty player list makes no query',async()=>{
  const users=Array.from({length:4},(_,index)=>({_id:'player-'+index,id:'player-'+index,name:'Player '+index}));
  let reads=0;
  const store=new CloudDbStore({command:{in:values=>({values})},collection(name){
    assert.equal(name,'users');
    return {where(condition){return {async get(){reads++;return {data:users.filter(user=>condition._id.values.includes(user._id)).reverse()};}};}};
  }});
  assert.deepEqual(await store.getUsers([]),[]);assert.equal(reads,0);
  const result=await store.getUsers(users.map(user=>user.id));
  assert.equal(reads,1);assert.deepEqual(new Set(result.map(user=>user.id)),new Set(users.map(user=>user.id)));
});

test('room lookup filters in the database and returns ten player rooms beyond unrelated records',async()=>{
  const unrelated=Array.from({length:1000},(_,index)=>({code:'other-'+index,seats:['other-player',null,null,null]}));
  const mine=Array.from({length:10},(_,index)=>({code:'mine-'+index,seats:[null,'player',null,null]}));
  const rows=unrelated.concat(mine),conditions=[];let reads=0,returned=0;
  const store=new CloudDbStore({command:{in:values=>({values})},collection(name){
    assert.equal(name,'rooms');
    let condition={},offset=0,limit=100;
    const query={where(value){condition=value;conditions.push(value);return this;},skip(value){offset=value;return this;},limit(value){limit=value;return this;},async get(){
      reads++;
      const data=rows.filter(room=>!condition.seats||room.seats.some(id=>condition.seats.values.includes(id))).slice(offset,offset+limit);
      returned+=data.length;return {data};
    }};
    return query;
  }});
  assert.deepEqual(await store.roomsForUser('player'),mine);assert.equal(reads,1);assert.equal(returned,10);assert.equal(conditions.length,1);
});
