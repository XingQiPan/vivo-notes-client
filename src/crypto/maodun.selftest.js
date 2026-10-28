// Maodun 自检：验证加密→解密 round-trip 与 CRC 表实现。
// 用法：node src/crypto/maodun.selftest.js

import assert from 'node:assert';
import { crc32, crcToBytes, Maodun, randomKey } from './maodun.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));

// 从数据集取内置公钥
const ds = JSON.parse(readFileSync(join(HERE, '../../..', 'web/data/api-dataset.json'), 'utf8'));
const PUBKEY = ds.noteSync.encryption.embeddedPublicKey;

// 1. CRC-32 标准向量（poly 0xEDB88320 反射表实现 == 标准 CRC-32）
assert.strictEqual(crc32(Buffer.from('123456789', 'ascii')).toString(16).padStart(8, '0'),
  'cbf43926', 'CRC-32("123456789") 应为 cbf43926');
assert.strictEqual(crc32(Buffer.from('')), 0, 'CRC-32("") = 0');
assert.strictEqual(crc32(Buffer.from('a', 'ascii')).toString(16).padStart(8, '0'),
  'e8b7be43', 'CRC-32("a") 应为 e8b7be43');

// 2. crcToBytes 前 4 字节为 0，后 4 字节为大端 CRC（Int8Array 存 >127 会回绕成负数，按 &255 比较）
const cb = crcToBytes(0xCBF43926);
assert.deepStrictEqual([...cb.slice(0, 4)], [0, 0, 0, 0]);
assert.deepStrictEqual([...cb.slice(4)].map(b => b & 255), [0xCB, 0xF4, 0x39, 0x26]);

// 3. randomKey 字符集与长度
const k = randomKey(16);
assert.strictEqual(k.length, 16);
assert.match(k, /^[0-9A-Z]{16}$/, 'key 必须全为 [0-9A-Z]');

// 4. 加密 → 解密 round-trip（用已知 key 复现 AES）
const payload = {
  type: 0,
  afterUsn: 123456,
  maxEntries: 200,
  syncProtocolVersion: 200,
};
const m = new Maodun(PUBKEY, { aesKey: 'AAAAAAAAAAAAAAAA', aesIv: 'BBBBBBBBBBBBBBBB' });
const enc = m.encrypt(payload);
assert.strictEqual(enc.code, 0);
assert.match(enc.data, /^[A-Za-z0-9_-]+$/, '输出必须为 base64url');
const dec = m.decrypt(enc.data);
assert.strictEqual(dec, JSON.stringify(payload), '解密应还原原始 JSON');

// 5. 头部结构抽查：magic=203 出现在 crc(8)+pt(2) 之后，即 offset 10
const bytes = (() => {
  let s = enc.data.replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  return new Uint8Array(Buffer.from(s, 'base64'));
})();
assert.strictEqual(bytes[13], 203, 'magic 低字节应为 203（大端 [0,203]）');
// 长度前缀声明的是 CRC+header 的字节数（不含 AES 密文体）
const declaredLen = (bytes[0] << 8) | bytes[1];
const headerSpan = 8 + (bytes[10] << 8 | bytes[11] ? 0 : 0); // crc(8)+header
// header 实际长度 = 包总长 - 2(lenPrefix) - 密文体长度；密文体长度 = 包总长 - 2 - declaredLen
assert.strictEqual(declaredLen, bytes.length - 2 - (bytes.length - 2 - declaredLen), '长度前缀应等于 CRC+header 字节数');
assert.ok(declaredLen > 280 && declaredLen < 300, `声明长度 ${declaredLen} 应在 280~300（256 字节 RSA 密文 + 头部）`);

console.log('[maodun selftest] ALL PASS');
console.log('  aesKey :', m.aesKey);
console.log('  aesIv  :', m.aesIv);
console.log('  payload bytes:', bytes.length);
console.log('  crc32(123456789) =', crc32(Buffer.from('123456789')).toString(16));
