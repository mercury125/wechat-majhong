'use strict';

const cloud = require('wx-server-sdk');
const { CloudDbStore } = require('./db-store');
const { CloudService } = require('./service');
const { handleAction } = require('./handler');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const store = new CloudDbStore(db);
const service = new CloudService(store);
const COLLECTIONS = ['users', 'rooms', 'matches', 'history'];
let collectionsReady;

async function ensureCollections() {
  if (!collectionsReady) collectionsReady = Promise.all(COLLECTIONS.map(async name => {
    try {
      await db.createCollection(name);
    } catch (error) {
      // Existing collections are fine. Actual database operations will report
      // permission or schema failures with a more useful message.
      const message = String((error && (error.errMsg || error.message)) || error);
      if (!/exist|already|重复|已存在/i.test(message)) console.warn('createCollection failed:', name, message);
    }
  }));
  return collectionsReady;
}

exports.main = async (event = {}) => {
  const context = cloud.getWXContext();
  const openid = context.OPENID;
  try {
    await ensureCollections();
    if (!openid) {
      return {
        ok:false,
        status:401,
        error:'无法获取微信身份。请从微信小游戏客户端内调用云函数；云函数控制台的“测试”按钮没有微信用户上下文，不会返回 OPENID。同时确认开发者工具已登录项目开发者微信，且项目 AppID 与云开发环境属于同一个小游戏。',
        detail:'cloud.getWXContext().OPENID is empty',
      };
    }
    if (event.action === 'assetUrls') {
      const fileList = event.data && event.data.fileList;
      if (!Array.isArray(fileList) || fileList.length < 1 || fileList.length > 20) {
        return { ok:false, status:400, error:'图片文件列表无效' };
      }
      const result = await cloud.getTempFileURL({ fileList });
      return { ok:true, data:{ fileList:result.fileList || [] } };
    }
    const data = await handleAction(service, openid, event.action, event.data || {});
    return { ok:true, data };
  } catch (error) {
    const status = Number.isInteger(error.status) ? error.status : 500;
    const code = error.code ?? error.errCode;
    const detail = error.message || error.errMsg || String(error);
    if (status >= 500) console.error('Cloud API failed:', {action:event.action,code,detail:error.stack || detail});
    return {
      ok:false,
      status,
      error:status === 500 ? '云端服务暂时异常，请稍后重试' : error.message,
      detail,
      code,
    };
  }
};
