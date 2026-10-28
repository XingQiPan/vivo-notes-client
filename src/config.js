// 复刻自 vivo PC Suite bundle 的配置常量（main.js 配置中心 + module 549）。
// 这些值来自逆向，非官方公开。

export const HOST_ENUM = { PROD: 'prod', PRE: 'pre', TEST: 'test' };

// PROXY_ENUM → 网关路径前缀
export const PROXY_ENUM = {
  NOTE_PROXY: 'vbusiness',
  ALBUM_PROXY: 'valbum',
  INFO_PROXY: 'vinfo',
  UPGRADE_PROXY: 'vupgrade',
  CLOUD_PROXY: 'vclouddisk',
  DEVICE_PROXY: 'deviceReport',
};

// 统一网关
export const GATEWAY = {
  prod: 'https://psuite.vivo.com.cn',
  pre: 'https://psuite-pre.vivo.com.cn',
  test: 'https://productivity-suite-test.vivo.com.cn',
};

// 账号 / passport
export const COMMON_CONFIG = {
  accountCommonUrl: 'https://passport.vivo.com.cn',
  loginUrl: 'https://passport.vivo.com.cn/#/login',
  accountCenterUrl: 'https://passport.vivo.com.cn/#/personalCenter',
  accountTokenShareUrl: 'https://passport.vivo.com.cn/thirdpart/productivity/transfer',
  webClientId: 131,
  pcClientId: 130,
};

// 登录回跳（服务端换 cookie 的页面）
export const PC_REDIRECT = {
  prod: 'https://psuite.vivo.com.cn/vbusiness/account/cookie/getHtml',
  pre: 'https://psuite-pre.vivo.com.cn/vbusiness/account/cookie/getHtml',
  test: 'https://productivity-suite-test.vivo.com.cn/vbusiness/account/cookie/getHtml',
};

// Maodun 内置 RSA-2048 公钥（从 bundle module 5227 提取）
export const MAODUN_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAmWPQgP6vW6gwHWnMyYtS
cynrHCzvQgZQ2dCzHEWfL13u9EZ0R/1Vv5xSsli/oTFkR5bs8Glx26iHcOw2KUyp
YaFgehuSpvuVLGtJyV96aQMGC/3WgS2ObUa2Ry7rGzwUD7KsYnnlqMOlD3IS2Ytj
igPF1VyvK12KMlmfSGlM2JIsG+v9DEkqV3riPbSj9UnstUq1OaGevBg0MIeEI7hX
ITIESe9og96s0w+0Kixx3CnUszOI+1flt4fuaC8MzDvreTlMuosYHA4AUrE038vZ
52PO1Xgx1hlRxHYM7Yd/d9paunTlYcDc5c0/Zeu/wp8K6yjwBBs8bi6t58O8oKsZ
kQIDAQAB
-----END PUBLIC KEY-----`;

// 互传栈签名常量
export const CONNECT_NAME = 'com.vivo.pcsuite.connect';

// appKey / secret（module 549，三档环境取值相同，仅 win/mac 区分）
export const APP_KEYS = {
  win: { appKey: '1046870e8cff4a8ba99f6ea90026e36c', secret: '315d77f6a4474d35a09c43a75d312776' },
  mac: { appKey: '7085a63dbc204fe99e0a9cf2a85fc3cf', secret: '871183ee1ab84fbaa7c0632d0e9478f9' },
};

export const APP_VERSION = '7.0.6';
export const SOURCE_PC = '2'; // 网关栈：PC 端字符串 "2"，Web 端 "1"
