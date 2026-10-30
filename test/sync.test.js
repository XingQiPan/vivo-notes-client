// 同步引擎 + 存储层 单测（node --test）
import { test } from 'node:test';
import assert from 'node:assert';
import { Store } from '../src/sync/store.js';
import { collectDirty, splitCombineSync, pushAll, pullAll, NoteSyncApi } from '../src/sync/note-sync.js';

test('Store: USN 游标读写', () => {
  const s = new Store(':memory:');
  assert.strictEqual(s.getLastUpdateCount(), 0);
  s.setLastUpdateCount(12345);
  assert.strictEqual(s.getLastUpdateCount(), 12345);
  s.setLastUpdateCount(99);
  assert.strictEqual(s.getLastUpdateCount(), 99);
  s.close();
});

test('Store: 保存笔记标脏 + collectLocalData', () => {
  const s = new Store(':memory:');
  s.saveNote({ guid: 'n1', title: 'A', content: 'hi', deleted: 1, createTime: 1 });
  const ld = s.collectLocalData();
  assert.strictEqual(ld.notes.length, 1);
  assert.strictEqual(ld.notes[0].guid, 'n1');
  assert.strictEqual(ld.notes[0].dirty, 1);
  s.close();
});

test('collectDirty: 无 updateSequenceNum → createData', () => {
  const ld = {
    notes: [{ guid: 'n1', title: 'A', content: 'x', originContent: 'y', dirty: 1, deleted: 1 }],
    tags: [], resources: [], noteBooks: [], deleteResourceGuids: [],
  };
  const { createData, updateData } = collectDirty(ld, 100);
  assert.strictEqual(createData.notes.length, 1);
  assert.strictEqual(updateData.notes.length, 0);
});

test('collectDirty: 内容未变则省略 content', () => {
  const ld = {
    notes: [{ guid: 'n1', title: 'A', content: 'same', originContent: 'same', dirty: 1, deleted: 1, updateSequenceNum: 5 }],
    tags: [], resources: [], noteBooks: [], deleteResourceGuids: [],
  };
  const { updateData } = collectDirty(ld, 100);
  assert.strictEqual('content' in updateData.notes[0], false);
});

test('collectDirty: 内容清空 → contentKey=0', () => {
  const ld = {
    notes: [{ guid: 'n1', title: 'A', content: '', originContent: 'old', dirty: 1, deleted: 1, updateSequenceNum: 5 }],
    tags: [], resources: [], noteBooks: [], deleteResourceGuids: [],
  };
  const { updateData } = collectDirty(ld, 100);
  assert.strictEqual(updateData.notes[0].contentKey, '0');
});

test('splitCombineSync: 按 30 切块', () => {
  const notes = Array.from({ length: 65 }, (_, i) => ({ guid: 'g' + i, dirty: 1, updateSequenceNum: 1, deleted: 1 }));
  const chunks = splitCombineSync({ lastUpdateCount: 0, updateData: { notes, tags: [], resources: [], noteBooks: [] } }, 30);
  assert.strictEqual(chunks.length, 3);
  assert.strictEqual(chunks[0].updateSync.notes.length, 30);
  assert.strictEqual(chunks[2].updateSync.notes.length, 5);
});

test('pushAll: 全脏数据为空时跳过', async () => {
  const calls = [];
  const fakeApi = {
    createSync: async (d) => { calls.push(['create', d]); },
    updateSync: async (d) => { calls.push(['update', d]); },
    combineSync: async (d) => { calls.push(['combine', d]); return { updateCount: 1 }; },
  };
  const r = await pushAll(fakeApi, { notes: [], tags: [], resources: [], noteBooks: [], deleteResourceGuids: [] }, 0);
  assert.strictEqual(r.skipped, true);
  assert.strictEqual(calls.length, 0);
});

test('pushAll: 有脏数据 → 合并进 combineSync 分块提交', async () => {
  const calls = [];
  const fakeApi = {
    createSync: async (d) => { calls.push('create'); },
    updateSync: async (d) => { calls.push('update'); },
    combineSync: async (d) => { calls.push('combine'); return { updateCount: 7 }; },
  };
  const ld = {
    notes: [
      { guid: 'n1', title: 'A', content: 'x', originContent: 'y', dirty: 1, deleted: 1 },
      { guid: 'n2', title: 'B', content: 'z', originContent: 'w', dirty: 1, deleted: 1, updateSequenceNum: 5 },
    ],
    tags: [], resources: [], noteBooks: [], deleteResourceGuids: [],
  };
  const r = await pushAll(fakeApi, ld, 0);
  // 真机验证：create/update 不单独发请求，全部合并进 combineSync（payload 内含 createSync/updateSync 字段）
  assert.strictEqual(calls.includes('create'), false);
  assert.strictEqual(calls.includes('update'), false);
  assert.ok(calls.includes('combine'));
  assert.strictEqual(r.newLastUpdateCount, 7);
});

test('pullAll: 游标用 chunkHighUsn 推进，直到追上 updateCount', async () => {
  let usn = 0;
  const setUsn = (v) => { usn = v; };
  const getUsn = () => usn;
  let n = 0;
  const fakeApi = {
    fetchSyncData: async ({ afterUsn }) => {
      n++;
      const chunkHighUsn = afterUsn + 100;
      // updateCount 恒为 300（服务端总量）；chunkHighUsn 逐批追平
      return { notes: [], noteBooks: [], tags: [], resources: [], updateCount: 300, chunkHighUsn };
    },
  };
  await pullAll(fakeApi, getUsn, setUsn, async () => {});
  assert.strictEqual(n, 3);   // 100 → 200 → 300 三批
  assert.strictEqual(usn, 300);
});

test('Store: applyServerChunk 本地 dirty 优先', () => {
  const s = new Store(':memory:');
  s.saveNote({ guid: 'n1', title: 'local', content: 'LOCAL', deleted: 1, createTime: 1, updateTime: 1 });
  // 服务端返回同 guid 但不同 content
  s.applyServerChunk({
    notes: [{ guid: 'n1', title: 'server', content: 'SERVER', deleted: 1, updateTime: 2 }],
    noteBooks: [], tags: [], resources: [],
  });
  const n = s.getNote('n1');
  assert.strictEqual(n.content, 'LOCAL', '本地 dirty 内容应保留');
  s.close();
});
