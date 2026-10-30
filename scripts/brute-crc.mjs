// CRC 覆盖范围穷举：拿服务器自己算出的校验和 Y，对本地包的每一个连续字节区间做 CRC，
// 找出唯一匹配的区间 —— 由此确定服务器对信封头的真实布局。
//
// 运行：npx electron scripts/brute-crc.mjs --no-sandbox
// 需要先在应用里登录过（cookie 持久化在 defaultSession）。

import { app, session } from 'electron';
import path from 'node:path';
import os from 'node:os';
import { Maodun } from '../src/crypto/maodun.js';
import { MAODUN_PUBLIC_KEY } from '../src/config.js';

app.disableHardwareAcceleration();
// 必须用与主程序相同的 userData，否则读不到登录 cookie
app.setPath('userData', path.join(os.homedir(), 'AppData', 'Roaming', 'vivo-notes-client'));

function b64urlDecode(s) {
  let b = s.replace(/-/g, '+').replace(/_/g, '/');
  while (b.length % 4) b += '=';
  return Buffer.from(b, 'base64');
}
function b64urlEncode(buf) {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

const TABLE = (() => {
  const t = new Int32Array(256);
  for (let i = 0; i < 256; i++) {
    let e = i;
    for (let k = 0; k < 8; k++) e = e & 1 ? 0xEDB88320 ^ (e >>> 1) : e >>> 1;
    t[i] = e;
  }
  return t;
})();
function crc32(bytes) {
  let c = -1;
  for (const x of bytes) c = (c >>> 8) ^ TABLE[255 & (c ^ x)];
  return (-1 ^ c) >>> 0;
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

  const m = new Maodun(MAODUN_PUBLIC_KEY);
  const enc = m.encrypt({ type: 0, afterUsn: 0, maxEntries: 200, syncProtocolVersion: 200 });
  const buf = b64urlDecode(enc.data);

  const res = await fetch('https://psuite.vivo.com.cn/vbusiness/sync/getSyncChunk/v2', {
    method: 'POST', headers, body: JSON.stringify({ jvq_param: enc.data }),
  });
  const text = await res.text();
  console.log('resp:', text.slice(0, 200));
  const mm = text.match(/计算校验和为：(\d+)/);
  if (!mm) { console.log('不是 CRC 错误，无法用该方法'); app.quit(); return; }
  const Y = Number(mm[1]);
  console.log('server Y =', Y, ' packet len =', buf.length);

  // 穷举所有连续区间
  const hits = [];
  for (let a = 0; a < buf.length; a++) {
    for (let b = a + 1; b <= buf.length; b++) {
      // 跳过覆盖 CRC 字段(2..10)的区间（服务器 CRC 不含 CRC 字段本身）
      if (a < 10 && b > 2) continue;
      if (crc32(buf.subarray(a, b)) === Y) hits.push([a, b]);
    }
  }
  console.log('命中区间数:', hits.length);
  for (const [a, b] of hits.slice(0, 40)) {
    console.log(`  [${a}, ${b}) len=${b - a}  head=${buf.subarray(a, Math.min(b, a + 12)).toString('hex')}`);
  }
  app.quit();
});
