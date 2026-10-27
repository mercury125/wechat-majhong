'use strict';

const CHINESE = /[\u3400-\u9fff]/;

function fail(page, error, fallback) {
  const message = error && (error.message || error.errMsg) || '';
  page.setData({ error: CHINESE.test(message) ? message : fallback });
}

// A room revision is monotonic. Same-revision responses are allowed because
// presence updates can arrive without changing the revision.
function acceptRoom(current, next) {
  return !current || current.code !== next.code || next.revision >= current.revision;
}

function dataPatch(current, next, prefix = '', patch = {}) {
  for (const key of Object.keys(next)) {
    const before = current && current[key], after = next[key] ?? null;
    const path = prefix ? prefix + (Array.isArray(next) ? '[' + key + ']' : '.' + key) : key;
    if (before === after || before == null && after === null) continue;
    if (before && after && typeof before === 'object' && typeof after === 'object' &&
        Array.isArray(before) === Array.isArray(after) &&
        Object.keys(before).length === Object.keys(after).length &&
        Object.keys(after).every(key => Object.prototype.hasOwnProperty.call(before, key))) {
      dataPatch(before, after, path, patch);
    } else patch[path] = after;
  }
  return patch;
}

function tileAction(hand, tile) {
  return (hand && hand.actions || []).find(action =>
    action.tile === tile && (action.kind === 'discard' || action.kind === 'float')) || null;
}

function safeAreaStyle(api) {
  try {
    const info=api&&(typeof api.getWindowInfo==='function'?api.getWindowInfo():typeof api.getSystemInfoSync==='function'?api.getSystemInfoSync():null);
    if(!info||!info.safeArea)return '';
    const width=Number(info.windowWidth||info.screenWidth||0),height=Number(info.windowHeight||info.screenHeight||0),safe=info.safeArea;
    const left=Math.max(0,Number(safe.left)||0),top=Math.max(0,Number(safe.top)||0);
    const right=Math.max(0,width-(Number(safe.right)||width)),bottom=Math.max(0,height-(Number(safe.bottom)||height));
    let menuStyle='';
    try{
      if(typeof api.getMenuButtonBoundingClientRect==='function'){
        const menu=api.getMenuButtonBoundingClientRect();
        if(menu&&menu.width>0&&menu.left>0)menuStyle='--menu-right:'+Math.max(12,width-menu.left-right+8)+'px;--menu-top:'+Math.max(8,menu.top-top)+'px;';
      }
    }catch{}
    return '--safe-top:'+top+'px;--safe-right:'+right+'px;--safe-bottom:'+bottom+'px;--safe-left:'+left+'px;'+menuStyle;
  } catch { return ''; }
}

module.exports = { fail, acceptRoom, dataPatch, tileAction, safeAreaStyle };
