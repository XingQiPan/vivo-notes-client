// 验证增量拉取的续拉条件：第二次用 afterUsn=4482 拉，看 updateCount / chunkHighUsn 收敛情况。
import { app, session } from 'electron';
import path from 'node:path';
import os from 'node:os';
import { Maodun } from '../src/crypto/maodun.js';
import { MAODUN_PUBLIC_KEY } from '../src/config.js';

app.disableHardwareAcceleration();
app.setPath('userData', path.join(os.homedir(), 'AppData', 'Roaming', 'vivo-notes-client'));

app.whenReady().then(async () => {
  const cookies = await session.defaultSession.cookies.get({});
  const byName = n => {
    const c = cookies.find(x => x.name === n && /vivo\.com\.cn$/.test(x.domain.replace(/^\./, '')));
    return (c || cookies.find(x => x.name === n) || {}).value || '';
  };
  const token = byName('vivo_account_cookie_iqoo_vivotoken');
  const openId = byName('vivo_account_cookie_iqoo_openid');
  const deviceId = byName('vivo_account_cookie_iqoo_deviceid');
  const cookieStr = cookies.filter(c => /vivo_account|vivo_yun/.test(c.name))
    .filter((c, i, a) => a.findIndex(x => x.name === c.name) === i)
    .map(c => `${c.name}=${c.value}`).join('; ');
  const headers = { 'Content-Type': 'application/json', token, openId, source: '2', version: '7.0.6', deviceId, Cookie: cookieStr };

  const m = new Maodun(MAODUN_PUBLIC_KEY);
  for (const afterUsn of [0, 2422, 3798, 4482]) {
    const enc = m.encrypt({ type: 0, afterUsn, maxEntries: 200, syncProtocolVersion: 200 });
    const res = await fetch('https://psuite.vivo.com.cn/vbusiness/sync/getSyncChunk/v2', {
      method: 'POST', headers, body: JSON.stringify({ jvq_param: enc.data }),
    });
    const json = await res.json();
    const inner = JSON.parse(m.decrypt(json.jvq_response));
    const d = inner.data || {};
    console.log(`afterUsn=${afterUsn} -> updateCount=${d.updateCount} chunkHighUsn=${d.chunkHighUsn} notes=${(d.notes||[]).length} books=${(d.noteBooks||[]).length} lastUpdateCount=${d.lastUpdateCount}`);
  }
  app.quit();
}).catch(e => { console.log('ERR', e.message); app.quit(); });
