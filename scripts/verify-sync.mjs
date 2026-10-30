// 端到端验证：登录态下用笔记模块的正确密钥打 getSyncChunk，并解密响应。
// 运行：npx electron scripts/verify-sync.mjs --no-sandbox

import { app, session } from 'electron';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { Maodun } from '../src/crypto/maodun.js';
import { MAODUN_PUBLIC_KEY } from '../src/config.js';

app.disableHardwareAcceleration();
app.setPath('userData', path.join(os.homedir(), 'AppData', 'Roaming', 'vivo-notes-client'));
const __dirname = path.dirname(fileURLToPath(import.meta.url));

app.whenReady().then(async () => {
  const cookies = await session.defaultSession.cookies.get({});
  const byName = n => {
    const c = cookies.find(x => x.name === n && /vivo\.com\.cn$/.test(x.domain.replace(/^\./, '')));
    return (c || cookies.find(x => x.name === n) || {}).value || '';
  };
  const token = byName('vivo_account_cookie_iqoo_vivotoken');
  const openId = byName('vivo_account_cookie_iqoo_openid');
  const deviceId = byName('vivo_account_cookie_iqoo_deviceid');
  if (!token) { console.log('NO TOKEN — 请先在应用里登录'); app.quit(); return; }
  const cookieStr = cookies
    .filter(c => /vivo_account|vivo_yun/.test(c.name))
    .filter((c, i, a) => a.findIndex(x => x.name === c.name) === i)
    .map(c => `${c.name}=${c.value}`).join('; ');

  const headers = {
    'Content-Type': 'application/json',
    token, openId, source: '2', version: '7.0.6', deviceId,
    Cookie: cookieStr,
  };

  const m = new Maodun(MAODUN_PUBLIC_KEY);
  const enc = m.encrypt({ type: 0, afterUsn: 0, maxEntries: 200, syncProtocolVersion: 200 });
  const res = await fetch('https://psuite.vivo.com.cn/vbusiness/sync/getSyncChunk/v2', {
    method: 'POST', headers, body: JSON.stringify({ jvq_param: enc.data }),
  });
  const json = await res.json();
  console.log('HTTP', res.status);
  if (!json.jvq_response) { console.log('resp:', JSON.stringify(json).slice(0, 300)); app.quit(); return; }
  try {
    const plain = m.decrypt(json.jvq_response);
    console.log('DECRYPTED OK, len =', plain.length);
    const data = JSON.parse(plain);
    console.log('keys:', Object.keys(data));
    console.log('updateCount:', data.updateCount, ' chunkHighUsn:', data.chunkHighUsn);
    console.log('notes:', (data.notes || []).length, 'noteBooks:', (data.noteBooks || []).length);
    if ((data.notes || []).length) {
      const n = data.notes[0];
      console.log('sample note:', JSON.stringify({ guid: n.guid, title: n.title, deleted: n.deleted }).slice(0, 200));
    }
  } catch (e) {
    console.log('DECRYPT FAILED:', e.message);
  }
  app.quit();
});
