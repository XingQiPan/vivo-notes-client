// 本地 SQLite 存储层（复刻 PC 端本地库：Note/NoteBook/Tag/Resource/User 表）。
// 用 Electron 37 内置 Node 22 的 node:sqlite（零原生模块，无需 rebuild）。
//
// 字段集还原自 analysis/04-note-sync.md §5。

import { DatabaseSync } from 'node:sqlite';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS Note (
  guid TEXT PRIMARY KEY,
  title TEXT, content TEXT, contentDigest TEXT, thumbnail TEXT,
  type INTEGER, importantLevel INTEGER, bgColor TEXT,
  alarmTime INTEGER, oldAlarmTime INTEGER,
  encryptType INTEGER, pictureMode INTEGER,
  stickTop INTEGER, stickTopTime INTEGER,
  paperTexture TEXT, pageMargins TEXT,
  noteBookGuid TEXT,
  deleted INTEGER DEFAULT 1,
  createTime INTEGER, updateTime INTEGER, attrUpdateTime INTEGER,
  updateSequenceNum INTEGER,
  dirty INTEGER DEFAULT 0
);
CREATE TABLE IF NOT EXISTS NoteBook (
  guid TEXT PRIMARY KEY, name TEXT, nameNew TEXT, iconColor TEXT,
  parentGuid TEXT, sort INTEGER,
  deleted INTEGER DEFAULT 1,
  createTime INTEGER, updateTime INTEGER,
  updateSequenceNum INTEGER, dirty INTEGER DEFAULT 0
);
CREATE TABLE IF NOT EXISTS Tag (
  guid TEXT PRIMARY KEY, noteGuid TEXT, name TEXT, bgColor TEXT, type INTEGER,
  deleted INTEGER DEFAULT 1, createTime INTEGER,
  updateSequenceNum INTEGER, dirty INTEGER DEFAULT 0
);
CREATE TABLE IF NOT EXISTS Resource (
  guid TEXT PRIMARY KEY, noteGuid TEXT, name TEXT, mime TEXT,
  resourceKey TEXT, domainAddr TEXT, resourceSize INTEGER, resType INTEGER,
  fileID TEXT, category INTEGER, sort INTEGER, resourceTextUpdateTime INTEGER,
  deleted INTEGER DEFAULT 1, createTime INTEGER, updateTime INTEGER,
  updateSequenceNum INTEGER, dirty INTEGER DEFAULT 0
);
CREATE TABLE IF NOT EXISTS User (
  userId TEXT PRIMARY KEY, nickName TEXT, smallAvatar TEXT, openId TEXT, token TEXT,
  phone TEXT, email TEXT, regionCode TEXT, regionName TEXT,
  defaultNoteSynced INTEGER, defaultTodoPopover INTEGER,
  dirty INTEGER DEFAULT 0
);
CREATE TABLE IF NOT EXISTS SyncState (
  k TEXT PRIMARY KEY, v INTEGER
);
`;

export class Store {
  constructor(file = ':memory:') {
    this.db = new DatabaseSync(file);
    this.db.exec(SCHEMA);
  }

  // ---- USN 游标 ----
  getLastUpdateCount() {
    const r = this.db.prepare('SELECT v FROM SyncState WHERE k=?').get('lastUpdateCount');
    return r ? r.v : 0;
  }
  setLastUpdateCount(v) {
    this.db.prepare('INSERT INTO SyncState(k,v) VALUES(?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v')
      .run('lastUpdateCount', v);
  }

  // ---- 笔记 CRUD（带 dirty 标记）----
  upsertNote(n) {
    const cols = Object.keys(n).filter(c => n[c] !== undefined);
    const placeholders = cols.map(() => '?').join(',');
    const updates = cols.filter(c => c !== 'guid').map(c => `${c}=excluded.${c}`).join(',');
    this.db.prepare(
      `INSERT INTO Note (${cols}) VALUES (${placeholders})
       ON CONFLICT(guid) DO UPDATE SET ${updates}`
    ).run(...cols.map(c => n[c] === null ? null : n[c]));
  }
  markNoteDirty(guid) {
    this.db.prepare('UPDATE Note SET dirty=1 WHERE guid=?').run(guid);
  }
  clearAllDirty() {
    this.db.prepare('UPDATE Note SET dirty=0').run();
    this.db.prepare('UPDATE Tag SET dirty=0').run();
    this.db.prepare('UPDATE Resource SET dirty=0').run();
    this.db.prepare('UPDATE NoteBook SET dirty=0').run();
  }
  listNotes({ deleted = 1, omitEncrypted = false, limit = 50, offset = 0 } = {}) {
    let sql = 'SELECT * FROM Note WHERE deleted=?';
    const params = [deleted];
    if (omitEncrypted) sql += ' AND encryptType IS NOT 1';
    sql += ' ORDER BY stickTop DESC, MAX(IFNULL(stickTopTime,0), IFNULL(updateTime,0)) DESC LIMIT ? OFFSET ?';
    params.push(limit, offset);
    return this.db.prepare(sql).all(...params);
  }
  getNote(guid) { return this.db.prepare('SELECT * FROM Note WHERE guid=?').get(guid); }

  // ---- 导出本地脏数据（供 collectDirty）----
  collectLocalData() {
    const notes = this.db.prepare('SELECT * FROM Note WHERE dirty=1').all();
    const tags = this.db.prepare('SELECT * FROM Tag WHERE dirty=1').all();
    const resources = this.db.prepare('SELECT * FROM Resource WHERE dirty=1').all();
    const noteBooks = this.db.prepare('SELECT * FROM NoteBook WHERE dirty=1').all();
    return { notes, tags, resources, noteBooks, deleteResourceGuids: [] };
  }

  // ---- 应用服务端增量（复刻合并逻辑，本地 dirty 优先）----
  applyServerChunk(chunk) {
    const dirtyGuids = new Set(this.db.prepare('SELECT guid FROM Note WHERE dirty=1').all().map(r => r.guid));
    for (const n of chunk.notes || []) {
      if (n.deleted !== 1) continue;
      const localDirty = dirtyGuids.has(n.guid);
      if (localDirty) {
        // 本地优先：保留本地 content，仅同步服务端元数据 + 清 dirty 由推送后处理
        const local = this.getNote(n.guid);
        if (local) {
          this.upsertNote({ ...n, content: local.content, updateTime: Math.max(n.updateTime || 0, local.updateTime || 0) });
        }
      } else {
        this.upsertNote(n);
      }
    }
    for (const nb of chunk.noteBooks || []) this.upsertNoteBook(nb);
    for (const t of chunk.tags || []) this.upsertTag(t);
    for (const r of chunk.resources || []) this.upsertResource(r);
    // 删除处理
    for (const g of (chunk.delete?.notes || [])) this.db.prepare('UPDATE Note SET deleted=0 WHERE guid=?').run(g);
    for (const g of (chunk.remove?.notes || [])) this.db.prepare('DELETE FROM Note WHERE guid=?').run(g);
  }
  upsertNoteBook(b) {
    const cols = Object.keys(b);
    const ph = cols.map(() => '?').join(',');
    const up = cols.filter(c => c !== 'guid').map(c => `${c}=excluded.${c}`).join(',');
    this.db.prepare(`INSERT INTO NoteBook (${cols}) VALUES (${ph}) ON CONFLICT(guid) DO UPDATE SET ${up}`)
      .run(...cols.map(c => b[c]));
  }
  upsertTag(t) {
    const cols = Object.keys(t);
    const ph = cols.map(() => '?').join(',');
    const up = cols.filter(c => c !== 'guid').map(c => `${c}=excluded.${c}`).join(',');
    this.db.prepare(`INSERT INTO Tag (${cols}) VALUES (${ph}) ON CONFLICT(guid) DO UPDATE SET ${up}`)
      .run(...cols.map(c => t[c]));
  }
  upsertResource(r) {
    const cols = Object.keys(r);
    const ph = cols.map(() => '?').join(',');
    const up = cols.filter(c => c !== 'guid').map(c => `${c}=excluded.${c}`).join(',');
    this.db.prepare(`INSERT INTO Resource (${cols}) VALUES (${ph}) ON CONFLICT(guid) DO UPDATE SET ${up}`)
      .run(...cols.map(c => r[c]));
  }

  // ---- 保存本地笔记（标脏）----
  saveNote(n) {
    const now = Date.now();
    const rec = { ...n, updateTime: now, dirty: 1 };
    if (rec.updateSequenceNum === undefined) rec.updateSequenceNum = undefined;
    this.upsertNote(rec);
  }

  close() { this.db.close(); }
}
