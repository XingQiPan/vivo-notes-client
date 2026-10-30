// 诊断脚本：用当前会话 cookie + 真实 token 直连网关，对比各端点行为。
// 用法：node scripts/diag-sync.mjs
// 需要先在 Electron 里登录过（cookie 已写入 defaultSession）。
// 本脚本用 Electron 的 session 拿 cookie，所以通过 electron 跑。

import { app, session } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Maodun } from '../src/crypto/maodun.js';
import { MAODUN_PUBLIC_KEY } from '../src/config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
app.disableHardwareAcceleration();

// 从 userData 下的 notes.db 读不到 userInfo（userInfo 在内存里）。
// 这里改为：从 persist:login 分区拿账号 cookie，构造与主进程相同的请求头。
app.whenReady().then(async () => {
  const s = session.defaultSession;
  const cookies = await s.cookies.get({ domain: 'psuite.vivo.com.cn' });
  const cookieStr = cookies.map(c => `${c.name}=${c.value}`).join('; ');
  console.log('cookies on psuite:', cookies.map(c => c.name).join(', ') || '(none)');

  const acct = await session.fromPartition('persist:login').cookies.get({});
  const find = n => (acct.find(c => c.name === n) || {}).value || '';
  const token = find('vivo_account_cookie_iqoo_vivotoken');
  const openId = find('vivo_account_cookie_iqoo_openid');
  const vcode = (cookies.find(c => c.name === '@vivo_vcode_uid') || {}).value || '';
  console.log('token len', token.length, 'openId', openId, 'vcode', vcode);

  const headers = {
    'Content-Type': 'application/json',
    'Cookie': cookieStr,
    token, openId, source: '2', version: '7.0.6',
    deviceId: vcode || find('vivo_account_cookie_iqoo_deviceid'),
  };

  async function call(label, url, bodyObj, encrypt) {
    let body;
    if (encrypt) {
      const m = new Maodun(MAODUN_PUBLIC_KEY);
      body = JSON.stringify({ jvq_param: m.encrypt(bodyObj).data });
    } else {
      body = JSON.stringify(bodyObj);
    }
    const res = await fetch(url, { method: 'POST', headers, body });
    const text = await res.text();
    console.log(`[${label}] ${res.status} ${text.slice(0, 200)}`);
  }

  const G = 'https://psuite.vivo.com.cn/vbusiness';
  await call('state-plain', `${G}/sync/getSyncState`, { type: 0 }, false);
  await call('state-enc', `${G}/sync/getSyncState`, { type: 0 }, true);
  await call('chunk-enc', `${G}/sync/getSyncChunk/v2`, { type: 0, afterUsn: 0, maxEntries: 200, syncProtocolVersion: 200 }, true);
  app.quit();
});
