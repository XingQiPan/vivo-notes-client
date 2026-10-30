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
CREATE TABLE IF NOT EXISTS ToDo (
  guid TEXT PRIMARY KEY,
  contentToDo TEXT, type INTEGER DEFAULT 0, sort REAL, symbolInfo INTEGER,
  reminderTime INTEGER, noticeType INTEGER, alarmRepeatRule INTEGER DEFAULT 0,
  deleted INTEGER DEFAULT 1, dirty INTEGER DEFAULT 0,
  updateTime INTEGER, createTime INTEGER, localDataStatus INTEGER,
  ex1 TEXT, bgColor TEXT, remark TEXT, duration INTEGER, priority INTEGER,
  sourceType INTEGER, rrule TEXT, dueTimeType INTEGER, relativeTime TEXT,
  location TEXT, sortv70 REAL, timeZone TEXT, showLunar INTEGER,
  categoryGuid TEXT, childCount INTEGER DEFAULT 0, pguid TEXT,
  updateSequenceNum INTEGER
);
CREATE TABLE IF NOT EXISTS ToDoCategory (
  guid TEXT PRIMARY KEY, name TEXT, color INTEGER, colorIndex INTEGER,
  deleted INTEGER DEFAULT 1, dirty INTEGER DEFAULT 0,
  createTime INTEGER, updateTime INTEGER
);
`;

export class Store {
  constructor(file = ':memory:') {
    this.db = new DatabaseSync(file);
    this.db.exec(SCHEMA);
    // 缓存各表的列名，用于过滤云端返回的多余字段（云端字段比本地表多）
    this._cols = {};
    for (const t of ['Note', 'NoteBook', 'Tag', 'Resource', 'User', 'ToDo', 'ToDoCategory']) {
      this._cols[t] = new Set(
        this.db.prepare(`PRAGMA table_info(${t})`).all().map(r => r.name)
      );
    }
  }

  // 只保留表里真实存在的列，避免云端多余字段导致 INSERT 报错
  _pick(table, obj) {
    const cols = this._cols[table];
    const out = {};
    for (const [k, v] of Object.entries(obj)) {
      if (cols.has(k) && v !== undefined) out[k] = v;
    }
    return out;
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
    const rec = this._pick('Note', n);
    const cols = Object.keys(rec);
    if (!cols.length) return;
    const placeholders = cols.map(() => '?').join(',');
    const updates = cols.filter(c => c !== 'guid').map(c => `${c}=excluded.${c}`).join(',');
    this.db.prepare(
      `INSERT INTO Note (${cols}) VALUES (${placeholders})
       ON CONFLICT(guid) DO UPDATE SET ${updates}`
    ).run(...cols.map(c => rec[c] === null ? null : rec[c]));
  }
  markNoteDirty(guid) {
    this.db.prepare('UPDATE Note SET dirty=1 WHERE guid=?').run(guid);
  }
  // 推送成功后：回写服务端分配的 USN（combineSync 返回 notes:[{guid, updateSequenceNum}]）
  applyServerUsns(items) {
    for (const it of items || []) {
      if (!it?.guid || it.updateSequenceNum == null) continue;
      this.db.prepare('UPDATE Note SET updateSequenceNum=? WHERE guid=?').run(it.updateSequenceNum, it.guid);
    }
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

  // 笔记本列表（含笔记计数）
  listNoteBooks() {
    const books = this.db.prepare('SELECT * FROM NoteBook WHERE deleted=1 ORDER BY sort ASC, createTime ASC').all();
    const counts = new Map();
    for (const r of this.db.prepare(
      'SELECT noteBookGuid, COUNT(*) c FROM Note WHERE deleted=1 AND noteBookGuid IS NOT NULL GROUP BY noteBookGuid'
    ).all()) counts.set(r.noteBookGuid, r.c);
    return books.map(b => ({
      ...b,
      count: counts.get(b.guid) || 0,
      label: b.nameNew || b.name || '未命名笔记本',
    }));
  }

  // 某个笔记本下的笔记
  listNotesByBook(bookGuid) {
    return this.db.prepare('SELECT * FROM Note WHERE deleted=1 AND noteBookGuid=?')
      .all(bookGuid);
  }

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
        // 本地优先：保留本地 content，仅同步服务端元数据
        const local = this.getNote(n.guid);
        if (local) {
          this.upsertNote({ ...n, content: local.content, updateTime: Math.max(n.updateTime || 0, local.updateTime || 0), dirty: local.dirty });
        }
      } else {
        this.upsertNote(n);
      }
    }
    for (const nb of chunk.noteBooks || []) this.upsertNoteBook(nb);
    for (const t of chunk.tags || []) this.upsertTag(t);
    for (const r of chunk.resources || []) this.upsertResource(r);
    // 删除处理：云端 delete / remove 里是完整记录，取 guid 处理
    const guidsOf = arr => (arr || []).map(x => (typeof x === 'string' ? x : x.guid)).filter(Boolean);
    for (const g of guidsOf(chunk.delete?.notes)) this.db.prepare('UPDATE Note SET deleted=0 WHERE guid=?').run(g);
    for (const g of guidsOf(chunk.delete?.noteBooks)) this.db.prepare('UPDATE NoteBook SET deleted=0 WHERE guid=?').run(g);
    for (const g of guidsOf(chunk.remove?.notes)) this.db.prepare('DELETE FROM Note WHERE guid=?').run(g);
    for (const g of guidsOf(chunk.remove?.noteBooks)) this.db.prepare('DELETE FROM NoteBook WHERE guid=?').run(g);
  }
  upsertNoteBook(b) {
    const rec = this._pick('NoteBook', b);
    const cols = Object.keys(rec);
    if (!cols.length) return;
    const ph = cols.map(() => '?').join(',');
    const up = cols.filter(c => c !== 'guid').map(c => `${c}=excluded.${c}`).join(',');
    this.db.prepare(`INSERT INTO NoteBook (${cols}) VALUES (${ph}) ON CONFLICT(guid) DO UPDATE SET ${up}`)
      .run(...cols.map(c => rec[c]));
  }
  upsertTag(t) {
    const rec = this._pick('Tag', t);
    const cols = Object.keys(rec);
    if (!cols.length) return;
    const ph = cols.map(() => '?').join(',');
    const up = cols.filter(c => c !== 'guid').map(c => `${c}=excluded.${c}`).join(',');
    this.db.prepare(`INSERT INTO Tag (${cols}) VALUES (${ph}) ON CONFLICT(guid) DO UPDATE SET ${up}`)
      .run(...cols.map(c => rec[c]));
  }
  upsertResource(r) {
    const rec = this._pick('Resource', r);
    const cols = Object.keys(rec);
    if (!cols.length) return;
    const ph = cols.map(() => '?').join(',');
    const up = cols.filter(c => c !== 'guid').map(c => `${c}=excluded.${c}`).join(',');
    this.db.prepare(`INSERT INTO Resource (${cols}) VALUES (${ph}) ON CONFLICT(guid) DO UPDATE SET ${up}`)
      .run(...cols.map(c => rec[c]));
  }

  // ---- 保存本地笔记（标脏）----
  saveNote(n) {
    const now = Date.now();
    const rec = { ...n, updateTime: now, dirty: 1 };
    if (rec.updateSequenceNum === undefined) rec.updateSequenceNum = undefined;
    this.upsertNote(rec);
  }

  // ---- 待办 ToDo（游标 = MAX(updateTime)，见 analysis/06-todo-sync.md §5.3）----
  upsertTodo(t) {
    const rec = this._pick('ToDo', t);
    const cols = Object.keys(rec);
    if (!cols.length) return;
    const ph = cols.map(() => '?').join(',');
    const up = cols.filter(c => c !== 'guid').map(c => `${c}=excluded.${c}`).join(',');
    this.db.prepare(`INSERT INTO ToDo (${cols}) VALUES (${ph}) ON CONFLICT(guid) DO UPDATE SET ${up}`)
      .run(...cols.map(c => rec[c]));
  }
  saveTodo(t) {
    // content → contentToDo 列名映射（todos_updateTodoSingle 同款）
    const rec = { ...t };
    if (rec.content !== undefined) { rec.contentToDo = rec.content; delete rec.content; }
    rec.updateTime = Date.now();   // 必须单调更新：updateTime 即游标
    rec.dirty = 1;
    this.upsertTodo(rec);
  }
  listTodos({ type = null, limit = 200 } = {}) {
    // 真实待办 type IN (0,1)；分隔线 2/20/21/22 为虚拟行
    let sql = 'SELECT * FROM ToDo WHERE deleted = 1';
    const params = [];
    if (type !== null) { sql += ' AND type = ?'; params.push(type); }
    else sql += ' AND type IN (0, 1)';
    sql += ' ORDER BY sort ASC, updateSequenceNum DESC LIMIT ?';
    params.push(limit);
    return this.db.prepare(sql).all(...params);
  }
  getTodo(guid) { return this.db.prepare('SELECT * FROM ToDo WHERE guid=?').get(guid); }
  todoMaxUpdateTime() {
    const r = this.db.prepare('SELECT MAX(updateTime) AS c FROM ToDo').get();
    return (r && r.c) || 0;
  }
  deleteTodoSoft(guid) {
    const now = Date.now();
    this.db.prepare("UPDATE ToDo SET deleted=-1, dirty=1, updateTime=?, ex1='' WHERE guid=?").run(now, guid);
  }
  applyServerTodos(chunk) {
    // 待办无本地 dirty 优先合并（服务端按 lastUpdateCount 乐观锁），直接覆盖
    for (const t of chunk.todos || []) this.upsertTodo({ ...t, dirty: 0 });
    for (const c of chunk.todoCategories || chunk.categories || []) this.upsertTodoCategory({ ...c, dirty: 0 });
    for (const g of (chunk.delete && chunk.delete.todos) || []) {
      this.db.prepare('UPDATE ToDo SET deleted=-1, dirty=0 WHERE guid=?').run(g);
    }
  }
  upsertTodoCategory(c) {
    const rec = this._pick('ToDoCategory', c);
    const cols = Object.keys(rec);
    if (!cols.length) return;
    const ph = cols.map(() => '?').join(',');
    const up = cols.filter(x => x !== 'guid').map(x => `${x}=excluded.${x}`).join(',');
    this.db.prepare(`INSERT INTO ToDoCategory (${cols}) VALUES (${ph}) ON CONFLICT(guid) DO UPDATE SET ${up}`)
      .run(...cols.map(x => rec[x]));
  }
  listTodoCategories() {
    return this.db.prepare('SELECT * FROM ToDoCategory WHERE deleted=1 ORDER BY colorIndex ASC').all();
  }

  // ---- 用户信息持久化（登录态跨重启保留）----
  saveUser(info) {
    const rec = this._pick('User', {
      userId: info.openId || '',
      openId: info.openId || '',
      token: info.token || '',
      regionCode: info.regionCode || '',
      // deviceId 复用 User 表的 nickName 列存（网关要求 deviceId 头）
      nickName: info.deviceId || '',
    });
    if (!rec.userId) return;
    const cols = Object.keys(rec);
    const ph = cols.map(() => '?').join(',');
    const up = cols.filter(c => c !== 'userId').map(c => `${c}=excluded.${c}`).join(',');
    this.db.prepare(`INSERT INTO User (${cols}) VALUES (${ph}) ON CONFLICT(userId) DO UPDATE SET ${up}`)
      .run(...cols.map(c => rec[c]));
  }
  getUser() {
    return this.db.prepare('SELECT * FROM User LIMIT 1').get() || null;
  }

  close() { this.db.close(); }
}
