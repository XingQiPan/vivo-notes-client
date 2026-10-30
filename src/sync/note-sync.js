// 笔记云同步引擎 —— 复刻 requestBranch 双通道 + USN 游标增量同步。
// 详见 analysis/04-note-sync.md。
//
// 双通道分流（核心纠偏点）：
//   sync:true  → 本地 SQLite（不发网络）
//   sync:false → 真 HTTP（经 Maodun 加密）
// 本引擎同时承担"拉取"和"推送"两个方向，用 ApiClient 发请求。

import { ApiClient } from '../net/api-client.js';
import { PROXY_ENUM } from '../config.js';

const NOTE = 'NOTE_PROXY';

// ---- 同步端点封装（module 1685 / 125）----
export class NoteSyncApi {
  constructor(client) { this.client = client; }

  getSyncState(type = 0) {
    return this.client.request({ url: '/sync/getSyncState', method: 'POST', proxy: NOTE, data: { type } });
  }
  fetchSyncData({ afterUsn, maxEntries = 200, syncProtocolVersion = 200, type = 0 }) {
    return this.client.request({
      url: '/sync/getSyncChunk/v2', method: 'POST', proxy: NOTE, encrypt: true,
      data: { type, afterUsn, maxEntries, syncProtocolVersion },
    });
  }  createSync(data) {
    return this.client.request({ url: '/sync/createSync/v2', method: 'POST', proxy: NOTE, encrypt: true, data });
  }
  updateSync(data) {
    return this.client.request({ url: '/sync/updateSync/v2', method: 'POST', proxy: NOTE, encrypt: true, data });
  }
  combineSync(data) {
    return this.client.request({ url: '/sync/combineSync/v2', method: 'POST', proxy: NOTE, encrypt: true, data });
  }
  deleteSync(data) {
    return this.client.request({ url: '/sync/deleteSync', method: 'POST', proxy: NOTE, data });
  }

  // ---- 列表与正文（正文不在增量包里，需按需单独取）----
  // getAllNote 返回带标题的笔记清单（content 为空）；getContent 取单篇正文。
  getAllNote({ type = 0, afterUsn = 0, maxEntries = 200, syncProtocolVersion = 200 }) {
    return this.client.request({
      url: '/note/getAllNote/v2', method: 'POST', proxy: NOTE, encrypt: true,
      data: { type, afterUsn, maxEntries, syncProtocolVersion },
    });
  }
  getNoteContent(guid) {
    return this.client.request({
      url: '/note/getContent/v2', method: 'POST', proxy: NOTE, encrypt: true,
      data: { guid },
    });
  }
  getSingleNote(guid) {
    return this.client.request({
      url: '/note/getIncludeItem/v2', method: 'POST', proxy: NOTE, encrypt: true,
      data: { guid, syncProtocolVersion: 200 },
    });
  }
}

// ---- 脏数据收集（复刻 getSyncUpdateDataFromLocalData 的 T()）----
// localData: { notes:[], tags:[], resources:[], noteBooks:[], deleteResourceGuids:[] }
export function collectDirty(localData, lastUpdateCount) {
  const create = { type: 0, lastUpdateCount, noteBooks: [], notes: [], tags: [], resources: [] };
  const update = { type: 0, lastUpdateCount, noteBooks: [], notes: [], tags: [], resources: [] };
  const del = {
    type: 0, lastUpdateCount,
    delete: { noteBooks: [], notes: [], tags: [], resources: [] },
    remove: { noteBooks: [], notes: [], tags: [], resources: [] },
  };
  const removeNoteInUpdateGuids = [];

  const trim = (n) => {
    const t = { ...n };
    if (t.content === t.originContent) {
      delete t.content;
    } else if (t.originContent !== '' && t.content === '') {
      delete t.content;
      t.contentKey = '0';
    }
    delete t.originContent;
    return t;
  };

  for (const n of localData.notes || []) {
    if (!n.dirty) continue;
    // SQLite 里未同步过的笔记 updateSequenceNum 是 null（不是 undefined），两者都要算"新建"
    if (n.updateSequenceNum === undefined || n.updateSequenceNum === null) {
      if (isNotEmptyNote(n)) create.notes.push(trim(n));
    } else if (n.deleted === -1) {
      // 云端语义：deleted=-1 = 移入回收站（软删除）→ 走 deleteSync 的 notes 列表
      del.delete.notes.push(n.guid);
    } else if (n.deleted === 0) {
      // deleted=0 = 彻底移除 → 走 deleteSync 的 remove 列表
      del.remove.notes.push(n.guid);
    } else {
      update.notes.push(trim(n));
    }
  }
  for (const t of localData.tags || []) {
    if (!t.dirty) continue;
    if (t.updateSequenceNum === undefined) create.tags.push(t);
    else if (t.deleted === -1) del.delete.tags.push(t.guid);
    else update.tags.push(t);
  }
  for (const r of localData.resources || []) {
    if (!r.dirty) continue;
    if (r.updateSequenceNum === undefined) { if (r.deleted !== 0) create.resources.push(r); }
    else if (r.deleted === 0) {
      if (!(localData.deleteResourceGuids || []).includes(r.guid)) del.remove.resources.push(r.guid);
    } else update.resources.push(r);
  }
  if ((localData.deleteResourceGuids || []).length && del.delete.resources) {
    del.delete.resources = [...del.delete.resources, ...localData.deleteResourceGuids];
  }
  return { createData: create, updateData: update, delAndRemoveData: del, removeNoteInUpdateGuids };
}

function isNotEmptyNote(n) {
  return n.title !== '' || (n.content && n.content !== '' && !/^\s*$/.test(n.content));
}

// ---- 分块提交（复刻 splitCombineSync + doSyncCombineSync）----
export function splitCombineSync(payload, size = 30) {
  const chunks = [];
  const all = [
    ['notes', payload.updateData?.notes],
    ['tags', payload.updateData?.tags],
    ['resources', payload.updateData?.resources],
  ];
  // 简化：按 notes 主维度切；实际生产需对每类分别切，这里保留接口形状
  const notes = payload.updateData?.notes || [];
  for (let i = 0; i < notes.length; i += size) {
    chunks.push({
      type: 0,
      lastUpdateCount: payload.lastUpdateCount,
      createSync: i === 0 ? payload.createData : undefined,
      updateSync: { ...payload.updateData, notes: notes.slice(i, i + size) },
      deleteSync: i === 0 ? payload.delAndRemoveData : undefined,
    });
  }
  if (chunks.length === 0) {
    chunks.push({ type: 0, lastUpdateCount: payload.lastUpdateCount,
      createSync: payload.createData, updateSync: payload.updateData, deleteSync: payload.delAndRemoveData });
  }
  return chunks;
}

// ---- 推送主流程（doSaveAllService）----
// 原版流程：createSync/updateSync 端点只用于"类别 10 资源"预处理（handleCategory10Resource），
// 笔记/标签真正的传输全部走 combineSync（splitCombineSync 分块）。
// 所以这里只调 combineSync；createData/updateData/deleteSync 作为每块的子载荷携带。
// combineSync 返回 {updateCount}，即推送后的新 USN 游标，调用方回写并清脏标记。
export async function pushAll(api, localData, lastUpdateCount, hooks = {}) {
  const { createData, updateData, delAndRemoveData, removeNoteInUpdateGuids } = collectDirty(localData, lastUpdateCount);
  if (isEmpty(createData) && isEmpty(updateData) && isEmpty(delAndRemoveData.delete) && isEmpty(delAndRemoveData.remove)) {
    return { skipped: true };
  }
  const payload = { lastUpdateCount, createData, updateData, delAndRemoveData, removeNoteInUpdateGuids };
  const chunks = splitCombineSync(payload, 30);
  let s = lastUpdateCount;
  const results = [];
  for (const c of chunks) {
    c.lastUpdateCount = s;
    try {
      const r = await api.combineSync(c);
      s = r.updateCount ?? s;
      results.push(r);
    } catch (e) {
      if (e.code === 50300) {
        const { type, uniqueKey } = e.data || {};
        if (type === 'v_resource') {
          const res = (localData.resources || []).find(x => x.guid === uniqueKey);
          if (res) res.updateSequenceNum = 1;
        }
      }
      throw e;
    }
  }
  return { results, newLastUpdateCount: s };
}

function isEmpty(d) {
  return !d || (['noteBooks', 'notes', 'tags', 'resources'].every(k => !(d[k] && d[k].length))
    && !(d.delete && anyList(d.delete)) && !(d.remove && anyList(d.remove)));
}
function anyList(d) {
  return ['noteBooks', 'notes', 'tags', 'resources'].some(k => d[k] && d[k].length);
}

// ---- 拉取主流程（getLastestSyncData，递归续拉）----
// 游标推进用 chunkHighUsn（本批数据的最高 USN），不是 updateCount（服务端总量）。
// 实测：afterUsn=0 → chunkHighUsn=2422 → 3798 → 4482 == updateCount，
// 若用 updateCount 直接跳到 4482 会漏掉中间两批。
export async function pullAll(api, getUsn, setUsn, applyServerData) {
  let usn = getUsn();
  const round = async () => {
    const t0 = Date.now();
    const chunk = await api.fetchSyncData({ afterUsn: usn, maxEntries: 200, syncProtocolVersion: 200, type: 0 });
    console.log('[pull] afterUsn=%s -> chunkHighUsn=%s updateCount=%s notes=%s 用时%sms',
      usn, chunk?.chunkHighUsn, chunk?.updateCount,
      (chunk?.notes || []).length, Date.now() - t0);
    await applyServerData(chunk);
    const next = chunk?.chunkHighUsn;
    if (next != null && next !== usn) { usn = next; setUsn(usn); }
    // 还有增量（chunkHighUsn 未追上服务端总量）就继续拉
    if (chunk?.chunkHighUsn !== chunk?.updateCount) await round();
  };
  await round();
  return usn;
}

// ---- 标题补全 ----
// 增量包里的 notes 常带空 content（正文要单独取），但标题（title）也在包里；
// getAllNote 则是带完整标题的清单。这里用 getAllNote 补全标题，
// 让列表能显示"标题 + 摘要"，正文仍然按需再取。
export async function fetchNoteTitles(api, usn) {
  const r = await api.getAllNote({ type: 0, afterUsn: usn, maxEntries: 200, syncProtocolVersion: 200 });
  return r?.notes || [];
}

// ---- 调度决策（fetchSyncState）----
// 原版 fetchSyncState：getSyncState(0) → {updateCount, hisSyncType}
//   updateCount > 本地 USN → 拉取；否则 → 推送。
// 注意：原版 getSyncState 不加密（syncName:"getSyncState"，无 encrypt 标志）。
export async function syncOnce(api, getUsn, setUsn, localData, applyServerData) {
  const st = await api.getSyncState(0);
  const serverUsn = st.updateCount;
  const localUsn = getUsn();
  console.log('[sync] state: serverUsn=%s localUsn=%s hisSyncType=%s', serverUsn, localUsn, st.hisSyncType);
  if (serverUsn > localUsn) {
    await pullAll(api, getUsn, setUsn, applyServerData);
    return { direction: 'pull', serverUsn };
  } else {
    const r = await pushAll(api, localData, localUsn);
    return { direction: 'push', ...r };
  }
}

export { ApiClient };
