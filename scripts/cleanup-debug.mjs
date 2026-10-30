// 清理云端调试笔记：标记删除 → 推送 → 确认。
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

  const client = new ApiClient({
    env: 'prod',
    userInfo: { openId: u.openId, token: u.token, deviceId: u.nickName || u.openId },
  });
  const api = new NoteSyncApi(client);

  // 本地把调试笔记标记软删除（云端语义 deleted=-1 = 移入回收站）
  const guids = store.db.prepare("SELECT guid FROM Note WHERE guid LIKE 'dbg%' OR guid LIKE 'test%'").all().map(r => r.guid);
  console.log('待清理:', guids.length, '条');
  for (const g of guids) {
    store.upsertNote({ guid: g, deleted: -1 });
    store.markNoteDirty(g);
  }

  const r = await syncOnce(
    api,
    () => store.getLastUpdateCount(),
    (v) => store.setLastUpdateCount(v),
    store.collectLocalData(),
    (chunk) => store.applyServerChunk(chunk)
  );
  console.log('删除推送:', JSON.stringify(r));
  if (r.direction === 'push' && !r.skipped) {
    for (const res of r.results || []) store.applyServerUsns(res?.notes);
    if (r.newLastUpdateCount != null) store.setLastUpdateCount(r.newLastUpdateCount);
    store.clearAllDirty();
    console.log('USN 已回写，游标:', store.getLastUpdateCount());
  }

  // 云端确认已删除
  const list = await api.getAllNote({ type: 0, afterUsn: 0, maxEntries: 200, syncProtocolVersion: 200 });
  const left = (list?.notes || []).filter(n => n.guid.startsWith('dbg') || n.guid.startsWith('test'));
  console.log('云端残留调试笔记:', left.length);
  for (const app of left) console.log(' -', app.guid, 'deleted:', app.deleted);

  // 本地也删掉
  for (const g of guids) store.db.prepare('DELETE FROM Note WHERE guid=?').run(g);
  console.log('本地已清理');
  app.quit();
}).catch(e => { console.log('ERR', e.stack); app.quit(); });
