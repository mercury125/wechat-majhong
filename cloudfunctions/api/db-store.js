'use strict';

const PAGE_SIZE = 100;
const clean = value => {
  const data = JSON.parse(JSON.stringify(value));
  delete data._id;
  return data;
};

class CloudDbStore {
  constructor(db) {
    this.db = db;
  }

  collection(name) { return this.db.collection(name); }

  async one(name, condition) {
    const result = await this.collection(name).where(condition).limit(1).get();
    return result.data && result.data[0] ? result.data[0] : null;
  }

  async all(name, condition, max = 1000) {
    const rows = [];
    for (let offset = 0; offset < max; offset += PAGE_SIZE) {
      let query = this.collection(name);
      if (condition && Object.keys(condition).length) query = query.where(condition);
      const result = await query.skip(offset).limit(PAGE_SIZE).get();
      rows.push(...result.data);
      if (result.data.length < PAGE_SIZE) break;
    }
    return rows;
  }

  async getUser(id) { return this.one('users', { _id:id }); }
  async getUserByOpenid(openid) { return this.one('users', { openid }); }
  async getUsers(ids) {
    if (!ids.length) return [];
    const result = await this.collection('users').where({ _id:this.db.command.in(ids) }).get();
    return (result.data || []).filter(Boolean);
  }
  async putUser(user) {
    await this.collection('users').doc(user.id).set({ data:clean(user) });
    return user;
  }

  async getRoom(code) { return this.one('rooms', { _id:code }); }
  async createRoom(room) {
    await this.collection('rooms').doc(room.code).set({ data:clean(room) });
    return room;
  }
  async updateRoom(room, expectedRevision) {
    // Replace snapshot fields; normal SDK updates flatten objects and drop empty resets.
    const data = Object.fromEntries(Object.entries(clean(room)).map(([key, value]) => [key, this.db.command.set(value)]));
    const result = await this.collection('rooms')
      .where({ _id:room.code, revision:expectedRevision })
      .update({ data });
    if (!result.stats || result.stats.updated !== 1) {
      const error = new Error('牌桌状态已更新，请刷新后重试');
      error.status = 409;
      error.code = 'ROOM_REVISION_CONFLICT';
      throw error;
    }
    return room;
  }
  async roomsForUser(userId) {
    const rooms = await this.all('rooms', { seats:this.db.command.in([userId]) }, 1000);
    return rooms.filter(room => Array.isArray(room.seats) && room.seats.includes(userId));
  }
  async findRoomByMatch(matchId) {
    const result = await this.collection('rooms').where({ matchId }).limit(1).get();
    return result.data && result.data[0] ? result.data[0] : null;
  }

  async getArchivedMatch(id) { return this.one('matches', { _id:id }); }
  async archiveMatch(match, participants) {
    await this.collection('matches').doc(match.id).set({ data:clean(match) });
    for (const participant of participants) {
      const userId = participant.playerId;
      const summary = {
        id: match.id,
        testMode: match.testMode === true,
        startedAt: match.startedAt,
        endedAt: match.endedAt,
        seats: match.seats,
        hands: match.hands.length,
        handsPerMatch: match.settings.handsPerMatch,
        scores: match.scores,
        status: match.status,
      };
      await this.collection('history').doc(match.id + ':' + userId).set({
        data:{ userId, matchId:match.id, endedAt:match.endedAt, ...summary },
      });
    }
  }
  async historyFor(userId) {
    const rows = await this.all('history', { userId }, 1000);
    return rows
      .sort((a, b) => String(b.endedAt).localeCompare(String(a.endedAt)) || b.matchId.localeCompare(a.matchId))
      .map(row => {
        const summary = { ...row };
        delete summary._id;
        delete summary.userId;
        delete summary.matchId;
        delete summary.endedAt;
        return summary;
      });
  }
  async countHistory(userId) {
    const result = await this.collection('history').where({ userId }).count();
    return result.total || 0;
  }
  async pruneHistory(userId, limit) {
    const rows = await this.all('history', { userId }, 1000);
    rows.sort((a, b) => String(b.endedAt).localeCompare(String(a.endedAt)) || b.matchId.localeCompare(a.matchId));
    for (const row of rows.slice(limit)) await this.collection('history').doc(row._id).remove();
  }
  async retained(userId, matchId) {
    return !!(await this.one('history', { _id:matchId + ':' + userId }));
  }
}

module.exports = { CloudDbStore };
