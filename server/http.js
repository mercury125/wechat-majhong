'use strict';

const http = require('node:http');
const { randomUUID } = require('node:crypto');
const { readFile } = require('node:fs/promises');
const { join } = require('node:path');
const { HttpError } = require('./service');

async function body(request) {
  let size=0;const chunks=[];
  for await (const chunk of request) {
    size+=chunk.length;
    if(size>65536) throw new HttpError(413,'请求内容过大');
    chunks.push(chunk);
  }
  if(!size) return {};
  try {
    const value=JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if(!value||typeof value!=='object'||Array.isArray(value)) throw new Error();
    return value;
  } catch { throw new HttpError(400,'数据必须是合法的 JSON 对象'); }
}

const STATIC_FILES = [
  { pattern: /^\/dev$/, file: 'tools/dev.html', type: 'text/html; charset=utf-8', cache: 'no-store' },
  { pattern: /^\/dev\/styles\/interactions\.wxss$/, file: 'miniprogram/styles/interactions.wxss', type: 'text/css; charset=utf-8', cache: 'no-store' },
  { pattern: /^\/dev\/lib\/(?:cosmetics|layout|tiles|rules|shuffle|engine|replay|vendor\/sha256)\.js$/, prefix: 'miniprogram/lib/', type: 'text/javascript; charset=utf-8', cache: 'no-store' },
  { pattern: /^\/assets\/tiles\/(?:Man[1-9]|Sou[1-9]|Pin[1-9]|Front|Back)\.png$/, type: 'image/png', cache: 'public,max-age=3600' },
  { pattern: /^\/assets\/characters\/(?:ironclad|silent|defect|watcher)-sheet\.webp$/, type: 'image/webp', cache: 'public,max-age=3600', public: true },
];

async function serveFile(path, response, development) {
  const route = STATIC_FILES.find(item => item.pattern.test(path));
  if (!route || !development && !route.public) return false;
  const relative = route.file || (route.prefix ? route.prefix + path.slice('/dev/lib/'.length) : path.slice(1));
  const content = await readFile(join(__dirname, '..', relative));
  response.writeHead(200, { 'Content-Type': route.type, 'Cache-Control': route.cache });
  response.end(content);
  return true;
}

function createServer(service, options={}) {
  const rates=new Map();
  const pollers=new Set();
  const development=options.development===true;
  function rate(request, category, limit) {
    const key=request.socket.remoteAddress+':'+category;
    const now=Date.now();
    let entry=rates.get(key);
    if(!entry||now-entry.start>60000) {entry={start:now,count:0};rates.set(key,entry);}
    if(++entry.count>limit) throw new HttpError(429,'操作过于频繁，请一分钟后重试');
    if(rates.size>10000) for(const [key,value] of rates) if(now-value.start>60000) rates.delete(key);
  }
  function send(response,status,value) {
    if(response.destroyed||response.writableEnded) return;
    response.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});
    response.end(JSON.stringify(value));
  }
  async function wechatLogin(data) {
    if(!options.appId||!options.appSecret) throw new HttpError(503,'服务器尚未配置微信登录');
    if(typeof data.code!=='string'||data.code.length<1||data.code.length>512) throw new HttpError(400,'微信登录凭证无效');
    const url=new URL('https://api.weixin.qq.com/sns/jscode2session');
    url.search=new URLSearchParams({appid:options.appId,secret:options.appSecret,js_code:data.code,grant_type:'authorization_code'}).toString();
    let result;
    try {
      const response=await (options.fetch||fetch)(url,{signal:AbortSignal.timeout(10000)});
      if(!response.ok) throw new Error();
      result=await response.json();
    } catch {throw new HttpError(502,'微信登录暂时不可用，请稍后重试');}
    if(result.errcode||typeof result.openid!=='string'||!result.openid) throw new HttpError(401,'微信登录凭证已过期或被拒绝，请重新登录');
    return service.login('wechat:'+options.appId+':'+result.openid,data.name);
  }
  const server=http.createServer(async(request,response)=>{
    try {
      const url=new URL(request.url,'http://localhost');
      const path=url.pathname;
      const method=request.method;
      if(method==='GET'&&path==='/health') return send(response,200,{ok:true});
      if(method==='POST'&&path==='/api/login/wechat') {rate(request,'login',30);return send(response,200,await wechatLogin(await body(request)));}
      if(method==='POST'&&path==='/api/login/dev') {
        const loopback=['127.0.0.1','::1','::ffff:127.0.0.1'].includes(request.socket.remoteAddress);
        if(!development||!loopback) throw new HttpError(404,'请求的内容不存在');
        rate(request,'login',30);
        const data=await body(request);
        return send(response,200,service.login('dev:'+randomUUID(),data.name));
      }
      if(method==='GET'&&await serveFile(path,response,development)) return;
      const token=(request.headers.authorization||'').replace(/^Bearer /,'');
      const user=service.authenticate(token);
      if(method==='GET'&&path==='/api/me') return send(response,200,{user:service.profile(user),rooms:service.myRooms(user)});
      if(['POST','PATCH'].includes(method)&&path==='/api/me') return send(response,200,{user:service.updateProfile(user,await body(request))});
      if(method==='POST'&&path==='/api/logout') {service.logout(token);return send(response,200,{ok:true});}
      if(method==='POST'&&path==='/api/rooms') {rate(request,'rooms',30);return send(response,201,service.createRoom(user,await body(request)));}
      if(method==='GET'&&path==='/api/history') return send(response,200,{matches:service.history(user)});
      const replay=/^\/api\/matches\/([a-f0-9-]{36})$/.exec(path);
      if(method==='GET'&&replay) return send(response,200,service.exportMatch(user,replay[1]));
      const roomRoute=/^\/api\/rooms\/([A-Z0-9]{8})(?:\/(join|commands|appearance|emotes|interactions|controls))?$/.exec(path);
      if(roomRoute) {
        const [,code,operation]=roomRoute;
        if(method==='POST'&&operation==='join') {rate(request,'join',40);return send(response,200,service.join(user,code,await body(request)));}
        if(method==='POST'&&operation==='commands') {rate(request,'commands',600);return send(response,200,service.command(user,code,await body(request)));}
        if(['POST','PATCH'].includes(method)&&operation==='controls') {rate(request,'controls',120);return send(response,200,service.setControls(user,code,await body(request)));}
        if(method==='POST'&&['appearance','emotes','interactions'].includes(operation)) {rate(request,'social',120);return send(response,200,service.social(user,code,operation,await body(request)));}
        if(method==='GET'&&!operation) {
          const room=service.room(code);service.member(room,user);
          const after=url.searchParams.get('after');
          if(after===null||Number(after)!==room.revision) return send(response,200,service.view(room,user));
          if(pollers.size>=100) throw new HttpError(503,'牌桌连接数过多，请稍后重试');
          let timer;
          const done=()=>{
            clearTimeout(timer);service.changes.removeListener(code,done);response.removeListener('close',closed);pollers.delete(done);
            try {send(response,200,service.view(service.room(code),user));} catch(error) {send(response,error.status||500,{error:error.status?error.message:'无法刷新牌桌，请稍后重试'});}
          };
          const closed=()=>{clearTimeout(timer);service.changes.removeListener(code,done);pollers.delete(done);};
          pollers.add(done);service.changes.once(code,done);response.once('close',closed);timer=setTimeout(done,15000);
          return;
        }
      }
      throw new HttpError(404,'请求的内容不存在');
    } catch(error) {
      if(!error.status) console.error('Request failed:',error.message);
      send(response,error.status||500,{error:error.status?error.message:'服务器暂时异常，请稍后重试'});
    }
  });
  server.requestTimeout=25000;
  server.headersTimeout=10000;
  server.on('close',()=>{for(const done of pollers) done();});
  return server;
}

module.exports={createServer};
