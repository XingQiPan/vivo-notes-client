// 走应用真实代码路径（Store + ApiClient + NoteSyncApi）做一次完整同步，验证合并落库。
import { app } from 'electron';
import path from 'node:path';
import os from 'node:os';
import { Store } from '../src/sync/store.js';
import { ApiClient } from '../src/net/api-client.js';
import { NoteSyncApi, syncOnce } from '../src/sync/note-sync.js';

app.disableHardwareAcceleration();
app.setPath('userData', path.join(os.homedir(), 'AppData', 'Roaming', 'vivo-notes-client'));

app.whenReady().then(async () => {
  const store = new Store(path.join(app.getPath('userData'), 'notes.db'));
  const user = store.getUser();
  console.log('stored user:', user ? user.userId : '(none)');
  if (!user?.token) { console.log('NO SAVED LOGIN'); app.quit(); return; }

  const client = new ApiClient({
    env: 'prod',
    userInfo: { openId: user.openId, token: user.token, deviceId: user.nickName || user.openId },
  });
  const api = new NoteSyncApi(client);

  const r = await syncOnce(
    api,
    () => store.getLastUpdateCount(),
    (v) => store.setLastUpdateCount(v),
    store.collectLocalData(),
    (chunk) => store.applyServerChunk(chunk)
  );
  console.log('sync result:', JSON.stringify(r));
  console.log('local notes:', store.listNotes({ limit: 500 }).length);
  console.log('lastUpdateCount now:', store.getLastUpdateCount());
  const notes = store.listNotes({ limit: 500 });
  for (const n of notes.slice(0, 12)) {
    console.log('  -', JSON.stringify(n.title || '').slice(0, 50),
      '| book:', n.noteBookGuid ? n.noteBookGuid.slice(0, 8) : '-',
      '| upd:', n.updateTime, '| len:', (n.content || '').length);
  }
  app.quit();
}).catch(e => { console.log('ERR', e.stack); app.quit(); });
