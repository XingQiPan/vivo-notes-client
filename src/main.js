// Electron 主进程：装配 登录 / 存储 / 同步，暴露 IPC 给渲染层。

import { app, BrowserWindow, ipcMain, session } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Store } from './sync/store.js';
import { ApiClient } from './net/api-client.js';
import { NoteSyncApi, syncOnce, fetchNoteTitles } from './sync/note-sync.js';
import { openLoginWindow } from './login/login-window.js';
import { migrateAccountCookies } from './login/cookies.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// 无 GPU 的服务器/沙箱环境下 Electron 会崩，统一禁用硬件加速
app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-gpu');
app.commandLine.appendSwitch('no-sandbox');
app.commandLine.appendSwitch('disable-software-rasterizer');

let store, client, syncApi;
let userInfo = {};
let mainWindow = null;

async function boot() {
  store = new Store(path.join(app.getPath('userData'), 'notes.db'));
  // 恢复上次的登录态：优先 User 表，没有则从默认 session 的账号 cookie 恢复
  //（cookie 在 defaultSession 里跨重启持久化，token 就存在 vivo_account_cookie_iqoo_vivotoken 里）
  const u = store.getUser();
  if (u?.token) {
    userInfo = {
      openId: u.openId, token: u.token,
      regionCode: u.regionCode,
      deviceId: u.nickName || u.openId,
    };
    console.log('[boot] 从 User 表恢复登录:', u.userId);
  } else {
    const s = session.defaultSession;
    const cookies = await s.cookies.get({});
    const pick = n => (cookies.find(c => c.name === n && /vivo\.com\.cn$/.test(c.domain.replace(/^\./, '')))
      || cookies.find(c => c.name === n) || {}).value || '';
    const token = pick('vivo_account_cookie_iqoo_vivotoken');
    const openId = pick('vivo_account_cookie_iqoo_openid');
    if (token && openId) {
      userInfo = {
        openId, token,
        regionCode: pick('vivo_account_cookie_iqoo_regioncode'),
        deviceId: pick('vivo_account_cookie_iqoo_deviceid') || openId,
      };
      store.saveUser(userInfo);
      console.log('[boot] 从 cookie 恢复登录:', openId);
    }
  }
  client = new ApiClient({ env: process.env.VIVO_ENV || 'prod', userInfo });
  syncApi = new NoteSyncApi(client);
  // 首次启动预置演示数据（仅本地，不联网）
  if (process.env.VIVO_DEMO && store.listNotes({ limit: 1 }).length === 0) {
    const now = Date.now();
    store.saveNote({ guid: 'demo1', title: '项目会议纪要', content: '<p>讨论 Q4 计划与排期</p><ul><li>登录链路</li><li>同步引擎</li></ul>', deleted: 1, createTime: now - 86400000 });
    store.saveNote({ guid: 'demo2', title: '待办：对接 vivo API', content: '<p><b>登录</b> + <i>同步</i> 两条链路，TinyMCE 已接入</p>', deleted: 1, createTime: now - 3600000 });
    store.saveNote({ guid: 'demo3', title: '随手记', content: '<p>Maodun 信封加密已验证 ✓</p>', deleted: 1, createTime: now - 60000 });
    // 演示数据已入库，清掉 dirty（否则点同步会真发请求）
    store.clearAllDirty();
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280, height: 820, minWidth: 1000, minHeight: 640,
    title: 'vivo办公套件 · 笔记（复刻）',
    backgroundColor: '#ffffff',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'ui', 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  mainWindow.loadFile(path.join(__dirname, 'ui', 'index.html'));
}

// ---- IPC ----
ipcMain.handle('login', async () => {
  const ui = await openLoginWindow({ env: process.env.VIVO_ENV || 'prod' });
  userInfo = { ...ui, deviceId: ui.vivo_account_cookie_iqoo_deviceid };
  client.userInfo = userInfo;
  store.saveUser(userInfo);
  // 诊断：登录后 dump 各字段长度 + 登录分区 cookie 名
  const s = session.fromPartition('persist:login');
  const cookies = await s.cookies.get({});
  console.log('[login] fields:', JSON.stringify(Object.fromEntries(Object.entries(ui).map(([k, v]) => [k, String(v).length]))));
  console.log('[login] cookies:', cookies.map(c => `${c.domain}:${c.name}`).join(' '));
  return { ok: true, openId: userInfo.openId };
});

ipcMain.handle('logout', async () => {
  userInfo = {};
  client.userInfo = {};
  return { ok: true };
});

ipcMain.handle('isLogin', () => !!userInfo.token);

ipcMain.handle('notes:list', (_e, opts) => store.listNotes(opts || {}));
ipcMain.handle('notes:get', (_e, guid) => store.getNote(guid));
ipcMain.handle('notes:save', (_e, n) => { store.saveNote(n); return { ok: true }; });

// 取正文：本地没有就向云端按需取（增量包里 content 是空的）
ipcMain.handle('notes:content', async (_e, guid) => {
  const local = store.getNote(guid);
  if (local?.content) return { content: local.content, from: 'local' };
  if (!userInfo?.token) return { content: '', error: '未登录' };
  try {
    const html = await syncApi.getNoteContent(guid);
    const content = typeof html === 'string' ? html : (html?.content || '');
    if (content) {
      store.upsertNote({ guid, content, dirty: 0 });
    }
    return { content, from: 'cloud' };
  } catch (e) {
    console.log('[content] 失败:', e.message);
    return { content: '', error: e.message };
  }
});

// 笔记本列表（侧边栏文件夹树）
ipcMain.handle('books:list', (_e) => store.listNoteBooks());

// 正文按需取：云端增量包里 content 是空的。
// 这里后台预取正文（扫描全部缺正文的笔记），让编辑器秒开；失败的单篇等点开时再取。
let prefetching = false;
async function prefetchContents() {
  if (prefetching || !userInfo?.token) return;
  prefetching = true;
  try {
    for (;;) {
      const list = store.listNotes({ limit: 1000 }).filter(n => !n.content);
      if (!list.length) break;
      const batch = list.slice(0, 60);
      const CONCURRENCY = 6;
      let i = 0, ok = 0;
      const worker = async () => {
        while (i < batch.length) {
          const n = batch[i++];
          try {
            const html = await syncApi.getNoteContent(n.guid);
            if (html) { store.upsertNote({ guid: n.guid, content: html, dirty: 0 }); ok++; }
          } catch { /* 单篇失败忽略 */ }
        }
      };
      await Promise.all(Array.from({ length: CONCURRENCY }, worker));
      console.log('[prefetch] 批次完成', ok, '/', batch.length, '（剩余', list.length - ok, '）');
      if (ok === 0) break; // 全批失败，避免死循环
    }
    console.log('[prefetch] 全部正文预取完成');
  } finally {
    prefetching = false;
  }
}

// 完整同步（增量 + 标题摘要 + 后台预取正文），boot 与手动同步共用
async function syncNow() {
  const t0 = Date.now();
  const localData = store.collectLocalData();
  const r = await syncOnce(
    syncApi,
    () => store.getLastUpdateCount(),
    (v) => store.setLastUpdateCount(v),
    localData,
    (chunk) => store.applyServerChunk(chunk)
  );
  const pullMs = Date.now() - t0;
  console.log('[sync] ok:', JSON.stringify(r), '拉取耗时', pullMs, 'ms');
  // 推送成功后的收尾：回写服务端分配的 USN、推进游标、清脏标记
  //（不回写 USN 的话，这批笔记下次会被再次当成"新建"推送，服务器报 GUID 重复）
  if (r.direction === 'push' && !r.skipped) {
    for (const res of r.results || []) {
      store.applyServerUsns(res?.notes);
    }
    if (r.newLastUpdateCount != null) store.setLastUpdateCount(r.newLastUpdateCount);
    store.clearAllDirty();
    console.log('[sync] 推送完成：USN 已回写，游标推进到', r.newLastUpdateCount, '，脏标记已清');
  }
  // 标题补全在后台做（增量包 content 为空；contentDigest 自带正文纯文本作摘要）
  fetchNoteTitles(syncApi, store.getLastUpdateCount())
    .then(async (list) => {
      let n = 0;
      for (const note of list) {
        if (note.title) {
          store.upsertNote({ guid: note.guid, title: note.title, contentDigest: note.contentDigest, dirty: 0 });
          n++;
        }
      }
      console.log('[sync] 标题补全', n, '条');
      prefetchContents();
    })
    .catch(e => console.log('[sync] 标题补全失败:', e.message));
  return { ok: true, ...r, ms: Date.now() - t0 };
}

ipcMain.handle('sync:now', async () => {
  try {
    return await syncNow();
  } catch (e) {
    console.log('[sync] FAIL:', e.code, e.httpStatus, e.message);
    return { ok: false, error: e.message, code: e.code, httpStatus: e.httpStatus };
  }
});

ipcMain.handle('sync:state', async () => {
  try {
    const st = await syncApi.getSyncState(0);
    return { ok: true, serverUsn: st.updateCount, localUsn: store.getLastUpdateCount() };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

app.whenReady().then(async () => {
  await boot();
  // 账号 cookie 从登录分区搬回主 session（登录或 cookie 恢复都需要）
  try { await migrateAccountCookies(); } catch (e) { console.error('[boot] cookie 迁移失败:', e.message); }
  createWindow();
  // 启动后直接做一次静默同步 + 后台补正文，不用等用户点
  if (userInfo?.token) {
    setTimeout(async () => {
      try {
        const r = await syncNow();
        console.log('[boot-sync]', JSON.stringify(r));
      } catch (e) { console.log('[boot-sync] 失败:', e.message); }
    }, 1500);
  }
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
