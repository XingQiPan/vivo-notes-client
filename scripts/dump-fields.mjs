// 打印云端一条笔记 / 一个笔记本的完整字段，用于对齐本地表的列名映射。
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

  const m = new Maodun(MAODUN_PUBLIC_KEY);
  const enc = m.encrypt({ type: 0, afterUsn: 0, maxEntries: 200, syncProtocolVersion: 200 });
  const res = await fetch('https://psuite.vivo.com.cn/vbusiness/sync/getSyncChunk/v2', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', token, openId, source: '2', version: '7.0.6', deviceId, Cookie: cookieStr },
    body: JSON.stringify({ jvq_param: enc.data }),
  });
  const json = await res.json();
  const inner = JSON.parse(m.decrypt(json.jvq_response));
  const d = inner.data;

  const n = (d.notes || []).find(x => x.content) || (d.notes || [])[0];
  console.log('=== NOTE fields ===');
  console.log(Object.keys(n).join(', '));
  console.log('name:', JSON.stringify(n.name), '| content len:', (n.content || '').length);
  console.log('content sample:', String(n.content || '').replace(/<[^>]+>/g, '').slice(0, 120));
  console.log('noteBookGuid:', n.noteBookGuid, '| deleted:', n.deleted, '| updateSequenceNum:', n.updateSequenceNum);
  console.log('=== NOTEBOOK fields ===');
  console.log(Object.keys((d.noteBooks || [])[0]).join(', '));
  console.log('=== delete ===', JSON.stringify(d.delete).slice(0, 200));
  console.log('=== remove ===', JSON.stringify(d.remove).slice(0, 200));
  console.log('=== tags count ===', (d.tags || []).length);
  if ((d.tags || []).length) console.log('tag fields:', Object.keys(d.tags[0]).join(', '));
  app.quit();
}).catch(e => { console.log('ERR', e.message); app.quit(); });
