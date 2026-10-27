'use strict';

const SUITS = ['Man', 'Sou', 'Pin'];
const SUIT_NAMES = ['万', '条', '饼'];
const typeOf = id => Math.floor(id / 4);
const wildcardAfter = type => Math.floor(type / 9) * 9 + (type % 9 + 1) % 9;

function tile(id) {
  if (id === null) return { id: null, name: '暗牌', image: '/assets/tiles/Back.png', hidden: true };
  const type = typeOf(id);
  const rank = type % 9 + 1;
  return { id, type, rank, name: '一二三四五六七八九'[rank - 1] + SUIT_NAMES[Math.floor(type / 9)], image: '/assets/tiles/' + SUITS[Math.floor(type / 9)] + rank + '.png', hidden: false };
}


function assertTile(id) {
  if (!Number.isInteger(id) || id < 0 || id > 107) throw new Error('实体牌编号必须是 0–107 之间的整数');
}

module.exports = { typeOf, wildcardAfter, tile, assertTile };
