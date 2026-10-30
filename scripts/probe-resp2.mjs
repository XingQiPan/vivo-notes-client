// 精确定位响应密文起点（离线解码不了——AES key 是每次请求随机的，必须在线取）。
// 只试少数候选偏移，快速输出。
import { app, session } from 'electron';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import CryptoJS from 'crypto-js';
import { Maodun } from '../src/crypto/maodun.js';
import { MAODUN_PUBLIC_KEY } from '../src/config.js';

app.disableHardwareAcceleration();
app.setPath('userData', path.join(os.homedir(), 'AppData', 'Roaming', 'vivo-notes-client'));
const OUT = path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\//, '')), '..', 'probe-out.txt');
const log = s => fs.appendFileSync(OUT, s + '\n');

function dec64(s) {
  let b = s.replace(/-/g, '+').replace(/_/g, '/');
  while (b.length % 4) b += '=';
  return Buffer.from(b, 'base64');
}

app.whenReady().then(async () => {
  fs.writeFileSync(OUT, '');
  const cookies = await session.defaultSession.cookies.get({});
  const byName = n => {
    const c = cookies.find(x => x.name === n && /vivo\.com\.cn$/.test(x.domain.replace(/^\./, '')));
    return (c || cookies.find(x => x.name === n) || {}).value || '';
  };
  const token = byName('vivo_account_cookie_iqoo_vivotoken');
  const openId = byName('vivo_account_cookie_iqoo_openid');
  const deviceId = byName('vivo_account_cookie_iqoo_deviceid');
  if (!token) { log('NO TOKEN'); app.quit(); return; }
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
  if (!json.jvq_response) { log('resp ' + JSON.stringify(json).slice(0, 200)); app.quit(); return; }

  const buf = dec64(json.jvq_response);
  log('resp len ' + buf.length);
  const respIv = buf.subarray(38, 54).toString('latin1');
  log('respIv@38 ' + respIv + '  reqIv ' + m.aesIv);
  log('bytes54..60 ' + [...buf.subarray(54, 60)].map(x => x.toString(16).padStart(2, '0')).join(' '));

  const aesDec = (b64, key, iv) => CryptoJS.AES.decrypt(b64, CryptoJS.enc.Utf8.parse(key), {
    iv: CryptoJS.enc.Utf8.parse(iv), mode: CryptoJS.mode.CBC, padding: CryptoJS.pad.Pkcs7,
  }).toString(CryptoJS.enc.Utf8);

  const ivs = { respIv, reqIv: m.aesIv };
  for (const [ivName, iv] of Object.entries(ivs)) {
    for (let off = 50; off <= buf.length - 16; off++) {
      const rem = buf.length - off;
      if (rem % 16 !== 0) continue;
      const ct = Buffer.from(buf.subarray(off)).toString('base64');
      try {
        const plain = aesDec(ct, m.aesKey, iv);
        if (plain && plain.trim().startsWith('{')) {
          log(`*** HIT iv=${ivName} off=${off} len=${rem} -> ${plain.slice(0, 400)}`);
        }
      } catch { /* ignore */ }
    }
  }
  log('done');
  app.quit();
});
