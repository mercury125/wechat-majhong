'use strict';
const fs=require('node:fs');
const path=require('node:path');
const {compileFunction,Script}=require('node:vm');
const {createHash}=require('node:crypto');
const root=path.resolve(__dirname,'..');
let count=0;
function walk(folder){
  for(const item of fs.readdirSync(folder,{withFileTypes:true})){
    const filename=path.join(folder,item.name);
    if(item.isDirectory()){if(item.name!=='assets')walk(filename);}
    else if(filename.endsWith('.js')){compileFunction(fs.readFileSync(filename,'utf8'),['require','module','exports','__filename','__dirname'],{filename});count++;}
    else if(filename.endsWith('.json'))JSON.parse(fs.readFileSync(filename,'utf8'));
  }
}
for(const folder of ['server','miniprogram','cloudfunctions','scripts','test'])walk(path.join(root,folder));
const app=JSON.parse(fs.readFileSync(path.join(root,'miniprogram/app.json'),'utf8'));
for(const page of app.pages)for(const extension of ['js','json','wxml','wxss'])if(!fs.existsSync(path.join(root,'miniprogram',page+'.'+extension)))throw new Error('Missing page file: '+page+'.'+extension);
const provenance=require('../miniprogram/lib/vendor/provenance.json');
for(const file of provenance.files)if(createHash('sha256').update(fs.readFileSync(path.join(root,'miniprogram/lib/vendor',file.file))).digest('hex')!==file.sha256)throw new Error('Vendored source changed: '+file.file);
const harness=fs.readFileSync(path.join(root,'tools/dev.html'),'utf8');
for(const script of harness.matchAll(/<script>([\s\S]*?)<\/script>/g))new Script(script[1]);
console.log('Syntax/configuration checked for '+count+' JavaScript files and the development harness; all native page files and vendored hashes are present.');
