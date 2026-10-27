'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');

function client(){
  const calls=[],timers=[],logs=[],removed=[];
  const context={
    module:{exports:{}},require:()=>({cloudEnv:'test-env',cloudPollMs:100}),
    wx:{cloud:{callFunction(options){calls.push(options);}},removeStorageSync(key){removed.push(key);}},
    console:{error(...args){logs.push(args);}},
    setTimeout(fn,ms){const timer={fn,ms};timers.push(timer);return timer;},clearTimeout(timer){if(timer)timer.cancelled=true;},
  };
  vm.runInNewContext(fs.readFileSync('miniprogram/lib/api.js','utf8'),context);
  const reply=async result=>{calls.at(-1).success({result});await new Promise(setImmediate);};
  return {api:context.module.exports,calls,timers,logs,removed,reply};
}

test('cloud failures preserve diagnostic fields and log the action without logging request data',async()=>{
  const app=client();
  const request=app.api.request('/api/rooms','POST',{handsPerMatch:1,testMode:true});
  const rejected=assert.rejects(request,error=>error.status===500&&error.code==='DATABASE_ERROR'&&error.detail==='Cannot create field id in match: null'&&error.message==='云端服务暂时异常，请稍后重试');
  await app.reply({ok:false,status:500,error:'云端服务暂时异常，请稍后重试',code:'DATABASE_ERROR',detail:'Cannot create field id in match: null'});
  await rejected;
  assert.equal(app.logs.length,1);assert.equal(app.logs[0][1].action,'createRoom');
  assert.deepEqual(Object.keys(app.logs[0][1]).sort(),['action','code','detail','status']);
});

test('cloud transport failures keep the platform error code and detail',async()=>{
  const app=client(),request=app.api.request('/api/me');
  const rejected=assert.rejects(request,error=>error.code===-504003&&error.detail==='cloud.callFunction:fail timeout'&&error.message.includes('云函数调用失败'));
  app.calls[0].fail({errCode:-504003,errMsg:'cloud.callFunction:fail timeout'});await rejected;
  assert.equal(app.logs.length,1);assert.equal(app.logs[0][1].action,'me');assert.equal(app.logs[0][1].code,-504003);
});

test('cloud polling backs off on failures, clears stale errors after recovery, and restores its normal interval',async()=>{
  const app=client(),rooms=[],errors=[];
  const stop=app.api.watchRoom('ABCD1234',room=>rooms.push(room),error=>errors.push(error));
  await app.reply({ok:true,data:{code:'ABCD1234',revision:7}});
  assert.equal(rooms.length,1);assert.equal(app.timers.at(-1).ms,300);
  for(const expected of [1000,2000,4000,8000,15000,15000]){
    app.timers.at(-1).fn();await app.reply({ok:false,status:500,error:'云端服务暂时异常，请稍后重试'});
    assert.equal(app.timers.at(-1).ms,expected);
  }
  assert.equal(errors.length,6);
  app.timers.at(-1).fn();await app.reply({ok:true,data:{code:'ABCD1234',revision:7}});
  assert.equal(rooms.length,2,'a successful same-revision response clears the page error');
  assert.equal(app.timers.at(-1).ms,300);
  app.timers.at(-1).fn();await app.reply({ok:true,data:{code:'ABCD1234',revision:7}});
  assert.equal(rooms.length,2,'ordinary unchanged polls still avoid table rendering');
  const count=app.calls.length;stop();assert.equal(app.timers.at(-1).cancelled,true);app.timers.at(-1).fn();assert.equal(app.calls.length,count);
});

test('cloud polling stops on authentication or membership failure and ignores replies after cancellation',async()=>{
  for(const status of [401,403]){
    const app=client(),errors=[];
    app.api.watchRoom('ABCD1234',()=>assert.fail('No room is available'),error=>errors.push(error));
    await app.reply({ok:false,status,error:'没有访问权限'});
    assert.equal(errors.length,1);assert.equal(app.timers.length,0);
    assert.deepEqual(app.removed,status===401?['sessionToken','user']:[]);
  }
  const app=client(),stop=app.api.watchRoom('ABCD1234',()=>assert.fail('Cancelled room callback'),()=>assert.fail('Cancelled error callback'));
  stop();await app.reply({ok:true,data:{revision:1}});assert.equal(app.timers.length,0);
});

test('cloud polling sends its revision, skips unchanged responses, and requests a full snapshot after errors',async()=>{
  const app=client(),rooms=[],errors=[];
  const stop=app.api.watchRoom('ABCD1234',room=>rooms.push(room),error=>errors.push(error));
  assert.equal(app.calls[0].data.data.after,undefined);
  await app.reply({ok:true,data:{code:'ABCD1234',revision:7}});
  app.timers.at(-1).fn();assert.equal(app.calls.at(-1).data.data.after,7);
  await app.reply({ok:true,data:{code:'ABCD1234',revision:7,unchanged:true}});
  assert.equal(rooms.length,1);assert.equal(app.timers.at(-1).ms,300);
  app.timers.at(-1).fn();await app.reply({ok:false,status:500,error:'云端服务暂时异常，请稍后重试'});
  app.timers.at(-1).fn();assert.equal(app.calls.at(-1).data.data.after,undefined);
  await app.reply({ok:true,data:{code:'ABCD1234',revision:7}});
  assert.equal(rooms.length,2,'a full snapshot clears an error even at the previous revision');assert.equal(errors.length,1);
  app.timers.at(-1).fn();assert.equal(app.calls.at(-1).data.data.after,7);
  await app.reply({ok:true,data:{code:'ABCD1234',revision:8}});
  assert.equal(rooms.at(-1).revision,8);stop();
});
