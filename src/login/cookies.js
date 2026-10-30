// 登录态相关的公共逻辑：cookie 迁移。
// 原版 PC Suite 的业务请求走 axios + withCredentials:true，浏览器会把网关域下的
// vivo 账号 cookie 一并发过去；我们用 Electron 的 fetch，需要手动搬运。

import { session } from 'electron';

/**
 * 把登录分区（persist:login）里的 vivo 账号 cookie 迁移到主 session，
 * 使业务请求带上账号 cookie（网关除 token/openId 头外还会校验 cookie）。
 */
export async function migrateAccountCookies() {
  const src = session.fromPartition('persist:login');
  const dst = session.defaultSession;
  const cookies = await src.cookies.get({});

  // 1) 账号 cookie（passport 域）→ 种到 .vivo.com.cn 和 psuite.vivo.com.cn
  const acct = cookies.filter(c => /vivo_account_cookie|vivo_yun_csrftoken/.test(c.name));
  for (const c of acct) {
    for (const dom of ['.vivo.com.cn', 'psuite.vivo.com.cn']) {
      try {
        await dst.cookies.set({
          url: 'https://' + dom.replace(/^\./, '') + '/',
          name: c.name, value: c.value,
          domain: dom, path: '/',
          secure: true, httpOnly: c.httpOnly,
          expirationDate: c.expirationDate,
        });
      } catch { /* 个别组合可能失败，忽略 */ }
    }
  }

  // 2) 网关自身种下的 cookie（如 @vivo_vcode_uid 风控 ID）
  const gw = cookies.filter(c => /vivo\.com\.cn/.test(c.domain) && !/vivo_account_cookie|vivo_yun_csrftoken/.test(c.name));
  for (const c of gw) {
    const proto = c.secure ? 'https://' : 'http://';
    const dom = c.domain.startsWith('.') ? c.domain.slice(1) : c.domain;
    try {
      await dst.cookies.set({
        url: proto + dom + (c.path || '/'),
        name: c.name, value: c.value,
        domain: c.domain, path: c.path || '/',
        secure: c.secure, httpOnly: c.httpOnly,
        expirationDate: c.expirationDate,
      });
    } catch { /* ignore */ }
  }
  return cookies;
}

/** 主 session 里可用于业务请求的 cookie 串（按 name 去重） */
export async function accountCookieHeader() {
  const cookies = await session.defaultSession.cookies.get({});
  const seen = new Map();
  for (const c of cookies) {
    if (!/vivo_account|vivo_yun/.test(c.name)) continue;
    if (!seen.has(c.name)) seen.set(c.name, c.value);
  }
  return [...seen].map(([k, v]) => `${k}=${v}`).join('; ');
}
