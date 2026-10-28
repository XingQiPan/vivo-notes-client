// Electron 主进程：装配 登录 / 存储 / 同步，暴露 IPC 给渲染层。

import { app, BrowserWindow, ipcMain } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Store } from './sync/store.js';
import { ApiClient } from './net/api-client.js';
import { NoteSyncApi, syncOnce } from './sync/note-sync.js';
import { openLoginWindow } from './login/login-window.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// 无 GPU 的服务器/沙箱环境下 Electron 会崩，统一禁用硬件加速
app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-gpu');
app.commandLine.appendSwitch('no-sandbox');
app.commandLine.appendSwitch('disable-software-rasterizer');

let store, client, syncApi;
let userInfo = {};
let mainWindow = null;

function boot() {
  store = new Store(path.join(app.getPath('userData'), 'notes.db'));
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

ipcMain.handle('sync:now', async () => {
  try {
    const localData = store.collectLocalData();
    const r = await syncOnce(
      syncApi,
      () => store.getLastUpdateCount(),
      (v) => store.setLastUpdateCount(v),
      localData,
      (chunk) => store.applyServerChunk(chunk)
    );
    return { ok: true, ...r };
  } catch (e) {
    return { ok: false, error: e.message, code: e.code };
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

app.whenReady().then(() => { boot(); createWindow(); });
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
