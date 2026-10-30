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

// Maodun 内置 RSA-2048 公钥
//
// bundle 里每个模块各自带一组 keyToken × keyVersion 的公钥包（magic 204 blob）。
// 笔记模块（app-modules-note.js / 126.js）用的是 keyToken = "com.vivo.atomic.note"，
// 而 analysis/04-note-sync.md 里摘录的 "com.bbk.calendar" 那一组是日历模块的 ——
// 用错 keyToken 会被服务器以「找不到 keyToken:...,keyType:8,keyVersion:...对应的三级密钥」拒绝。
//
// 服务器实测可用的组合：keyToken=com.vivo.atomic.note, keyVersion=1, encryptionType=65。
// 其余两个 keyVersion（221 / 231）服务器侧已无对应三级密钥。
export const MAODUN_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAvHf1Y2s5sT4sGXOS//EBaZED8XYOxV0maVJUmq26+/pORe8KapSwkYd/xJxgZL+9i/F3fzVilLZsyO1WdVbu47//sBrfp2TiCIAGYAFVTzviaNVmT7FAC4fh7Bx2eRmbWozlDpbvQuaGxtd0NlbU/HwhDecLjYu9boaeOKJiVYOlKa8MB1lkv4OV0lwphgELjky4lvTTtVqNcz6h1j1+RMOR6iYcCRsfJVjDb1Tsev3ETp8kKc34dGtUjA+eRMfna6M2ZCKNOci+7ElV/AIjKHxXzRnfgubxpnNU4AgAolHjXxaPi7Xuytufx47igerABnwQtBENjpm0rjsP12op8QIDAQAB
-----END PUBLIC KEY-----`;

// 信封头参数（与 blob 解析结果一致）：
//   keyToken     = com.vivo.atomic.note
//   keyVersion   = 1
//   protocalType = 0x0020
//   encryptionType = 0x41 (65)
export const MAODUN_KEY_TOKEN = 'com.vivo.atomic.note';
export const MAODUN_KEY_VERSION = 1;
export const MAODUN_PROTOCAL_TYPE = 0x0020;
export const MAODUN_ENCRYPTION_TYPE = 0x41;

// bundle 里另一把（module 5227 文档摘录，日历模块 com.bbk.calendar），保留备查
export const MAODUN_PUBLIC_KEY_ALT = `-----BEGIN PUBLIC KEY-----
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
