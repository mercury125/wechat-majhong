'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {tile}=require('../miniprogram/lib/tiles');

test('native package keeps every tile local within the main-package and media budgets',()=>{
  const root=path.resolve(__dirname,'../miniprogram');
  const images=new Set(['/assets/tiles/Front.png',tile(null).image,...Array.from({length:108},(_,id)=>tile(id).image)]);
  assert.equal(images.size,29);
  for(const image of images){
    const data=fs.readFileSync(path.join(root,image));
    assert.equal(data.subarray(0,8).toString('hex'),'89504e470d0a1a0a',image);
    assert.equal(data.readUInt32BE(16),240,image);
    assert.equal(data.readUInt32BE(20),320,image);
    const transparency=data.indexOf(Buffer.from('tRNS'));
    assert.ok(transparency>0,'Tile transparency must be retained: '+image);
    const alpha=data.subarray(transparency+4,transparency+4+data.readUInt32BE(transparency-4));
    assert.ok(alpha.includes(0),'Tile backgrounds must remain fully transparent: '+image);
  }
  let total=0,media=0;
  for(const file of fs.readdirSync(root,{recursive:true})){
    const info=fs.statSync(path.join(root,file));
    if(!info.isFile())continue;
    total+=info.size;
    if(/\.(?:png|jpe?g|gif|webp|svg|mp3|wav|ogg|aac|m4a)$/i.test(file))media+=info.size;
  }
  assert.ok(total<1500000,'Source main-package budget exceeded: '+total+' bytes');
  assert.ok(media<200000,'Bundled media budget exceeded: '+media+' bytes');
});

test('native pages register the tile component only where required for lazy loading',()=>{
  const root=path.resolve(__dirname,'../miniprogram'),app=require('../miniprogram/app.json');
  assert.equal(app.lazyCodeLoading,'requiredComponents');
  assert.equal(app.usingComponents&&app.usingComponents['mahjong-tile'],undefined);
  for(const page of app.pages){
    const config=JSON.parse(fs.readFileSync(path.join(root,page+'.json'),'utf8'));
    const usesTile=fs.readFileSync(path.join(root,page+'.wxml'),'utf8').includes('<mahjong-tile');
    assert.equal(config.usingComponents&&config.usingComponents['mahjong-tile'],usesTile?'/components/tile/index':undefined,page);
  }
});
