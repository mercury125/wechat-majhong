'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {createRequire}=require('node:module');

function entry(failure,createCollection=async()=>{}){
  const filename=path.resolve('cloudfunctions/api/index.js'),nativeRequire=createRequire(filename),exports={},logs=[];
  vm.runInNewContext(fs.readFileSync(filename,'utf8'),{
    exports,console:{error(...args){logs.push(args);},warn(){}},
    require(name){
      if(name==='wx-server-sdk')return {init(){},database:()=>({createCollection}),getWXContext:()=>({OPENID:'private-player-id'})};
      if(name==='./handler')return {async handleAction(){throw failure;}};
      return nativeRequire(name);
    },
  });
  return {main:exports.main,logs};
}

test('cloud entry preserves WeChat SDK errCode and errMsg when room creation fails',async()=>{
  for(const failure of [
    {errCode:-502001,errMsg:'database operation failed'},
    Object.assign(new Error('database operation failed'),{errCode:-502001}),
  ]){
    const app=entry(failure),result=await app.main({action:'createRoom',data:{privateValue:'not-for-logs'}});
    assert.equal(result.ok,false);assert.equal(result.status,500);assert.equal(result.code,-502001);assert.equal(result.detail,'database operation failed');
    assert.equal(result.error,'云端服务暂时异常，请稍后重试');assert.equal(app.logs.length,1);
    assert.equal(app.logs[0][1].action,'createRoom');assert.equal(app.logs[0][1].code,-502001);
    assert.doesNotMatch(JSON.stringify(app.logs),/private-player-id|not-for-logs/);
  }
});

test('cloud entry preserves ordinary command errors without logging them as server failures',async()=>{
  const app=entry(Object.assign(new Error('牌桌状态已更新，请刷新后重试'),{status:409,code:'ROOM_REVISION_CONFLICT'}));
  const result=await app.main({action:'command'});
  assert.equal(result.status,409);assert.equal(result.code,'ROOM_REVISION_CONFLICT');assert.equal(result.error,'牌桌状态已更新，请刷新后重试');assert.equal(app.logs.length,0);
});

test('cold initialization starts collection checks together and shares them across concurrent calls',async()=>{
  const started=[],pending=[];
  const app=entry(new Error('handler fixture'),name=>new Promise(resolve=>{started.push(name);pending.push(resolve);}));
  const first=app.main({action:'createRoom'}),second=app.main({action:'me'});
  assert.deepEqual(started,['users','rooms','matches','history']);assert.equal(app.logs.length,0);
  for(const resolve of pending)resolve();await Promise.all([first,second]);
  await app.main({action:'me'});assert.equal(started.length,4,'warm calls do not repeat initialization');
});
