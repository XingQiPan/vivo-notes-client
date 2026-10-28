// 三套鉴权头复刻（见 analysis/01-auth-login.md）。
//   网关栈（module 209）: token, openId, source, version, deviceId
//   互传栈（module 3822/3824）: + timestamp, sign, model, systemVersion, appVersion
//   云盘直传: x-yun-ststoken / x-yun-openid / x-yun-metaid（与 token 体系不共用）

import crypto from 'node:crypto';
import { APP_VERSION, SOURCE_PC, CONNECT_NAME } from '../config.js';

// userInfo 形态：登录后由 login 模块填充
export function gatewayHeaders(userInfo) {
  return {
    token: userInfo.token || '',
    openId: userInfo.openId || '',
    source: SOURCE_PC,
    version: APP_VERSION,
    deviceId: userInfo.deviceId || '',
    'Content-Type': 'application/json',
  };
}

// 互传栈签名：base64(HMAC-SHA256(key=String(timestamp), msg=CONNECT_NAME))
// 注意：密钥是时间戳本身，消息是固定常量 —— 只防重放，不鉴身份。
export function transferSign(timestamp) {
  return crypto.createHmac('sha256', String(timestamp)).update(CONNECT_NAME).digest('base64');
}

export function transferHeaders(userInfo, platform = 'win') {
  const timestamp = Date.now();
  return {
    token: userInfo.token || '',
    openId: userInfo.openId || '',
    source: platform === 'mac' ? 4 : 3,
    timestamp,
    sign: transferSign(timestamp),
    deviceId: userInfo.deviceId || '',
    model: platform === 'mac' ? 'mac' : 'win',
    systemVersion: userInfo.systemVersion || '',
    appVersion: APP_VERSION,
    'Content-Type': 'application/json',
  };
}

export function cloudHeaders(sts) {
  return {
    'x-yun-ststoken': sts.stsToken || '',
    'x-yun-openid': sts.openId || '',
    'x-yun-metaid': sts.metaId || '',
  };
}
