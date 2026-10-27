'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');

function load(config, wx){
  const context={module:{exports:{}},require(path){if(path==='../config')return config;throw new Error('unexpected require '+path);},wx,console};
  vm.runInNewContext(fs.readFileSync('miniprogram/lib/cloud-assets.js','utf8'),context);
  return context.module.exports;
}

test('cloud character assets use temporary HTTPS URLs instead of cloud file IDs',async()=>{
  const config={cloudEnv:'env-1',cloudPollMs:1000,assetBase:'cloud://env.bucket',cloudAssetExtension:'.png'};
  const calls=[];
  const wx={cloud:{getTempFileURL(options){
    calls.push(options.fileList);
    options.success({fileList:options.fileList.map((fileID,index)=>fileID.endsWith('.png')
      ? {fileID,tempFileURL:'https://signed.example/'+index+'.png'}
      : {fileID,status:-1,errMsg:'not found'})});
  }}};
  const assets=load(config,wx);
  const path='/assets/characters/ironclad-sheet.webp';
  assert.equal(assets.assetUrl(path),'');
  await assets.ensure();
  assert.equal(calls.length,1);assert.equal(calls[0].length,4);
  assert.match(assets.assetUrl(path),/^https:\/\/signed\.example\/.*\.png$/);
  assert.match(assets.assetUrl('/assets/characters/silent-sheet.webp'),/^https:\/\/signed\.example\/.*\.png$/);
});

test('cloud assets fall back to the cloud function when direct storage access is denied',async()=>{
  const config={cloudEnv:'env-1',cloudPollMs:1000,assetBase:'cloud://env.bucket',cloudAssetExtension:'.png'};
  const functionCalls=[];
  const wx={
    cloud:{
      getTempFileURL(options){options.fail({errMsg:'STORAGE_EXCEED_AUTHORITY'});},
      callFunction(options){
        functionCalls.push(options.data);
        const fileList=options.data.data.fileList.map((fileID,index)=>({fileID,tempFileURL:'https://admin.example/'+index+'.png'}));
        options.success({result:{ok:true,data:{fileList}}});
      },
    },
  };
  const assets=load(config,wx);
  await assets.ensure();
  assert.equal(functionCalls.length,1);
  assert.equal(functionCalls[0].action,'assetUrls');
  assert.equal(functionCalls[0].data.fileList.length,4);
  assert.match(assets.assetUrl('/assets/characters/ironclad-sheet.webp'),/^https:\/\/admin\.example\//);
});

test('asset batches retry only missing files and preserve PNG/WebP fallback',async()=>{
  const direct=[],fallback=[];
  const assets=load({cloudEnv:'env-1',assetBase:'cloud://env.bucket',cloudAssetExtension:'.png'},{cloud:{
    getTempFileURL(options){
      direct.push(options.fileList);
      options.success({fileList:options.fileList.map(fileID=>fileID.includes('silent')||fileID.includes('watcher')&&fileID.endsWith('.png')
        ? {fileID,status:-1,tempFileURL:'https://invalid.example/file',errMsg:'unavailable'}
        : {fileID,status:0,tempFileURL:'https://direct.example/'+fileID.split('/').at(-1)})});
    },
    callFunction(options){
      const files=options.data.data.fileList;fallback.push(files);
      options.success({result:{ok:true,data:{fileList:files.map(fileID=>fileID.includes('silent')
        ? {fileID,status:0,tempFileURL:'https://fallback.example/silent.png'}
        : {fileID,status:-1,errMsg:'not found'})}}});
    },
  }});
  await Promise.all([assets.ensure(),assets.ensure()]);
  assert.equal(direct.length,2);assert.equal(direct[0].length,4);assert.equal(direct[1].length,1);assert.match(direct[1][0],/watcher-sheet\.webp$/);
  assert.equal(fallback.length,1);assert.equal(fallback[0].length,2);
  assert.match(assets.assetUrl('/assets/characters/ironclad-sheet.webp'),/^https:\/\/direct\.example\/ironclad-sheet\.png$/);
  assert.equal(assets.assetUrl('/assets/characters/silent-sheet.webp'),'https://fallback.example/silent.png');
  assert.match(assets.assetUrl('/assets/characters/watcher-sheet.webp'),/^https:\/\/direct\.example\/watcher-sheet\.webp$/);
  await assets.ensure();assert.equal(direct.length,2);
});
