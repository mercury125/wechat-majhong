'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');

test('mini-program app initializes wx.cloud before any cloud API call',()=>{
  let definition, initialized, invited;
  const wx={
    cloud:{init(options){initialized=options;}},
    setStorageSync(key,value){if(key==='invitedRoom')invited=value;},
  };
  vm.runInNewContext(fs.readFileSync('miniprogram/app.js','utf8'),{
    wx,
    App(value){definition=value;},
    require(path){if(path==='./config')return {cloudEnv:'cloud-env-1'};throw new Error('unexpected require '+path);},
    console,
  });
  definition.onLaunch();
  assert.equal(initialized.env,'cloud-env-1');assert.equal(initialized.traceUser,true);
  definition.onShow({query:{room:'abcd1234'}});
  assert.equal(invited,'ABCD1234');
});
