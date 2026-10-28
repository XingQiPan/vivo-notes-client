// 登录窗口编排：用 Electron BrowserWindow 内嵌 webview 加载 passport，
// 在回调页注入脚本抓 hidden input，回传解析后的 userInfo。
//
// 仅在 Electron 主进程内运行。

import { BrowserWindow } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildLoginUrl, isLoginCallback, parseLoginCookie } from './passport.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * 打开登录窗口，resolve 为 userInfo（含 token/openId/...）。用户关窗则 reject。
 * @param {object} opts { env, preloadPath? }
 */
export function openLoginWindow(opts = {}) {
  return new Promise((resolve, reject) => {
    const url = buildLoginUrl({ env: opts.env });

    const win = new BrowserWindow({
      width: 460, height: 640,
      title: 'vivo 账号登录',
      autoHideMenuBar: true,
      webPreferences: {
        webviewTag: true,
        contextIsolation: true,
        nodeIntegration: false,
        preload: path.join(__dirname, 'login-preload.cjs'),
      },
    });

    // 用一个本地壳页面承载 <webview>
    win.loadFile(path.join(__dirname, 'login-host.html'), { query: { src: url } });

    // 通过 IPC 接收 login-success
    const onIpc = (event, arg) => {
      if (event.senderFrame.url && isLoginCallback(event.senderFrame.url)) {
        // 二次校验来源
      }
      const raw = arg && arg.rawValue;
      if (raw) {
        resolve(parseLoginCookie(raw));
        if (!win.isDestroyed()) win.close();
      }
    };
    win.webContents.on('ipc-message', (_e, channel, ...args) => {
      if (channel === 'login-success') onIpc(_e, args[0]);
    });
    win.webContents.on('ipc-message-sync', (_e, channel, ...args) => {
      if (channel === 'login-success') onIpc(_e, args[0]);
    });

    win.on('closed', () => reject(new Error('登录窗口已关闭')));
  });
}
