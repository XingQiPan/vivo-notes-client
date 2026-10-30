// 遍历 bundle 内置的 3 把 Maodun 公钥包，分别解析出 (keyVersion, keyType, keyToken, PEM)，
// 用真实登录凭证逐一把加密包打到 getSyncChunk，看哪一把能通过头部校验并被服务器接受。
//
// 运行：npx electron scripts/try-blobs.mjs --no-sandbox

import { app, session } from 'electron';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { Maodun } from '../src/crypto/maodun.js';

app.disableHardwareAcceleration();
app.setPath('userData', path.join(os.homedir(), 'AppData', 'Roaming', 'vivo-notes-client'));

function b64urlDecode(s) {
  let b = s.replace(/-/g, '+').replace(/_/g, '/');
  while (b.length % 4) b += '=';
  return Buffer.from(b, 'base64');
}

// 按 bundle 的 _publicKeyHttpHeaderParsing 解析 magic-204 公钥包
function parseBlob(b64) {
  const buf = b64urlDecode(b64);
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const magic = dv.getUint16(0);
  const encType = buf[4];
  const ktl = buf[5];
  const keyToken = buf.subarray(6, 6 + ktl).toString('latin1');
  const protocalType = dv.getUint16(6 + ktl);
  const keyVersion = dv.getUint16(8 + ktl);
  const pem = buf.subarray(10 + ktl).toString('latin1');
  const pemStart = pem.indexOf('-----BEGIN PUBLIC KEY-----');
  return { magic, encType, keyToken, protocalType, keyVersion, pem: pem.slice(pemStart) };
}

app.whenReady().then(async () => {
  const s = session.defaultSession;
  const cookies = await s.cookies.get({});
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

  const blobs = fs.readFileSync(path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\//, '')), '..', 'blobs.txt'), 'utf8')
    .split('\n').map(x => x.trim()).filter(Boolean);

  for (const raw of blobs) {
    const info = parseBlob(raw);
    console.log('--- blob: magic=%s encType=%s keyToken=%s pt=0x%04x keyVersion=%s',
      info.magic, info.encType, info.keyToken, info.protocalType, info.keyVersion);
    const m = new Maodun(info.pem, {
      protocalType: info.protocalType,
      keyVersion: info.keyVersion,
      encryptionType: info.encType,
      keyToken: new Uint8Array(Buffer.from(info.keyToken, 'ascii')),
    });
    const enc = m.encrypt({ type: 0, afterUsn: 0, maxEntries: 200, syncProtocolVersion: 200 });
    const res = await fetch('https://psuite.vivo.com.cn/vbusiness/sync/getSyncChunk/v2', {
      method: 'POST', headers, body: JSON.stringify({ jvq_param: enc.data }),
    });
    const text = await res.text();
    console.log('    ->', res.status, text.slice(0, 220));
  }
  app.quit();
});
