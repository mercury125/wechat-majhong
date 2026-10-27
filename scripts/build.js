'use strict';
const fs=require('node:fs');
const path=require('node:path');
const {createHash}=require('node:crypto');
const root=path.resolve(__dirname,'..');
const manifest=require('../assets/tiles/manifest.json');
const output=path.join(root,'miniprogram/assets/tiles');
fs.mkdirSync(output,{recursive:true});
for(const item of manifest.files){
  const data=fs.readFileSync(path.join(root,'assets/tiles',item.file));
  if(data.length!==item.bytes||createHash('sha256').update(data).digest('hex')!==item.sha256)throw new Error('Asset integrity failed: '+item.file);
  // Keep pinned originals for provenance and bundle the smaller display copies.
  const bundled=item.file.endsWith('.png')?fs.readFileSync(path.join(root,'assets/tiles/miniprogram',item.file)):data;
  fs.writeFileSync(path.join(output,item.file),bundled);
}
const fixture=require('../docs/fixtures/shuffle-v1-friends-v3.json');
fs.writeFileSync(path.join(root,'miniprogram/lib/example.js'),"'use strict';\n// Generated from docs/fixtures/shuffle-v1-friends-v3.json by npm run build.\nmodule.exports = "+JSON.stringify(fixture,null,2)+';\n');

// Cloud functions are uploaded as isolated directories, so copy the shared
// pure-JavaScript rule modules they need into the function package.
const cloudShared=path.join(root,'cloudfunctions/api/shared');
const cloudVendor=path.join(cloudShared,'vendor');
fs.mkdirSync(cloudVendor,{recursive:true});
for(const file of ['engine.js','rules.js','shuffle.js','tiles.js','replay.js','cosmetics.js']) {
  fs.copyFileSync(path.join(root,'miniprogram/lib',file),path.join(cloudShared,file));
}
fs.copyFileSync(path.join(root,'miniprogram/lib/vendor/sha256.js'),path.join(cloudVendor,'sha256.js'));
const botSource=fs.readFileSync(path.join(root,'server/bots.js'),'utf8')
  .replace("require('../miniprogram/lib/engine')","require('./engine')");
fs.writeFileSync(path.join(cloudShared,'bots.js'),botSource);
console.log('Prepared 29 local tile PNGs, the public verification example and cloud-function shared modules.');
