// HTTP 客户端：复刻 requestBranch 的"非 sync → 真 HTTP"分支 + Maodun 加密包装。
// 网关 URL = GATEWAY[env] + '/' + PROXY_ENUM[proxyKey] + url

import { GATEWAY, PROXY_ENUM } from '../config.js';
import { gatewayHeaders } from './headers.js';
import { Maodun } from '../crypto/maodun.js';
import { MAODUN_PUBLIC_KEY } from '../config.js';

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
    const headers = gatewayHeaders(this.userInfo);

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

    const res = await fetch(url, { method, headers, body });
    if (!res.ok) {
      throw Object.assign(new Error(`HTTP ${res.status} ${res.statusText}`), { httpStatus: res.status });
    }
    const json = await res.json();
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
