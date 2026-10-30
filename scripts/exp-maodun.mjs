// 实验：用原版 bundle 里日历公钥包的头部字节（pt/kv/et/keyToken）作为客户端请求头，
// 但 RSA 仍用笔记公钥加密 AES key。验证服务器是否接受这种组合。
import { Maodun } from '../src/crypto/maodun.js';
import { MAODUN_PUBLIC_KEY } from '../src/config.js';

const m = new Maodun(MAODUN_PUBLIC_KEY);

// 日历 blob 头 28 字节：pt(00cc) magic(001a) kv(4110) et(63) ktl(6f) token('m.bbk.calen')
// 笔记客户端真实布局应为：pt(2) magic(2) kv(2) et(1) ktl(1) token(n) iv(16) rkl(2) rsa(256)
// 日历 blob 里 pt=0x00cc kv=0x4110 et=0x63 ktl=0x6f —— 这些值明显是日历场景专用。
// 笔记场景的 pt/kv/et 需要找笔记自己的公钥包。先试 et=1 kv=1 pt=0 的常规组合（当前实现），
// 再试从日历 blob 抄的 pt=0x00cc。

const variants = [
  { name: 'default', opts: {} },
  { name: 'pt=0x00cc', opts: { protocalType: 0x00cc } },
  { name: 'keyToken=com.bbk.calendar', opts: { keyToken: new TextEncoder().encode('com.bbk.calendar') } },
  { name: 'keyToken=com.vivo.note', opts: { keyToken: new TextEncoder().encode('com.vivo.note') } },
  { name: 'keyToken=com.vivo.pcsuite.note', opts: { keyToken: new TextEncoder().encode('com.vivo.pcsuite.note') } },
];

for (const v of variants) {
  const mm = new Maodun(MAODUN_PUBLIC_KEY, v.opts);
  const enc = mm.encrypt({ type: 0, afterUsn: 0, maxEntries: 200, syncProtocolVersion: 200 });
  const res = await fetch('https://psuite.vivo.com.cn/vbusiness/sync/getSyncChunk/v2', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', token: '', openId: '', source: '2', version: '7.0.6', deviceId: '' },
    body: JSON.stringify({ jvq_param: enc.data }),
  });
  const t = await res.text();
  console.log(`[${v.name}] ->`, res.status, t.slice(0, 120));
}
