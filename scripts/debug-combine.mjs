// 调试 combineSync 20200：打印实际发送的 payload 结构，再逐步裁剪字段定位服务器拒绝的原因。
import { app, session } from 'electron';
import path from 'node:path';
import os from 'node:os';
import { Store } from '../src/sync/store.js';
import { ApiClient } from '../src/net/api-client.js';
import { NoteSyncApi, collectDirty } from '../src/sync/note-sync.js';
import { migrateAccountCookies } from '../src/login/cookies.js';

app.disableHardwareAcceleration();
app.setPath('userData', path.join(os.homedir(), 'AppData', 'Roaming', 'vivo-notes-client'));

app.whenReady().then(async () => {
  await migrateAccountCookies();
  const store = new Store(path.join(app.getPath('userData'), 'notes.db'));
  const u = store.getUser();
  if (!u?.token) { console.log('NO SAVED LOGIN'); app.quit(); return; }

  const client = new ApiClient({
    env: 'prod',
    userInfo: { openId: u.openId, token: u.token, deviceId: u.nickName || u.openId },
  });
  const api = new NoteSyncApi(client);
  const usn = store.getLastUpdateCount();

  // 建一条最小测试笔记
  const guid = 'dbg' + Date.now().toString(36);
  const now = Date.now();
  store.saveNote({
    guid, title: '【调试】combineSync 载荷',
    contentDigest: '调试摘要',
    content: '<p>调试正文</p>',
    originContent: '', conflictTime: null, deleted: 1,
    createTime: now, updateTime: now, contentUpdateTime: now, attrUpdateTime: now,
    stickTop: 0, importantLevel: 0, noteBookGuid: '0', tags: [],
    type: 2, symbolCnf: '', paperTexture: '0', bgColor: 101,
    pageMargins: JSON.stringify([0, 16, 0, 16]),
    syncProtocolVersion: 0, syncLock: 0, encryptType: 0,
  });

  const localData = store.collectLocalData();
  const { createData, updateData, delAndRemoveData } = collectDirty(localData, usn);
  console.log('dirty note in create:', (createData.notes || []).length, 'in update:', (updateData.notes || []).length);
  const note = (createData.notes || [])[0] || (updateData.notes || [])[0];
  if (note) {
    console.log('note payload keys:', Object.keys(note).join(','));
    console.log('note payload:', JSON.stringify({ ...note, content: (note.content || '').slice(0, 40) + '...' }, null, 1).slice(0, 900));
  }

  // 直接打 combineSync，看服务器返回
  const chunk = {
    type: 0, lastUpdateCount: usn,
    createSync: createData, updateSync: updateData, deleteSync: delAndRemoveData,
  };
  try {
    const r = await api.combineSync(chunk);
    console.log('combineSync OK:', JSON.stringify(r).slice(0, 300));
    store.setLastUpdateCount(r.updateCount ?? usn);
    store.clearAllDirty();
    // 云端确认
    const list = await api.getAllNote({ type: 0, afterUsn: 0, maxEntries: 200, syncProtocolVersion: 200 });
    const hit = (list?.notes || []).find(n => n.guid === guid);
    console.log('云端确认:', hit ? `找到 guid=${hit.guid}` : '未找到');
  } catch (e) {
    console.log('combineSync FAIL code=', e.code, 'msg=', e.message);
  }
  app.quit();
}).catch(e => { console.log('ERR', e.stack); app.quit(); });
