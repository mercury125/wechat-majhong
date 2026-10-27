'use strict';

const config = require('../config');
let serial = 0;
const actionId = () => 'wx_' + Date.now().toString(36) + '_' + serial++ + '_' + Math.random().toString(36).slice(2,10);
const token = () => wx.getStorageSync('sessionToken');
const authHeader = () => ({ Authorization: 'Bearer ' + token() });
const cloudEnabled = () => Boolean(config.cloudEnv);

function clearSession() {
  wx.removeStorageSync('sessionToken');
  wx.removeStorageSync('user');
}

function responseError(response, fallback) {
  const error = new Error(response.data && response.data.error || fallback);
  error.status = response.statusCode;
  if (error.status === 401) clearSession();
  return error;
}

function endpoint(path) {
  let release = false;
  if (wx.getAccountInfoSync) release = wx.getAccountInfoSync().miniProgram.envVersion === 'release';
  if (release && !cloudEnabled() && (config.development || !config.apiBase.startsWith('https://'))) throw new Error('发布前请关闭试玩模式，并配置正式的 HTTPS 服务地址，或改用云开发');
  return config.apiBase.replace(/\/$/, '') + path;
}

function cloudCall(action, data) {
  return new Promise((resolve, reject) => {
    if (!wx.cloud || typeof wx.cloud.callFunction !== 'function') return reject(new Error('当前微信基础库不支持云开发，请升级基础库'));
    wx.cloud.callFunction({
      name: 'api',
      data: { action, data: data || {} },
      success(response) {
        const result = response && response.result;
        if (result && result.ok) return resolve(result.data);
        const error = new Error(result && result.error || '云端请求失败');
        error.status = result && result.status || 500;
        error.code = result && result.code;
        error.detail = result && result.detail;
        if(error.status>=500)console.error('Cloud API failed:', {action,status:error.status,code:error.code,detail:error.detail});
        if (error.status === 401) clearSession();
        reject(error);
      },
      fail(cause) {
        const error = new Error('云函数调用失败：' + ((cause && cause.errMsg) || '请确认云开发环境与云函数已部署'));
        error.code = cause && (cause.errCode ?? cause.code);
        error.detail = cause && cause.errMsg;
        console.error('Cloud function call failed:', {action,code:error.code,detail:error.detail});
        reject(error);
      },
    });
  });
}

function cloudRequest(path, method = 'GET', data) {
  if (path === '/api/me' && method === 'GET') return cloudCall('me');
  if (path === '/api/me' && method === 'PATCH') return cloudCall('updateProfile', data);
  if (path === '/api/logout') return cloudCall('logout');
  if (path === '/api/rooms' && method === 'POST') return cloudCall('createRoom', data || {});
  if (path === '/api/history' && method === 'GET') return cloudCall('history');
  const replay = /^\/api\/matches\/([a-f0-9-]{36})$/.exec(path);
  if (replay && method === 'GET') return cloudCall('exportMatch', { matchId: replay[1] });
  const route = /^\/api\/rooms\/([A-Z0-9]{8})(?:\/(join|commands|appearance|emotes|interactions|controls))?$/.exec(path);
  if (route) {
    const [, code, operation] = route;
    if (!operation && method === 'GET') return cloudCall('view', { code });
    if (operation === 'join' && method === 'POST') return cloudCall('join', { code, input:data || {} });
    if (operation === 'commands' && method === 'POST') return cloudCall('command', { code, input:data || {} });
    if (operation === 'controls' && ['POST','PATCH'].includes(method)) return cloudCall('controls', { code, input:data || {} });
    if (['appearance','emotes','interactions'].includes(operation) && method === 'POST') return cloudCall('social', { code, kind:operation, input:data || {} });
  }
  return Promise.reject(new Error('云端接口不存在：' + method + ' ' + path));
}

function request(path, method = 'GET', data) {
  if (cloudEnabled()) return cloudRequest(path, method, data);
  return new Promise((resolve, reject) => {
    wx.request({
      // WeChat's request method list excludes PATCH; these endpoints also accept POST.
      url: endpoint(path), method: method==='PATCH'?'POST':method, data, timeout: 20000,
      header: { 'content-type': 'application/json', ...authHeader() },
      success(response) {
        if (response.statusCode >= 200 && response.statusCode < 300) resolve(response.data);
        else reject(responseError(response, '请求失败，请稍后重试'));
      },
      fail(error) {
        let message='无法连接游戏服务器，请确认服务已启动';
        if(/not in domain list/i.test(error&&error.errMsg||''))message='请求域名未通过校验，请配置服务器的合法域名'+(config.development?'；仅本地试玩可在开发者工具中关闭域名校验':'');
        else if(config.development)message='无法连接游戏服务器（'+config.apiBase+'）。请在电脑项目目录运行 npm run dev；真机调试请配置可访问的 HTTPS 服务地址';
        reject(new Error(message));
      },
    });
  });
}

async function login(name) {
  if (cloudEnabled()) {
    const result = await cloudCall('login', { name });
    wx.setStorageSync('sessionToken', result.token || 'cloud-session');
    wx.setStorageSync('user', result.user);
    return result.user;
  }
  let result;
  if (config.development) result = await request('/api/login/dev', 'POST', {name});
  else {
    const response = await new Promise((resolve,reject)=>wx.login({success:resolve,fail:reject}));
    result = await request('/api/login/wechat','POST',{code:response.code,name});
  }
  wx.setStorageSync('sessionToken',result.token);wx.setStorageSync('user',result.user);
  return result.user;
}

function command(room, input) {
  const hand=room.match&&room.match.hand;
  return request('/api/rooms/'+room.code+'/commands','POST',{
    id:actionId(),expectedRevision:room.revision,
    ...(hand?{matchId:hand.matchId,handNo:hand.handNo}:{}),...input,
    ...(input.kind==='ready'?{matchId:room.matchId||(hand&&hand.matchId),handsPerMatch:room.settings.handsPerMatch}:{}),
  });
}

function watchRoom(code, onRoom, onError) {
  if (cloudEnabled()) {
    let stopped=false,timer,lastRevision,failures=0;
    const poll=async()=>{
      if(stopped)return;
      try {
        const room=await cloudCall('view',{code,...(!failures&&lastRevision!==undefined?{after:lastRevision}:{})});
        if(stopped)return;
        if(!room.unchanged&&(failures||room.revision!==lastRevision)){lastRevision=room.revision;onRoom(room);}
        failures=0;
      } catch(error) {
        if(stopped)return;
        failures++;
        onError(error);
        if(error.status===401||error.status===403)stopped=true;
      } finally {
        const interval=Math.max(300,Number(config.cloudPollMs)||1000);
        const retryDelay=failures?Math.min(15000,1000*2**(failures-1)):0;
        if(!stopped)timer=setTimeout(poll,Math.max(interval,retryDelay));
      }
    };
    poll();
    return ()=>{stopped=true;clearTimeout(timer);};
  }
  let stopped=false,task,timer,revision;
  function poll() {
    if(stopped) return;
    try {
      task=wx.request({url:endpoint('/api/rooms/'+code+(revision===undefined?'':'?after='+revision)),timeout:20000,header:authHeader(),
        success(response) {
          if(stopped) return;
          if(response.statusCode===200) {revision=response.data.revision;onRoom(response.data);poll();}
          else {
            const error=responseError(response,'牌桌刷新失败，请稍后重试');
            onError(error);
            if(error.status===401||error.status===403) stopped=true;else timer=setTimeout(poll,2000);
          }
        },
        fail() {if(!stopped) {onError(new Error('连接中断，正在重连'));timer=setTimeout(poll,2000);}},
      });
    } catch(error) {onError(error);stopped=true;}
  }
  poll();
  return ()=>{stopped=true;clearTimeout(timer);if(task) task.abort();};
}

function rememberCommitment(hand) {
  const key='commit_'+hand.matchId+'_'+hand.handNo;
  const previous=wx.getStorageSync(key);
  if(previous&&previous!==hand.wallCode) throw new Error('牌山校验码发生变化，请勿确认本局');
  // A completed replay received for the first time is not evidence of pre-deal observation.
  if(hand.phase==='commit'&&!previous) wx.setStorageSync(key,hand.wallCode);
  return previous || (hand.phase === 'commit' ? hand.wallCode : null);
}
function observedCode(hand) { return wx.getStorageSync('commit_'+hand.matchId+'_'+hand.handNo)||null; }

async function exportJson(value, filename) {
  const confirmation=await new Promise(resolve=>wx.showModal({title:'导出完整牌谱？',content:'文件包含所有已结束小局的手牌、种子和完整牌山。请仅分享给你信任的人。',confirmText:'导出',cancelText:'取消',success:resolve,fail:()=>resolve({confirm:false})}));
  if(!confirmation.confirm) return;
  const filePath=wx.env.USER_DATA_PATH+'/'+filename.replace(/[^a-zA-Z0-9_.-]/g,'_')+'.json';
  await new Promise((resolve,reject)=>wx.getFileSystemManager().writeFile({filePath,data:JSON.stringify(value,null,2),encoding:'utf8',success:resolve,fail:reject}));
  if(wx.shareFileMessage) await new Promise((resolve,reject)=>wx.shareFileMessage({filePath,fileName:filename+'.json',success:resolve,fail:reject}));
  else wx.showModal({title:'牌谱已保存',content:'已保存至 '+filePath+'。请升级微信后分享牌谱文件。',showCancel:false,confirmText:'知道了'});
}

function importJson() {
  return new Promise((resolve,reject)=>wx.chooseMessageFile({count:1,type:'file',extension:['json'],
    success(result) {
      const file=result.tempFiles[0];
      if(!file||file.size>8*1024*1024) return reject(new Error('请选择小于 8 MB 的牌谱文件'));
      wx.getFileSystemManager().readFile({filePath:file.path,encoding:'utf8',success(data){try{resolve(JSON.parse(data.data));}catch{reject(new Error('文件不是合法的 JSON 数据'));}},fail:reject});
    },fail:reject,
  }));
}

module.exports={request,login,command,watchRoom,rememberCommitment,observedCode,exportJson,importJson,actionId};
