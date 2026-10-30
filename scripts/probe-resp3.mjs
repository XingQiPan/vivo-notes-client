// 在线定位响应密文起点：用本次请求的真实 AES key 对响应的所有候选偏移做 AES-128-CBC 解密，
// 找出能解出合法 JSON 的一组。
import { app, session } from 'electron';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
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
  console.log('respLen', buf.length, 'aesKey', m.aesKey, 'reqIv', m.aesIv);
  console.log('hex', buf.toString('hex'));

  const tryDec = (ct, key, iv) => {
    try {
      const d = crypto.createDecipheriv('aes-128-cbc', Buffer.from(key, 'utf8'), Buffer.from(iv, 'utf8'));
      let out = Buffer.concat([d.update(ct), d.final()]);
      return out.toString('utf8');
    } catch { return null; }
  };

  const ivCands = {};
  for (let o = 34; o <= 54; o++) {
    const seg = buf.subarray(o, o + 16).toString('latin1');
    if (/^[A-Za-z0-9]{16}$/.test(seg)) ivCands['iv@' + o] = seg;
  }
  ivCands['reqIv'] = m.aesIv;

  for (const [ivName, iv] of Object.entries(ivCands)) {
    for (let off = 34; off < buf.length - 15; off++) {
      const rem = buf.length - off;
      if (rem % 16 !== 0) continue;
      const plain = tryDec(buf.subarray(off), m.aesKey, iv);
      if (plain && plain.trim().startsWith('{')) {
        console.log(`*** HIT iv=${ivName} off=${off} len=${rem} -> ${plain.slice(0, 400)}`);
      }
    }
  }
  console.log('scan done');
  app.quit();
}).catch(e => { console.log('ERR', e.message); app.quit(); });
