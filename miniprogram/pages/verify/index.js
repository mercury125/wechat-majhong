'use strict';
const api=require('../../lib/api');
const {calculateWall,verifyHand,verifyMatch}=require('../../lib/replay');
const example=require('../../lib/example');
const {fail:setError}=require('../../lib/room-state');
Page({
  data:{inputText:'',report:null,error:'',busy:false,source:'粘贴牌山、完整小局或整场牌谱数据'},
  async onLoad(query){if(query.match){try{const match=await api.request('/api/matches/'+query.match);const value=query.hand?match.hands.find(hand=>hand.handNo===Number(query.hand)):match;if(!value)throw new Error('未找到已完成的小局');this.value=value;this.setData({source:'已载入完整牌谱',inputText:JSON.stringify(value,null,2)});this.calculate();}catch(error){this.fail(error);}}},
  fail(error){setError(this,error,'无法验证数据，请检查格式后重试。');this.setData({busy:false});},
  input(event){this.value=null;this.setData({inputText:event.detail.value,report:null,error:''});},
  calculate(){
    this.setData({busy:true,error:''});
    try{
      if(this.data.inputText.length>8*1024*1024)throw new Error('输入数据不能超过 8 MB');
      const value=this.value||JSON.parse(this.data.inputText);
      if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('请提供包含牌山、完整小局或整场牌谱的 JSON 对象');
      let report;
      if(Object.prototype.hasOwnProperty.call(value,'hands')){const observed={};if(Array.isArray(value.hands))value.hands.forEach(hand=>{if(hand)observed[hand.handNo]=api.observedCode(hand);});report=verifyMatch(value,observed);}
      else if(value.commands)report=verifyHand(value,api.observedCode(value));
      else {const input={...value,...(value.context||{})};report=calculateWall(input,api.observedCode(input));}
      this.value=value;this.setData({report,busy:false});
    }catch(error){this.fail(error);}
  },
  sample(){const value={...example,description:'公开确定性测试示例，严禁用作正式对局种子。',wall:example.expected.wall,wallCode:example.expected.wallCode};delete value.expected;this.value=value;this.setData({inputText:JSON.stringify(value,null,2),source:'公开测试示例，请勿用于正式对局'});this.calculate();},
  async import(){try{const value=await api.importJson();this.value=value;this.setData({inputText:JSON.stringify(value,null,2),source:'已导入牌谱文件'});this.calculate();}catch(error){this.fail(error);}},
  paste(){wx.getClipboardData({success:result=>{this.value=null;this.setData({inputText:result.data,source:'已粘贴数据'});this.calculate();},fail:error=>this.fail(error)});},
  copy(){if(this.data.report&&this.data.report.calculatedCode)wx.setClipboardData({data:this.data.report.calculatedCode});},
  back(){wx.navigateBack();},
});
