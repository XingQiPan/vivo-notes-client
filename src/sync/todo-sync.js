// 待办云同步引擎 —— 复用笔记的 /sync/* 引擎（SyncType.Todo=1），
// 推送走 todoList/{create,update,expunge}/v2 即时单请求（无 combineSync 分块）。
// 详见 analysis/06-todo-sync.md。

import { ApiClient } from '../net/api-client.js';
import { PROXY_ENUM } from '../config.js';

const NOTE = 'NOTE_PROXY';

// TodoItemType（module 6504）：分隔线类型是本地虚拟行，不参与同步
export const TodoItemType = {
  Undo: 0, Complete: 1, GroupLine: 2,
  UndoEmpty: 20, UnCompleteLine: 21, CompleteLine: 22,
};
export const REAL_TYPES = [TodoItemType.Undo, TodoItemType.Complete]; // type IN (0,1)

// 更新前必须剔除的 UI 临时字段（todos_updateTodoSingle @4017818）
const UI_ONLY_FIELDS = ['content', 'id', 'createTime', 'noticeType', 'updateSequenceNum',
  'ex1', 'ex2', 'ex3', 'children', 'isEnterEdit', 'isExpand', 'createdType',
  'isCreatedTodo', 'isNewAuotOutside', 'hasDate', 'description', 'hasAlarm',
  'reminderList', 'hasTime', 'dateValue', 'timeValue', 'reminderTimeStr', 'relativeTimeStr'];

export class TodoSyncApi {
  constructor(client) { this.client = client; }

  // 复用 /sync/* 引擎，type=1
  getSyncState() {
    return this.client.request({ url: '/sync/getSyncState', method: 'POST', proxy: NOTE, data: { type: 1 } });
  }
  fetchSyncChunk({ afterUsn, maxEntries = 200, syncProtocolVersion = 200 }) {
    return this.client.request({
      url: '/sync/getSyncChunk/v2', method: 'POST', proxy: NOTE, encrypt: true,
      data: { type: 1, afterUsn, maxEntries, syncProtocolVersion },
    });
  }
  // 全量列表（Web 版拉取用；PC 复刻版拉 getSyncChunk 增量即可）
  getTodoList(data = {}) {
    return this.client.request({
      url: '/todoList/getList/v2', method: 'POST', proxy: NOTE, encrypt: true,
      data: { maxEntries: 1e6, ...data },
    });
  }
  createTodo(lastUpdateCount, syncUp) {
    return this.client.request({
      url: '/todoList/create/v2', method: 'POST', proxy: NOTE, encrypt: true,
      data: { lastUpdateCount, syncUp: syncUp.map(trimTodo) },
    });
  }
  updateTodo(lastUpdateCount, syncUp) {
    const now = Date.now();
    return this.client.request({
      url: '/todoList/update/v2', method: 'POST', proxy: NOTE, encrypt: true,
      data: { lastUpdateCount, syncUp: syncUp.map(t => trimTodo({ ...t, updateTime: now })) },
    });
  }
  deleteTodo(lastUpdateCount, deleteGuids) {
    return this.client.request({
      url: '/todoList/expunge', method: 'POST', proxy: NOTE, encrypt: true,
      data: { lastUpdateCount, delete: deleteGuids },
    });
  }
}

// payload 裁剪：content→contentToDo、剔 UI 临时字段、分隔线类型不同步
export function trimTodo(t) {
  if (REAL_TYPES.indexOf(t.type) === -1) return null; // 虚拟行丢弃
  const out = {};
  for (const k of Object.keys(t)) {
    if (UI_ONLY_FIELDS.indexOf(k) === -1) out[k] = t[k];
  }
  if (t.content !== undefined) out.contentToDo = t.content;
  out.dirty = 1;
  return out;
}

// 推送单条变更（事件驱动：先刷游标 → 立即推 → 回写游标）
export async function pushTodoChange(api, { action, payload }, getUsn, setUsn) {
  const st = await api.getSyncState();
  const lastUpdateCount = (st && st.updateCount) || getUsn();
  let res;
  if (action === 'create') res = await api.createTodo(lastUpdateCount, payload);
  else if (action === 'update') res = await api.updateTodo(lastUpdateCount, payload);
  else if (action === 'delete') res = await api.deleteTodo(lastUpdateCount, payload);
  else throw new Error('unknown action: ' + action);
  // 响应 Array<{guid, updateSequenceNum}>，取最后一个回写游标
  if (Array.isArray(res) && res.length) {
    const last = res[res.length - 1];
    if (last && last.updateSequenceNum) setUsn(last.updateSequenceNum);
  }
  return res;
}

// 拉取增量（与笔记同构：递归直到 updateCount === chunkHighUsn）
export async function pullTodos(api, getUsn, setUsn, applyServerData) {
  let usn = getUsn();
  const round = async () => {
    const chunk = await api.fetchSyncChunk({ afterUsn: usn, maxEntries: 200, syncProtocolVersion: 200 });
    if (chunk && chunk.updateCount) { usn = chunk.updateCount; setUsn(usn); }
    await applyServerData(chunk);
    if (chunk && chunk.updateCount !== chunk.chunkHighUsn) await round();
  };
  await round();
  return usn;
}
