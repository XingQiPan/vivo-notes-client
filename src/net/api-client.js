// HTTP 客户端：复刻 requestBranch 的"非 sync → 真 HTTP"分支 + Maodun 加密包装。
// 网关 URL = GATEWAY[env] + '/' + PROXY_ENUM[proxyKey] + url

import { GATEWAY, PROXY_ENUM } from '../config.js';
import { gatewayHeaders } from './headers.js';
import { Maodun } from '../crypto/maodun.js';
import { MAODUN_PUBLIC_KEY } from '../config.js';
// 懒加载 electron：纯逻辑单测在系统 Node 下运行，无 electron 模块
async function electronSession() {
  return import('electron').then(m => m.session || (m.default && m.default.session));
}
async function accountCookieHeaderLazy() {
  const m = await import('../login/cookies.js');
  return m.accountCookieHeader();
}

// 网关要求浏览器式跨站请求带 CSRF cookie（SameSite=Lax 会丢弃 XHR 的 cookie）。
// 原版 PC Suite 用 axios + withCredentials:true，Chromium 网络栈按 XHR 语义发送；
// session.fetch 同样受 SameSite 限制，因此这里手动拼 Cookie 头兜底。
async function cookieHeaderFor() {
  try {
    const str = await accountCookieHeaderLazy();
    return str ? { Cookie: str } : {};
  } catch {
    return {};
  }
}

export class ApiClient {
  /**
   * @param {object} opts { env:'prod'|'pre'|'test', userInfo }
   */
  constructor(opts = {}) {
    this.env = opts.env || 'prod';
    this.userInfo = opts.userInfo || {};
    this.gateway = GATEWAY[this.env];
    this.maodun = new Maodun(MAODUN_PUBLIC_KEY);
  }

  /**
   * 复刻 requestBranch({url, method, data, encrypt, proxy})
   * @param {object} req { url, method, data, encrypt, proxy }
   *   proxy: PROXY_ENUM 的 key（如 'NOTE_PROXY'），默认 NOTE_PROXY
   *   encrypt: true → body 包成 {jvq_param: ...}
   */
  async request(req) {
    const proxyKey = req.proxy || 'NOTE_PROXY';
    const prefix = PROXY_ENUM[proxyKey];
    const url = `${this.gateway}/${prefix}${req.url}`;
    const method = (req.method || 'GET').toUpperCase();

    let body;
    const headers = { ...gatewayHeaders(this.userInfo), ...(await cookieHeaderFor()) };

    if (method === 'GET') {
      // GET 参数走 query（此处简化：调用方自行拼好 url）
      body = undefined;
    } else if (req.encrypt) {
      const enc = this.maodun.encrypt(req.data ?? {});
      if (enc.code !== 0) throw Object.assign(new Error('Maodun encrypt failed'), { code: enc.code });
      body = JSON.stringify({ jvq_param: enc.data });
    } else {
      body = req.data ? JSON.stringify(req.data) : undefined;
    }

    const ses = await electronSession();
    const res = await ses.defaultSession.fetch(url, { method, headers, body, credentials: 'include' });
    const text = await res.text();
    if (!res.ok) {
      console.log('[http] %s %s -> %s %s', method, url, res.status, text.slice(0, 300));
      throw Object.assign(new Error(`HTTP ${res.status} ${res.statusText}`), { httpStatus: res.status });
    }
    let json;
    try { json = JSON.parse(text); } catch {
      console.log('[http] %s %s -> non-JSON: %s', method, url, text.slice(0, 300));
      throw Object.assign(new Error('响应不是 JSON'), { raw: text });
    }
    if (json.code !== 0) {
      console.log('[http] %s %s -> FULL=%s', method, url, text.slice(0, 300));
    }
    // 响应体是 Maodun 信封（jvq_response），需要用同一会话的 AES key 解密
    if (json.jvq_response) {
      const plain = this.maodun.decrypt(json.jvq_response);
      const inner = JSON.parse(plain);
      if (inner.code !== 0) {
        console.log('[http] %s %s -> inner code=%s msg=%s', method, url, inner.code, inner.msg);
        throw Object.assign(new Error(inner.msg || '服务器返回异常'), { code: inner.code });
      }
      const d = inner.data;
      const summary = d && typeof d === 'object'
        ? Object.entries(d).map(([k, v]) => `${k}:${Array.isArray(v) ? v.length : typeof v}`).slice(0, 6).join(' ')
        : typeof d;
      console.log('[http] %s %s -> OK %s', method, url, summary);
      return d;
    }
    return unwrapResponse(json);
  }
}

// 复刻 module 3824 响应拦截器的错误码语义
export function unwrapResponse(json) {
  const { code, msg, data, success } = json || {};
  switch (code) {
    case 0: return data;
    case -1: throw bizErr(-1, '未知异常');
    case 1001: throw bizErr(1001, '上传限额已用完');
    case 1002: throw bizErr(1002, 'Token 无效');
    case 1003: throw bizErr(1003, 'AppKey 错误');
    case 1004: throw bizErr(1004, '签名错误');
    case 1015: throw bizErr(1015, '账号 token 已过期');
    case 50300: throw Object.assign(bizErr(50300, '资源级失败'), { data: json.data });
    case 23000: throw bizErr(23000, '云空间已满');
    case 25999: throw bizErr(25999, '分片需重试');
    default:
      if (success === true) return data;
      throw bizErr(code, msg || '未处理的业务码');
  }
}
function bizErr(code, message) {
  const e = new Error(message);
  e.code = code;
  return e;
}
