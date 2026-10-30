// 穷举 Maodun 信封头里的 keyType/encryptionType 与三把内置公钥（keyVersion 1/221/231）的组合，
// 看哪一组能通过服务器的密钥查找。
//
// 运行：npx electron scripts/try-keys.mjs --no-sandbox

import { app, session } from 'electron';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Maodun } from '../src/crypto/maodun.js';

app.disableHardwareAcceleration();
app.setPath('userData', path.join(os.homedir(), 'AppData', 'Roaming', 'vivo-notes-client'));

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function b64urlDecode(s) {
  let b = s.replace(/-/g, '+').replace(/_/g, '/');
  while (b.length % 4) b += '=';
  return Buffer.from(b, 'base64');
}

function parseBlob(b64) {
  const buf = b64urlDecode(b64);
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const ktl = buf[5];
  const keyToken = buf.subarray(6, 6 + ktl).toString('latin1');
  const protocalType = dv.getUint16(6 + ktl);
  const keyVersion = dv.getUint16(8 + ktl);
  const pem = buf.subarray(10 + ktl).toString('latin1');
  const i = pem.indexOf('-----BEGIN PUBLIC KEY-----');
  return { keyToken, protocalType, keyVersion, pem: pem.slice(i) };
}

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

  const blobs = fs.readFileSync(path.join(__dirname, '..', 'blobs.txt'), 'utf8')
    .split('\n').map(x => x.trim()).filter(Boolean).map(parseBlob);

  const types = [8, 65, 0x41, 1, 2, 3, 4, 5, 6, 7, 9, 10, 16, 32];
  for (const b of blobs) {
    for (const et of types) {
      const m = new Maodun(b.pem, {
        protocalType: b.protocalType,
        keyVersion: b.keyVersion,
        encryptionType: et,
        keyToken: new Uint8Array(Buffer.from(b.keyToken, 'ascii')),
      });
      const enc = m.encrypt({ type: 0, afterUsn: 0, maxEntries: 200, syncProtocolVersion: 200 });
      const res = await fetch('https://psuite.vivo.com.cn/vbusiness/sync/getSyncChunk/v2', {
        method: 'POST', headers, body: JSON.stringify({ jvq_param: enc.data }),
      });
      const text = await res.text();
      const short = text.slice(0, 170);
      const good = !/keyToken|校验|10000|异常/.test(short);
      console.log(`${good ? '*** OK ***' : '          '} kv=${b.keyVersion} et=${et} -> ${short}`);
      if (good) { console.log('SUCCESS with kv=' + b.keyVersion + ' et=' + et); app.quit(); return; }
    }
  }
  app.quit();
});
