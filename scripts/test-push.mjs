// 端到端推送验证：创建一篇测试笔记 → syncOnce 推送 → 云端确认 → 删除 → 再推送。
// 验证手机端能否看到（用 getAllNote 查标题）。
import { app, session } from 'electron';
import path from 'node:path';
import os from 'node:os';
import { Store } from '../src/sync/store.js';
import { ApiClient } from '../src/net/api-client.js';
import { NoteSyncApi, syncOnce } from '../src/sync/note-sync.js';
import { migrateAccountCookies } from '../src/login/cookies.js';

app.disableHardwareAcceleration();
app.setPath('userData', path.join(os.homedir(), 'AppData', 'Roaming', 'vivo-notes-client'));

app.whenReady().then(async () => {
  await migrateAccountCookies();
  const store = new Store(path.join(app.getPath('userData'), 'notes.db'));
  const u = store.getUser();
  if (!u?.token) { console.log('NO SAVED LOGIN'); app.quit(); return; }
  console.log('login:', u.userId);

  const client = new ApiClient({
    env: 'prod',
    userInfo: { openId: u.openId, token: u.token, deviceId: u.nickName || u.openId },
  });
  const api = new NoteSyncApi(client);

  const doSync = () => syncOnce(
    api,
    () => store.getLastUpdateCount(),
    (v) => store.setLastUpdateCount(v),
    store.collectLocalData(),
    (chunk) => store.applyServerChunk(chunk)
  );

  // 1) 建一篇测试笔记（字段对齐原版 createNoteObject 的形状）
  const guid = 'test' + Date.now().toString(36);
  const now = Date.now();
  store.saveNote({
    guid,
    title: '【复刻客户端测试】同步到手机验证',
    contentDigest: '如果你在手机 vivo 笔记里看到这条，说明链路通了。'.slice(0, 60),
    content: '<p>如果你在手机 vivo 笔记里看到这条，说明 PC 复刻客户端 → 云端 → 手机的链路通了。</p>',
    originContent: '',
    conflictTime: null,
    deleted: 1,
    createTime: now,
    updateTime: now,
    contentUpdateTime: now,
    attrUpdateTime: now,
    stickTop: 0,
    importantLevel: 0,
    noteBookGuid: '0',
    tags: [],
    type: 2,
    symbolCnf: '',
    paperTexture: '0',
    bgColor: 101,
    pageMargins: JSON.stringify([0, 16, 0, 16]),
    syncProtocolVersion: 0,
    syncLock: 0,
    encryptType: 0,
  });
  console.log('本地已建测试笔记:', guid);

  // 2) 推送
  const r1 = await doSync();
  console.log('推送结果:', JSON.stringify(r1));
  if (r1.direction === 'push' && !r1.skipped && r1.newLastUpdateCount != null) {
    store.setLastUpdateCount(r1.newLastUpdateCount);
    store.clearAllDirty();
    console.log('游标推进到', r1.newLastUpdateCount, '，脏标记已清');
  }

  // 3) 从云端确认（getAllNote 里搜标题）
  const list = await api.getAllNote({ type: 0, afterUsn: 0, maxEntries: 200, syncProtocolVersion: 200 });
  const hit = (list?.notes || []).find(n => n.title && n.title.includes('复刻客户端测试'));
  console.log('云端确认:', hit ? `找到！guid=${hit.guid} updateTime=${hit.updateTime}` : '未找到（推送可能没成功）');

  // 4) 清理：标记删除并再推一次
  if (hit) {
    store.markNoteDirty(guid);
    store.upsertNote({ guid, deleted: 0 }); // 云端语义：0 = 已删
    const r2 = await doSync();
    console.log('删除推送:', JSON.stringify(r2));
    if (r2.direction === 'push' && !r2.skipped && r2.newLastUpdateCount != null) {
      store.setLastUpdateCount(r2.newLastUpdateCount);
      store.clearAllDirty();
    }
    console.log('done');
  }
  app.quit();
}).catch(e => { console.log('ERR', e.stack); app.quit(); });
