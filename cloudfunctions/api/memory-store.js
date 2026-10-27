'use strict';

const clone = value => JSON.parse(JSON.stringify(value));

class MemoryStore {
  constructor() {
    this.users = new Map();
    this.rooms = new Map();
    this.matches = new Map();
    this.history = new Map();
  }

  async getUser(id) { return this.users.has(id) ? clone(this.users.get(id)) : null; }
  async getUserByOpenid(openid) {
    for (const user of this.users.values()) if (user.openid === openid) return clone(user);
    return null;
  }
  async getUsers(ids) { return ids.map(id => this.users.get(id)).filter(Boolean).map(clone); }
  async putUser(user) { this.users.set(user.id, clone(user)); return clone(user); }

  async getRoom(code) { return this.rooms.has(code) ? clone(this.rooms.get(code)) : null; }
  async createRoom(room) {
    if (this.rooms.has(room.code)) { const error = new Error('房间号已存在'); error.status = 409; throw error; }
    this.rooms.set(room.code, clone(room));
    return clone(room);
  }
  async updateRoom(room, expectedRevision) {
    const current = this.rooms.get(room.code);
    if (!current) { const error = new Error('房间不存在'); error.status = 404; throw error; }
    if (current.revision !== expectedRevision) { const error = new Error('牌桌状态已更新，请刷新后重试'); error.status = 409; error.code = 'ROOM_REVISION_CONFLICT'; throw error; }
    this.rooms.set(room.code, clone(room));
    return clone(room);
  }
  async roomsForUser(userId) { return [...this.rooms.values()].filter(room => room.seats.includes(userId)).map(clone); }
  async findRoomByMatch(matchId) {
    for (const room of this.rooms.values()) if (room.match && room.match.id === matchId) return clone(room);
    return null;
  }

  async getArchivedMatch(id) { return this.matches.has(id) ? clone(this.matches.get(id)) : null; }
  async archiveMatch(match, participants) {
    this.matches.set(match.id, clone(match));
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
      this.history.set(match.id + ':' + userId, { userId, matchId:match.id, endedAt:match.endedAt, summary });
    }
  }
  async historyFor(userId) {
    return [...this.history.values()]
      .filter(item => item.userId === userId)
      .sort((a, b) => String(b.endedAt).localeCompare(String(a.endedAt)) || b.matchId.localeCompare(a.matchId))
      .map(item => clone(item.summary));
  }
  async countHistory(userId) { return (await this.historyFor(userId)).length; }
  async pruneHistory(userId, limit) {
    const items = [...this.history.values()]
      .filter(item => item.userId === userId)
      .sort((a, b) => String(b.endedAt).localeCompare(String(a.endedAt)) || b.matchId.localeCompare(a.matchId));
    for (const item of items.slice(limit)) this.history.delete(item.matchId + ':' + userId);
  }
  async retained(userId, matchId) { return this.history.has(matchId + ':' + userId); }
}

module.exports = { MemoryStore };
