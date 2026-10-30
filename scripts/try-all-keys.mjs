// 用全部内置 keyToken × keyVersion × encryptionType 组合打 getSyncChunk，
// 找出服务器真正接受的那一组。
//
// 运行：npx electron scripts/try-all-keys.mjs --no-sandbox

import { app, session } from 'electron';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Maodun } from '../src/crypto/maodun.js';

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

  const keys = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'keys.json'), 'utf8'));
  const types = [8, 65, 4, 5, 1, 2, 3, 16];
  for (const k of keys) {
    for (const et of types) {
      const m = new Maodun(k.pem, {
        protocalType: k.pt,
        keyVersion: k.kv,
        encryptionType: et,
        keyToken: new Uint8Array(Buffer.from(k.keyToken, 'ascii')),
      });
      const enc = m.encrypt({ type: 0, afterUsn: 0, maxEntries: 200, syncProtocolVersion: 200 });
      const res = await fetch('https://psuite.vivo.com.cn/vbusiness/sync/getSyncChunk/v2', {
        method: 'POST', headers, body: JSON.stringify({ jvq_param: enc.data }),
      });
      const text = await res.text();
      const short = text.slice(0, 180);
      const ok = !/keyToken|校验|10000|异常|unsupported|解密/.test(short);
      console.log(`${ok ? '*** OK ***' : '          '} ${k.keyToken} kv=${k.kv} et=${et} -> ${short}`);
      if (ok) { console.log('SUCCESS:', k.keyToken, 'kv=' + k.kv, 'et=' + et); app.quit(); return; }
    }
  }
  app.quit();
});
