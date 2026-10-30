// 查清正文归属：笔记的 content 是否在 noteGuid 指向的另一条记录里。
import { app, session } from 'electron';
import path from 'node:path';
import os from 'node:os';
import { Maodun } from '../src/crypto/maodun.js';
import { MAODUN_PUBLIC_KEY } from '../src/config.js';

app.disableHardwareAcceleration();
app.setPath('userData', path.join(os.homedir(), 'AppData', 'Roaming', 'vivo-notes-client'));

async function call(m, headers, url, payload) {
  const res = await fetch(url, {
    method: 'POST', headers,
    body: JSON.stringify({ jvq_param: m.encrypt(payload).data }),
  });
  const json = await res.json();
  return JSON.parse(m.decrypt(json.jvq_response));
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

  const chunk = await call(m, headers, `${G}/sync/getSyncChunk/v2`, { type: 0, afterUsn: 0, maxEntries: 200, syncProtocolVersion: 200 });
  const notes = chunk.data.notes || [];
  const withContent = notes.filter(n => n.content);
  const withTitle = notes.filter(n => n.title);
  console.log('notes:', notes.length, '| 有 title:', withTitle.length, '| 有 content:', withContent.length);
  console.log('noteGuid 非空的:', notes.filter(n => n.noteGuid).length);

  const t = withTitle.find(n => !n.content);
  if (t) {
    console.log('\n样本(有标题无正文):', t.guid, JSON.stringify(t.title), 'noteGuid=', t.noteGuid, 'contentKey=', t.contentKey, 'contentDigest=', t.contentDigest);
    // 1) 用 getContent 取它的正文
    const c1 = await call(m, headers, `${G}/note/getContent/v2`, { guid: t.guid });
    console.log('  getContent(guid) ->', JSON.stringify(c1.data).slice(0, 200));
    // 2) 用 getIncludeItem 取含 tag/resource 的完整记录
    const c2 = await call(m, headers, `${G}/note/getIncludeItem/v2`, { guid: t.guid, syncProtocolVersion: 200 });
    const arr = Array.isArray(c2.data) ? c2.data : (c2.data?.notes || [c2.data]);
    const rec = arr[0] || {};
    console.log('  getIncludeItem -> keys:', Object.keys(rec).join(','));
    console.log('    title:', JSON.stringify(rec.title), 'content len:', (rec.content || '').length, 'tags:', (rec.tags||[]).length, 'resources:', (rec.resources||[]).length);
  }
  app.quit();
}).catch(e => { console.log('ERR', e.stack); app.quit(); });
