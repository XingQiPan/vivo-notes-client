// CRC 范围探测：向 getSyncChunk 发一个 crc 字段置 0 的包，
// 服务器会回显它自己算出的校验和 Y；再本地对同一批字节的各种候选范围算 CRC，
// 哪个等于 Y，服务器就在校验哪个范围。
import { app, session } from 'electron';
import { Maodun, crc32 } from '../src/crypto/maodun.js';
import { MAODUN_PUBLIC_KEY } from '../src/config.js';

app.disableHardwareAcceleration();

app.whenReady().then(async () => {
  const s = session.defaultSession;
  const cookies = await s.cookies.get({});
  const get = n => {
    const c = cookies.find(c => c.name === n && /vivo\.com\.cn$/.test(c.domain.replace(/^\./, '')))
      || cookies.find(c => c.name === n);
    return (c || {}).value || '';
  };
  const token = get('vivo_account_cookie_iqoo_vivotoken');
  const openId = get('vivo_account_cookie_iqoo_openid');
  const deviceId = get('vivo_account_cookie_iqoo_deviceid');
  console.log('token?', !!token, 'openId', openId);
  if (!token) { console.log('NO TOKEN — 请先在应用里登录'); app.quit(); return; }

  const m = new Maodun(MAODUN_PUBLIC_KEY);
  const enc = m.encrypt({ type: 0, afterUsn: 0, maxEntries: 200, syncProtocolVersion: 200 });
  let b64 = enc.data.replace(/-/g, '+').replace(/_/g, '/');
  while (b64.length % 4) b64 += '=';
  const buf = Buffer.from(b64, 'base64');

  // 把 crc 字段（bytes 2..10）清零
  const probe = Buffer.from(buf);
  probe.fill(0, 2, 10);
  const cookieStr = cookies.filter(c => /vivo_account|vivo_yun/.test(c.name))
    .map((c, i, a) => a.findIndex(x => x.name === c.name) === i ? `${c.name}=${c.value}` : null)
    .filter(Boolean).join('; ');

  const res = await fetch('https://psuite.vivo.com.cn/vbusiness/sync/getSyncChunk/v2', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      token, openId, source: '2', version: '7.0.6', deviceId, Cookie: cookieStr,
    },
    body: JSON.stringify({ jvq_param: probe.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') }),
  });
  const text = await res.text();
  console.log('resp:', text.slice(0, 200));
  const mm = text.match(/计算校验和为：(\d+)/);
  if (!mm) { console.log('no oracle value'); app.quit(); return; }
  const Y = Number(mm[1]);

  const lenPrefix = probe.readUInt16BE(0); // 306
  const crcField = probe.subarray(2, 10);
  const header = probe.subarray(10, 10 + lenPrefix - 8); // 298B
  const body = probe.subarray(10 + header.length);

  const cands = {
    'header(298)': header,
    'crc+header': Buffer.concat([crcField, header]),
    'len+crc+header': probe.subarray(0, 10 + header.length),
    'header+body': Buffer.concat([header, body]),
    'crc+header+body': probe.subarray(2),
    'all': probe,
    'header+16 (iv=32B 假设)': probe.subarray(10, 10 + header.length + 16),
    'crc+header+16': probe.subarray(2, 2 + 8 + header.length + 16),
    'header minus pt(296)': header.subarray(2),
    'header minus pt+magic(294)': header.subarray(4),
  };
  for (const [name, bytes] of Object.entries(cands)) {
    const v = crc32(bytes) >>> 0;
    console.log(`${v === Y ? '*** MATCH ***' : '           '} ${name}: ${v}`);
  }
  app.quit();
});
