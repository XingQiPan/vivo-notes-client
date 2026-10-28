// Maodun（矛盾）信封加密引擎 —— 复刻自 vivo PC Suite bundle 的 module 5227。
//
// 已逐字节核对的实现：
//   aesKey / aesIv : 各 16 字符，字符集 [0-9A-Z]，随机生成（randomGenerate）
//   AES            : CryptoJS AES-128-CBC / Pkcs7，key/iv 用 Utf8.parse（即 16 字节 ASCII）
//   RSA            : PKCS#1 v1.5，公钥为 base64(PEM SubjectPublicKeyInfo)
//   协议头          : [protocalType(2), magic=203(2), keyVersion(2), encType(1),
//                      keyTokenLen(1), keyToken(n), iv(16), rsaKeyLen(2), rsaKey(256)]
//   CRC            : CRC-32 (poly 0xEDB88320, init -1, final ^-1)，init 参数传 undefined → -1
//   最终包          : crcBytes(8) + header + lenPrefix(2, 大端) + AES(base64 解码后的密文)
//   输出            : base64url（+ → -，/ → _，去 =）
//
// 注意：numberToArrayBuffer 取的是 16 字节大端缓冲的最后 2 字节（.subarray(14)），即大端 uint16 长度。

import CryptoJS from 'crypto-js';
import forge from 'node-forge';

const ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';

// ---- CRC-32（与 bundle 内查表实现等价）----
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let i = 0; i < 256; i++) {
    let e = i;
    for (let k = 0; k < 8; k++) {
      e = e & 1 ? (0xEDB88320 ^ (e >>> 1)) : (e >>> 1);
    }
    t[i] = e;
  }
  return t;
})();

export function crc32(bytes) {
  let c = -1; // init = -1（对应 bundle 的 -1 ^ a，a=undefined → -1）
  for (let i = 0; i < bytes.length; i++) {
    c = (c >>> 8) ^ CRC_TABLE[255 & (c ^ bytes[i])];
  }
  return (-1 ^ c) >>> 0;
}

// bundle 的 n(crc)：8 字节，前 4 字节为 0，后 4 字节为大端 CRC。
// 源码用 parseInt(hex.substr(0,len-8),16) 取高位——对 32 位 CRC 恒为 0。
export function crcToBytes(crc) {
  const out = new Int8Array(8);
  out[7] = crc & 255;
  out[6] = (crc >>> 8) & 255;
  out[5] = (crc >>> 16) & 255;
  out[4] = (crc >>> 24) & 255;
  // out[0..3] = 0
  return out;
}

function randomKey(len = 16) {
  let s = '';
  const buf = new Uint8Array(len);
  globalThis.crypto.getRandomValues(buf);
  for (let i = 0; i < len; i++) s += ALPHABET[buf[i] % ALPHABET.length];
  return s;
}

function concatBytes(arrays) {
  let total = 0;
  for (const a of arrays) total += a.length;
  const out = new Uint8Array(total);
  let off = 0;
  for (const a of arrays) { out.set(a, off); off += a.length; }
  return out;
}

function toBase64Url(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  const b64 = Buffer.from(bin, 'binary').toString('base64');
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(s) {
  let b64 = s.replace(/-/g, '+').replace(/_/g, '/');
  while (b64.length % 4) b64 += '=';
  return new Uint8Array(Buffer.from(b64, 'base64'));
}

// AES-128-CBC/Pkcs7，key/iv 为 16 字符 ASCII 串
function aesEncrypt(plaintext, keyStr, ivStr) {
  const key = CryptoJS.enc.Utf8.parse(keyStr);
  const iv = CryptoJS.enc.Utf8.parse(ivStr);
  return CryptoJS.AES.encrypt(plaintext, key, {
    iv, mode: CryptoJS.mode.CBC, padding: CryptoJS.pad.Pkcs7,
  }).toString(); // OpenSSL base64 格式
}

function aesDecrypt(b64, keyStr, ivStr) {
  const key = CryptoJS.enc.Utf8.parse(keyStr);
  const iv = CryptoJS.enc.Utf8.parse(ivStr);
  return CryptoJS.AES.decrypt(b64, key, {
    iv, mode: CryptoJS.mode.CBC, padding: CryptoJS.pad.Pkcs7,
  }).toString(CryptoJS.enc.Utf8);
}

// RSA PKCS#1 v1.5 加密 AES key 字符串（公钥为 base64(PEM)）
function rsaEncryptKey(keyStr, publicKeyB64) {
  const pem = normalizePem(publicKeyB64);
  const pub = forge.pki.publicKeyFromPem(pem);
  const encrypted = pub.encrypt(keyStr, 'RSAES-PKCS1-V1_5');
  return new Uint8Array(forge.util.createBuffer(encrypted).bytes().split('').map(c => c.charCodeAt(0)));
}

function normalizePem(b64OrPem) {
  // 若已是 PEM 文本直接返回；否则当作 base64(PEM) 解码
  if (b64OrPem.includes('BEGIN PUBLIC KEY')) return b64OrPem;
  let s = b64OrPem.replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  const raw = Buffer.from(s, 'base64').toString('binary');
  // 公钥 PEM 通常在包的尾部，直接尝试提取 BEGIN..END
  const m = raw.match(/-----BEGIN PUBLIC KEY-----[\s\S]*?-----END PUBLIC KEY-----/);
  if (m) return m[0];
  // 回退：把整段按 PEM 包裹
  const b64 = Buffer.from(raw, 'binary').toString('base64').replace(/(.{64})/g, '$1\n');
  return `-----BEGIN PUBLIC KEY-----\n${b64}\n-----END PUBLIC KEY-----`;
}

/**
 * 一次加密会话。持有随机 aesKey/aesIv 与服务端 RSA 公钥。
 */
export class Maodun {
  /**
   * @param {string} publicKeyB64 base64(PEM) 或 PEM 文本
   * @param {object} opts { protocalType=0, keyVersion=1, encryptionType=1, keyToken=new Uint8Array([0]) }
   */
  constructor(publicKeyB64, opts = {}) {
    this.publicKeyB64 = publicKeyB64;
    this.aesKey = opts.aesKey || randomKey(16);
    this.aesIv = opts.aesIv || randomKey(16);
    this.protocalType = opts.protocalType ?? 0;     // 2 字节
    this.keyVersion = opts.keyVersion ?? 1;         // 2 字节
    this.encryptionType = opts.encryptionType ?? 1; // 1 字节
    this.keyToken = opts.keyToken ?? new Uint8Array([0]); // 1 字节长度 + 内容
    this.keyTokenLen = this.keyToken.length;
  }

  _buildHeader() {
    const pt = new Uint8Array(2); pt[0] = this.protocalType & 255; pt[1] = (this.protocalType >> 8) & 255;
    const magic = new Uint8Array(2); magic[0] = 203; magic[1] = 0; // getInt16Bytes(2,203) 大端? 见下注
    // bundle: getInt16Bytes 用 DataView.setInt16(默认大端) 写 203 → [0,203]
    magic[0] = (203 >> 8) & 255; magic[1] = 203 & 255; // 大端 → [0,203]
    const kv = new Uint8Array(2); kv[0] = (this.keyVersion >> 8) & 255; kv[1] = this.keyVersion & 255;
    const et = new Uint8Array([this.encryptionType & 255]);
    const ktl = new Uint8Array([this.keyTokenLen & 255]);
    const iv = new Uint8Array(Buffer.from(this.aesIv, 'ascii')); // 16 字节
    const rsaKey = rsaEncryptKey(this.aesKey, this.publicKeyB64);
    const rkl = new Uint8Array(2); rkl[0] = (rsaKey.length >> 8) & 255; rkl[1] = rsaKey.length & 255;

    return concatBytes([pt, magic, kv, et, ktl, this.keyToken, iv, rkl, rsaKey]);
  }

  /** 加密一个对象/字符串，返回 { code, data } */
  encrypt(obj) {
    const plaintext = typeof obj === 'string' ? obj : JSON.stringify(obj);
    const header = this._buildHeader();
    const crc = crcToBytes(crc32(header));
    const withCrc = concatBytes([crc, header]);
    // 长度前缀声明的是 CRC+header 的字节数（大端 uint16）
    const len = withCrc.length;
    const lenPrefix = new Uint8Array([(len >> 8) & 255, len & 255]);
    const body = fromBase64UrlSafe(aesEncrypt(plaintext, this.aesKey, this.aesIv));
    const full = concatBytes([lenPrefix, withCrc, body]);
    return { code: 0, data: toBase64Url(full) };
  }

  /** 解密服务端响应（若走同一信封格式） */
  decrypt(b64url) {
    const bytes = fromBase64Url(b64url);
    // 跳过 2 字节长度前缀 + 8 字节 CRC，再跳过 header 到密文体
    // header 长度需从包内解析：magic 在 offset 2..4，keyTokenLen 在 offset 7
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let off = 2 + 8; // len + crc
    // pt(2) magic(2) kv(2) et(1) ktl(1)
    const ktl = bytes[off + 7];
    const ivLen = 16;
    const rklOff = off + 8 + ktl + ivLen;
    const rsaKeyLen = (bytes[rklOff] << 8) | bytes[rklOff + 1];
    const headerEnd = rklOff + 2 + rsaKeyLen;
    const body = bytes.subarray(headerEnd);
    // 解密 AES key：需私钥，客户端一般不解密响应（响应明文或另用 key）
    // 这里仅还原密文 base64，AES key 已知（本会话生成）
    const ctB64 = Buffer.from(body).toString('base64');
    return aesDecrypt(ctB64, this.aesKey, this.aesIv);
  }
}

function fromBase64UrlSafe(s) {
  // CryptoJS 输出是标准 base64，转字节
  return new Uint8Array(Buffer.from(s, 'base64'));
}

export { randomKey, toBase64Url, fromBase64Url };
