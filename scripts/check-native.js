'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {TmplGroup}=require('glass-easel-template-compiler');
const {StyleSheetTransformer}=require('glass-easel-stylesheet-compiler');
const root=path.resolve(__dirname,'../miniprogram');
const group=TmplGroup.newDev();
let templates=0,styles=0;
const diagnostics=[];
try{
  const invalid=group.addTmpl('invalid-self-check.wxml','<view>{{ broken + }}</view>');
  assert.ok(invalid.some(item=>item.isError),'Compiler self-check must reject malformed WXML');
  group.removeTmpl('invalid-self-check.wxml');
  function walk(folder){
    for(const entry of fs.readdirSync(folder,{withFileTypes:true})){
      const filename=path.join(folder,entry.name);
      const relative=path.relative(root,filename).replaceAll(path.sep,'/');
      if(entry.isDirectory()){if(entry.name!=='assets')walk(filename);continue;}
      if(filename.endsWith('.wxml')){diagnostics.push(...group.addTmpl(relative,fs.readFileSync(filename,'utf8')));templates++;}
      if(filename.endsWith('.wxss')){
        const sheet=new StyleSheetTransformer(relative,fs.readFileSync(filename,'utf8'),undefined,750,false);
        try{diagnostics.push(...sheet.extractWarnings());sheet.getContent();styles++;}finally{sheet.free();}
      }
    }
  }
  walk(root);
  assert.ok(templates>0&&styles>0,'No native source was checked');
  if(diagnostics.length){console.error(JSON.stringify(diagnostics,null,2));process.exitCode=1;}
  else console.log('Official glass-easel 1.2.1 compilers: '+templates+' WXML templates and '+styles+' WXSS files compiled with no diagnostics. Account-backed DevTools and real-device validation remain separate.');
}finally{group.free();}
