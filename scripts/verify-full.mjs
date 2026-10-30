// 用应用真实代码路径跑一次完整同步（含耗时），验证列表/笔记本/正文。
import { app, session } from 'electron';
import path from 'node:path';
import os from 'node:os';
import { Store } from '../src/sync/store.js';
import { ApiClient } from '../src/net/api-client.js';
import { NoteSyncApi, syncOnce, fetchNoteTitles } from '../src/sync/note-sync.js';
import { migrateAccountCookies } from '../src/login/cookies.js';

app.disableHardwareAcceleration();
app.setPath('userData', path.join(os.homedir(), 'AppData', 'Roaming', 'vivo-notes-client'));

app.whenReady().then(async () => {
  await migrateAccountCookies();
  const store = new Store(path.join(app.getPath('userData'), 'notes.db'));

  const cookies = await session.defaultSession.cookies.get({});
  const byName = n => {
    const c = cookies.find(x => x.name === n && /vivo\.com\.cn$/.test(x.domain.replace(/^\./, '')));
    return (c || cookies.find(x => x.name === n) || {}).value || '';
  };
  const token = byName('vivo_account_cookie_iqoo_vivotoken');
  const openId = byName('vivo_account_cookie_iqoo_openid');
  const deviceId = byName('vivo_account_cookie_iqoo_deviceid');
  if (!token) { console.log('NO TOKEN'); app.quit(); return; }

  const client = new ApiClient({ env: 'prod', userInfo: { openId, token, deviceId } });
  const api = new NoteSyncApi(client);

  const t0 = Date.now();
  const r = await syncOnce(
    api,
    () => store.getLastUpdateCount(),
    (v) => store.setLastUpdateCount(v),
    store.collectLocalData(),
    (chunk) => store.applyServerData(chunk)
  );
  console.log('sync:', JSON.stringify(r), '总耗时', Date.now() - t0, 'ms');

  const t1 = Date.now();
  const list = await fetchNoteTitles(api, store.getLastUpdateCount());
  console.log('getAllNote:', list.length, '条，耗时', Date.now() - t1, 'ms');
  let withTitle = 0;
  for (const n of list) {
    if (n.title) withTitle++;
    if (n.title || n.contentDigest) {
      store.upsertNote({ guid: n.guid, title: n.title, contentDigest: n.contentDigest, dirty: 0 });
    }
  }
  console.log('带标题:', withTitle);

  console.log('本地笔记数:', store.listNotes({ limit: 1000 }).length);
  console.log('笔记本数:', store.listNoteBooks().length);
  for (const b of store.listNoteBooks().slice(0, 12)) console.log('  📂', b.label, '->', b.count);

  const sample = store.listNotes({ limit: 1000 }).find(n => n.title);
  if (sample) {
    console.log('样本笔记:', sample.title);
    const t2 = Date.now();
    const html = await api.getNoteContent(sample.guid);
    console.log('取正文耗时', Date.now() - t2, 'ms, 长度', (html || '').length);
    console.log('正文前120字:', String(html || '').replace(/<[^>]+>/g, '').slice(0, 120));
  }
  app.quit();
}).catch(e => { console.log('ERR', e.stack); app.quit(); });
