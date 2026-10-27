'use strict';

const config = require('../config');
const SHEET_BASES = [
  '/assets/characters/ironclad-sheet',
  '/assets/characters/silent-sheet',
  '/assets/characters/defect-sheet',
  '/assets/characters/watcher-sheet',
];
const temporary = new Map();
let pending = null;

function cloudBase() {
  const base = String(config.assetBase || '').replace(/\/$/, '');
  return base.startsWith('cloud://') ? base : '';
}

function cloudFileId(path) {
  const base = cloudBase();
  if (!base) return '';
  return base + (String(path).startsWith('/') ? path : '/' + path);
}

function httpsBase() {
  return String(config.assetBase || config.apiBase || 'http://127.0.0.1:8787').replace(/\/$/, '');
}

function assetUrl(path) {
  const relative = String(path || '');
  if (!cloudBase()) {
    const base = httpsBase();
    let value = relative.replace(/^\/+/, '');
    if (base.endsWith('/assets') && value.startsWith('assets/')) value = value.slice('assets/'.length);
    return base + '/' + value;
  }
  const key = relative.startsWith('/') ? relative : '/' + relative;
  // Do not return a cloud:// URL to <image>: DevTools resolves it as a relative
  // component path. Use the temporary HTTPS URL once getTempFileURL completes.
  if (temporary.has(key)) return temporary.get(key);
  const alternate = key.endsWith('.webp') ? key.replace(/\.webp$/, '.png') : key.endsWith('.png') ? key.replace(/\.png$/, '.webp') : '';
  if (alternate && temporary.has(alternate)) return temporary.get(alternate);
  // Node-only rendering tests have no wx runtime; keep a deterministic file ID
  // there while real Mini Program rendering waits for temp URLs.
  return typeof wx === 'undefined' ? cloudFileId(key) : '';
}

function cacheTemp(item) {
  const base = cloudBase();
  if (!item || (item.status !== undefined && item.status !== 0) || !item.tempFileURL || !item.fileID) return false;
  const path = item.fileID.startsWith(base) ? item.fileID.slice(base.length) : '';
  if (!path) return false;
  temporary.set(path.startsWith('/') ? path : '/' + path, item.tempFileURL);
  return true;
}

function resolveFiles(fileIDs) {
  return new Promise(resolve => {
    wx.cloud.getTempFileURL({
      fileList:fileIDs,
      success(result) {
        const unresolved = new Set(fileIDs);
        for (const item of result.fileList || []) if (item && unresolved.has(item.fileID) && cacheTemp(item)) unresolved.delete(item.fileID);
        resolve([...unresolved]);
      },
      fail(error) {
        console.warn('cloud asset direct URLs failed:', error && (error.errMsg || error.message) || error);
        resolve(fileIDs);
      },
    });
  });
}

function resolveViaCloudFunction(fileIDs) {
  return new Promise(resolve => {
    if (!fileIDs.length || !wx.cloud || typeof wx.cloud.callFunction !== 'function') return resolve(0);
    wx.cloud.callFunction({
      name:'api',
      data:{ action:'assetUrls', data:{ fileList:fileIDs } },
      success(response) {
        const result = response && response.result;
        if (!result || !result.ok || !result.data || !Array.isArray(result.data.fileList)) {
          console.warn('cloud asset function unavailable:', result && (result.detail || result.error));
          return resolve(0);
        }
        let resolved = 0;
        for (const item of result.data.fileList) if (cacheTemp(item)) resolved++;
        console.log('[cloud assets] cloud function resolved', resolved, 'of', fileIDs.length);
        resolve(resolved);
      },
      fail(error) {
        console.warn('cloud asset function call failed:', error && (error.errMsg || error.message) || error);
        resolve(0);
      },
    });
  });
}

async function resolveExtension(extension) {
  if (!cloudBase()) return;
  const fileIDs = SHEET_BASES.filter(base => !temporary.has(base + '.png') && !temporary.has(base + '.webp')).map(base => cloudFileId(base + extension));
  if (!fileIDs.length) return;
  const unresolved = await resolveFiles(fileIDs);
  if (unresolved.length) await resolveViaCloudFunction(unresolved);
  const resolved = SHEET_BASES.filter(base => temporary.has(base + extension)).length;
  console.log('[cloud assets] resolved', resolved, 'of', SHEET_BASES.length, 'files with', extension);
}

function ensure() {
  if (pending) return pending;
  if (!cloudBase() || !config.cloudEnv || typeof wx === 'undefined' || !wx.cloud || typeof wx.cloud.getTempFileURL !== 'function') return Promise.resolve();
  const preferred = config.cloudAssetExtension || '.png';
  const extensions = [...new Set([preferred, '.png', '.webp'])];
  pending = (async () => {
    for (const extension of extensions) {
      await resolveExtension(extension);
      const complete = SHEET_BASES.every(base => {
        const key = base + extension;
        return temporary.has(key) || temporary.has(key.replace(/\.(png|webp)$/, extension === '.png' ? '.webp' : '.png'));
      });
      if (complete) break;
    }
  })();
  return pending;
}

module.exports = { assetUrl, ensure, cloudFileId };
