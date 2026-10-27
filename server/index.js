'use strict';

const path=require('node:path');
const {Store}=require('./store');
const {Service}=require('./service');
const {createServer}=require('./http');

const development=process.argv.includes('--dev');
const host=process.env.MAHJONG_HOST||'127.0.0.1';
const port=Number(process.env.MAHJONG_PORT||8787);
if(development&&!['127.0.0.1','::1','localhost'].includes(host)) throw new Error('Development login is restricted to a loopback-only server');
if(!development&&(!process.env.WECHAT_APP_ID||!process.env.WECHAT_APP_SECRET)) throw new Error('Set WECHAT_APP_ID and WECHAT_APP_SECRET, or use npm run dev for local development');
if(!Number.isInteger(port)||port<1||port>65535) throw new Error('Invalid MAHJONG_PORT');
const store=new Store(process.env.MAHJONG_DATABASE_PATH||path.join(process.cwd(),'data/mahjong.sqlite'));
const service=new Service(store);
const server=createServer(service,{development,appId:process.env.WECHAT_APP_ID,appSecret:process.env.WECHAT_APP_SECRET});
server.listen(port,host,()=>console.log('Friends Mahjong listening on http://'+host+':'+port+(development?' (local development login enabled)':'')));
for(const signal of ['SIGINT','SIGTERM']) process.on(signal,()=>{server.close(()=>{store.close();process.exit(0);});server.closeIdleConnections();server.closeAllConnections();});
