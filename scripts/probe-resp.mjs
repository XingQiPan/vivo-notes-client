// 定位响应密文起点：穷举 (IV 来源, 密文起点) 组合，找出能解出合法 JSON 的那一组。
// 运行：npx electron scripts/probe-resp.mjs --no-sandbox
import { app, session } from 'electron';
import path from 'node:path';
import os from 'node:os';
import CryptoJS from 'crypto-js';
import { Maodun } from '../src/crypto/maodun.js';
import { MAODUN_PUBLIC_KEY } from '../src/config.js';

app.disableHardwareAcceleration();
app.setPath('userData', path.join(os.homedir(), 'AppData', 'Roaming', 'vivo-notes-client'));

function dec64(s) {
  let b = s.replace(/-/g, '+').replace(/_/g, '/');
  while (b.length % 4) b += '=';
  return Buffer.from(b, 'base64');
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
  if (!token) { console.log('NO TOKEN'); app.quit(); return; }
  const cookieStr = cookies.filter(c => /vivo_account|vivo_yun/.test(c.name))
    .filter((c, i, a) => a.findIndex(x => x.name === c.name) === i)
    .map(c => `${c.name}=${c.value}`).join('; ');

  const m = new Maodun(MAODUN_PUBLIC_KEY);
  const enc = m.encrypt({ type: 0, afterUsn: 0, maxEntries: 200, syncProtocolVersion: 200 });
  const res = await fetch('https://psuite.vivo.com.cn/vbusiness/sync/getSyncChunk/v2', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', token, openId, source: '2', version: '7.0.6', deviceId, Cookie: cookieStr },
    body: JSON.stringify({ jvq_param: enc.data }),
  });
  const json = await res.json();
  if (!json.jvq_response) { console.log('resp', JSON.stringify(json).slice(0, 200)); app.quit(); return; }

  const buf = dec64(json.jvq_response);
  console.log('resp len', buf.length);
  const respIv = buf.subarray(38, 54).toString('latin1');
  console.log('respIv @38 =', JSON.stringify(respIv));

  const ivs = {
    'respIv@38': respIv,
    'reqIv': m.aesIv,
    'respIv@36': buf.subarray(36, 52).toString('latin1'),
    'respIv@40': buf.subarray(40, 56).toString('latin1'),
  };
  const aesDec = (b64, key, iv) => CryptoJS.AES.decrypt(b64, CryptoJS.enc.Utf8.parse(key), {
    iv: CryptoJS.enc.Utf8.parse(iv), mode: CryptoJS.mode.CBC, padding: CryptoJS.pad.Pkcs7,
  }).toString(CryptoJS.enc.Utf8);

  for (const [ivName, iv] of Object.entries(ivs)) {
    for (let off = 40; off <= buf.length - 16; off++) {
      const rem = buf.length - off;
      for (const len of [rem, rem - 2, rem - 4]) {
        if (len <= 0 || len % 16 !== 0) continue;
        const ct = Buffer.from(buf.subarray(off, off + len)).toString('base64');
        try {
          const plain = aesDec(ct, m.aesKey, iv);
          if (plain && plain.trim().startsWith('{')) {
            console.log(`*** HIT iv=${ivName} off=${off} len=${len} -> ${plain.slice(0, 300)}`);
          }
        } catch { /* ignore */ }
      }
    }
  }
  console.log('done');
  app.quit();
});
