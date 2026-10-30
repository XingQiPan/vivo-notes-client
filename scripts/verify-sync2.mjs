// 端到端验证：拉取云端增量并列出笔记。
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
  if (!token) { console.log('NO TOKEN'); app.quit(); return; }
  const cookieStr = cookies.filter(c => /vivo_account|vivo_yun/.test(c.name))
    .filter((c, i, a) => a.findIndex(x => x.name === c.name) === i)
    .map(c => `${c.name}=${c.value}`).join('; ');

  const headers = { 'Content-Type': 'application/json', token, openId, source: '2', version: '7.0.6', deviceId, Cookie: cookieStr };
  const m = new Maodun(MAODUN_PUBLIC_KEY);

  const enc = m.encrypt({ type: 0, afterUsn: 0, maxEntries: 200, syncProtocolVersion: 200 });
  const res = await fetch('https://psuite.vivo.com.cn/vbusiness/sync/getSyncChunk/v2', {
    method: 'POST', headers, body: JSON.stringify({ jvq_param: enc.data }),
  });
  const json = await res.json();
  const inner = JSON.parse(m.decrypt(json.jvq_response));
  const data = inner.data || {};
  console.log('code', inner.code, 'ok', inner.ok);
  console.log('data keys:', Object.keys(data).join(', '));
  console.log('updateCount:', data.updateCount, 'chunkHighUsn:', data.chunkHighUsn, 'hisSyncType:', data.hisSyncType);
  const notes = data.notes || [];
  const books = data.noteBooks || [];
  console.log('notes:', notes.length, 'noteBooks:', books.length);
  for (const b of books.slice(0, 8)) console.log('  📓', b.name, '| notes:', b.notes);
  for (const n of notes.slice(0, 8)) {
    console.log('  📝', JSON.stringify(n.title || '').slice(0, 60),
      '| deleted:', n.deleted, '| upd:', n.updateTime,
      '| content:', String(n.content || '').replace(/<[^>]+>/g, '').slice(0, 60));
  }
  app.quit();
}).catch(e => { console.log('ERR', e.message); app.quit(); });
