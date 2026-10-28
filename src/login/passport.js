// 登录：复刻 PC Suite 的 passport 网页授权流程（见 analysis/01-auth-login.md）。
//
// 关键点：
//   1. redirect_uri 是服务端白名单，只认 psuite.vivo.com.cn/vbusiness/account/cookie/getHtml
//      → 不能纯后端换 token，必须内嵌 webview 加载登录页，拦截回调页 DOM。
//   2. 回调页 hidden input 的 value 按 "&" 切成 7 元素数组，按固定下标映射为 userInfo 字段。
//   3. client_id：PC=130，Web=131。
//
// 本模块导出纯逻辑（URL 构造 + cookie 解析），Electron 窗口编排在 main.js。

import { COMMON_CONFIG, PC_REDIRECT } from '../config.js';

/**
 * 构造登录页 URL
 * @param {object} opts { env, theme, lang, clientId }
 */
export function buildLoginUrl(opts = {}) {
  const env = opts.env || 'prod';
  const clientId = opts.clientId || COMMON_CONFIG.pcClientId;
  const redirect = PC_REDIRECT[env];
  const params = new URLSearchParams({
    client_id: String(clientId),
    redirect_uri: redirect,
    type: '',
    theme: opts.theme || '',
    lang: opts.lang || 'zh-CN',
  });
  return `${COMMON_CONFIG.loginUrl}?${params.toString()}`;
}

// 回调页 hidden input value 的 7 元素数组 → userInfo 字段（按固定下标）
export const COOKIE_KEYS = [
  'vivo_account_cookie_iqoo_openid',
  'vivo_account_cookie_iqoo_vivotoken',
  'vivo_account_cookie_iqoo_deviceid',
  'vivo_account_cookie_iqoo_regioncode',
  'vivo_account_cookie_cloud_checksum',
  'vivo_account_cookie_cloud_openid',
  'vivo_yun_csrftoken',
];

/**
 * 解析回调页 hidden input 的 value（7 段 & 分隔）
 * @param {string} rawValue
 * @returns {object} userInfo 片段
 */
export function parseLoginCookie(rawValue) {
  const parts = String(rawValue || '').split('&');
  const out = {};
  COOKIE_KEYS.forEach((k, i) => { out[k] = parts[i] || ''; });
  // 兼容：openId/token 同时映射到顶层
  out.openId = out.vivo_account_cookie_iqoo_openid;
  out.token = out.vivo_account_cookie_iqoo_vivotoken;
  out.regionCode = out.vivo_account_cookie_iqoo_regioncode;
  return out;
}

/**
 * 判断一个 URL 是否是登录回跳目标
 */
export function isLoginCallback(url) {
  return typeof url === 'string' && url.includes('vbusiness/account/cookie/getHtml');
}
