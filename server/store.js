'use strict';

const { DatabaseSync } = require('node:sqlite');
const { mkdirSync } = require('node:fs');
const { dirname } = require('node:path');

class Store {
  constructor(filename) {
    if (filename !== ':memory:') mkdirSync(dirname(filename), { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(filename);
    this.db.exec(`
      PRAGMA journal_mode=WAL;
      PRAGMA synchronous=FULL;
      PRAGMA foreign_keys=ON;
      CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, identity TEXT UNIQUE NOT NULL, name TEXT NOT NULL, history_limit INTEGER NOT NULL DEFAULT 1000);
      CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), expires_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS rooms (code TEXT PRIMARY KEY, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS matches (id TEXT PRIMARY KEY, data TEXT NOT NULL, status TEXT NOT NULL, ended_at TEXT);
      CREATE TABLE IF NOT EXISTS history (user_id TEXT NOT NULL REFERENCES users(id), match_id TEXT NOT NULL REFERENCES matches(id) ON DELETE CASCADE, PRIMARY KEY(user_id,match_id));
      CREATE INDEX IF NOT EXISTS session_user ON sessions(user_id);
      CREATE INDEX IF NOT EXISTS history_match ON history(match_id);
    `);
  }
  transaction(fn) {
    this.db.exec('BEGIN IMMEDIATE');
    try { const result = fn(); this.db.exec('COMMIT'); return result; }
    catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  user(id) { return this.db.prepare('SELECT * FROM users WHERE id=?').get(id); }
  identity(identity) { return this.db.prepare('SELECT * FROM users WHERE identity=?').get(identity); }
  room(code) { const row = this.db.prepare('SELECT data FROM rooms WHERE code=?').get(code); return row ? JSON.parse(row.data) : null; }
  rooms() { return this.db.prepare('SELECT data FROM rooms').all().map(row => JSON.parse(row.data)); }
  saveRoom(room) { this.db.prepare('INSERT INTO rooms(code,data) VALUES(?,?) ON CONFLICT(code) DO UPDATE SET data=excluded.data').run(room.code, JSON.stringify(room)); }
  match(id) { const row = this.db.prepare('SELECT data FROM matches WHERE id=?').get(id); return row ? JSON.parse(row.data) : null; }
  saveMatch(match) { this.db.prepare('INSERT INTO matches(id,data,status,ended_at) VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data,status=excluded.status,ended_at=excluded.ended_at').run(match.id, JSON.stringify(match), match.status, match.endedAt); }
  history(userId) {
    return this.db.prepare('SELECT m.data FROM history h JOIN matches m ON m.id=h.match_id WHERE h.user_id=? ORDER BY m.ended_at DESC,m.id DESC').all(userId).map(row=>JSON.parse(row.data));
  }
  retained(userId, matchId) { return !!this.db.prepare('SELECT 1 FROM history WHERE user_id=? AND match_id=?').get(userId, matchId); }
  prune(userId, limit) {
    const stale = this.db.prepare('SELECT h.match_id FROM history h JOIN matches m ON m.id=h.match_id WHERE h.user_id=? ORDER BY m.ended_at DESC,m.id DESC LIMIT -1 OFFSET ?').all(userId, limit);
    const remove = this.db.prepare('DELETE FROM history WHERE user_id=? AND match_id=?');
    stale.forEach(row=>remove.run(userId,row.match_id));
    this.db.exec("DELETE FROM matches WHERE status='complete' AND NOT EXISTS(SELECT 1 FROM history h WHERE h.match_id=matches.id)");
    return stale.length;
  }
  close() { this.db.close(); }
}

module.exports = { Store };
