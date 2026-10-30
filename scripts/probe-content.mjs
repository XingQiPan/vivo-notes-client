// 验证笔记正文与列表接口：
//   POST /note/getContent/v2   {guid}                —— 取正文
//   POST /note/getAllNote/v2   {...}                 —— 取列表（含标题/摘要）
import { app, session } from 'electron';
import path from 'node:path';
import os from 'node:os';
import { Maodun } from '../src/crypto/maodun.js';
import { MAODUN_PUBLIC_KEY } from '../src/config.js';

app.disableHardwareAcceleration();
app.setPath('userData', path.join(os.homedir(), 'AppData', 'Roaming', 'vivo-notes-client'));

async function call(m, headers, url, payload, encrypt) {
  const body = encrypt ? JSON.stringify({ jvq_param: m.encrypt(payload).data }) : JSON.stringify(payload);
  const res = await fetch(url, { method: 'POST', headers, body });
  const json = await res.json();
  if (json.jvq_response) {
    const inner = JSON.parse(m.decrypt(json.jvq_response));
    return inner;
  }
  return json;
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
  const cookieStr = cookies.filter(c => /vivo_account|vivo_yun/.test(c.name))
    .filter((c, i, a) => a.findIndex(x => x.name === c.name) === i)
    .map(c => `${c.name}=${c.value}`).join('; ');
  const headers = { 'Content-Type': 'application/json', token, openId, source: '2', version: '7.0.6', deviceId, Cookie: cookieStr };
  const G = 'https://psuite.vivo.com.cn/vbusiness';

  const m = new Maodun(MAODUN_PUBLIC_KEY);
  const chunk = await call(m, headers, `${G}/sync/getSyncChunk/v2`, { type: 0, afterUsn: 0, maxEntries: 200, syncProtocolVersion: 200 }, true);
  const notes = chunk.data.notes || [];
  const withTitle = notes.filter(n => n.title);
  console.log('notes with title:', withTitle.length, '/', notes.length);
  const sample = withTitle[0] || notes[0];
  console.log('sample guid:', sample.guid, 'title:', JSON.stringify(sample.title));

  // 1) getContent
  const c1 = await call(m, headers, `${G}/note/getContent/v2`, { guid: sample.guid }, true);
  console.log('getContent ->', JSON.stringify(c1).slice(0, 400));

  // 2) getAllNote
  const c2 = await call(m, headers, `${G}/note/getAllNote/v2`, { type: 0, afterUsn: 0, maxEntries: 200, syncProtocolVersion: 200 }, true);
  const d2 = c2.data || {};
  console.log('getAllNote keys:', Object.keys(d2).join(','), '| notes:', (d2.notes || []).length);
  const n2 = (d2.notes || [])[0];
  if (n2) {
    console.log('  n2 fields:', Object.keys(n2).join(','));
    console.log('  n2 title:', JSON.stringify(n2.title), 'content len:', (n2.content || '').length);
  }
  app.quit();
}).catch(e => { console.log('ERR', e.stack); app.quit(); });
