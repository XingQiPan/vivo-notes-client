# vivo 笔记云同步客户端（复刻）

独立 Electron 应用，复刻 vivo PC Suite 的**登录**与**笔记云同步**两条链路。
逆向依据见 `../analysis/01-auth-login.md`、`../analysis/04-note-sync.md`。

## 状态

- ✅ Maodun 信封加密引擎（CRC-32 + AES-128-CBC + RSA-2048 PKCS1 + 协议头）—— 自检通过，round-trip 可验证
- ✅ 三套鉴权头（网关 / 互传 / 云盘 STS）+ 网关 URL 拼装 + 业务错误码
- ✅ 登录：Electron webview 内嵌 passport，拦截回调页 hidden input 抠 7 段 cookie
- ✅ 同步引擎：USN 游标增量、脏数据分类、内容瘦身、30 条分块、50300 恢复、递归续拉
- ✅ 本地 SQLite（node:sqlite，Note/NoteBook/Tag/Resource/User/SyncState）
- ✅ 主进程 + IPC + 极简 UI（列表/编辑/登录/同步）
- ✅ 单测 10/10 通过

## ⚠️ 上线前必须做的两件事

1. **真机抓包对齐协议头字节序**：`protocalType`/`keyVersion`/`encryptionType`/`keyToken` 的真实取值是从 bundle 推断的默认值（0/1/1/空）。RSA 公钥、CRC、AES 模式、magic=203、长度前缀都已逐字节核对；但**这几个 header 字段的具体值需要你用 PC Suite 抓一次真实请求比对**。若不符，改 `src/crypto/maodun.js` 的 `Maodun` 构造默认值。
2. **公钥轮换**：服务端可能下发新公钥（magic 204 响应包）。当前用内置公钥，生产需实现 `_publicKeyHttpHeaderParsing` 的公钥刷新。

## 运行

```bash
cd client
npm install
npm run selftest        # 加密引擎自检
npm test                # 同步引擎单测
npm start               # 启动 Electron（首次会下载 electron，较慢）
```

环境变量 `VIVO_ENV=prod|pre|test` 切换网关。

## 目录

```
src/
  config.js              复刻的常量（网关/PROXY_ENUM/passport/RSA公钥/appKey）
  crypto/maodun.js       信封加密引擎
  crypto/maodun.selftest.js  自检
  net/headers.js         三套鉴权头 + 互传签名
  net/api-client.js      HTTP 客户端 + jvq_param 包装 + 错误码
  login/passport.js      登录 URL 构造 + cookie 解析（纯逻辑，可单测）
  login/login-window.js  Electron 登录窗口编排
  login/login-host.html  webview 宿主
  login/login-preload.mjs
  sync/note-sync.js      USN 同步引擎（拉/推/脏数据/分块）
  sync/store.js          本地 SQLite
  ui/                    主界面
  main.js                Electron 主进程 + IPC
```

## 架构对应

| 复刻模块 | 原始来源 |
|---|---|
| Maodun 加密 | bundle module 5227（`app-modules.js` @682173） |
| 网关鉴权头 | module 209（`child-window.js` @87506） |
| 互传签名 | module 3822（`getCyHeaders`） |
| requestBranch 分流 | module 128 |
| 同步端点 | module 1685 / 125 |
| USN 同步驱动 | `app-modules-note.js` module 1009 |
| 登录 cookie 映射 | `renderer.js` @1533995 |

## 法律与风控提示

- 逆向的 appKey/secret/公钥是客户端内置公开常量，但**非官方 API**，违反 vivo 服务条款。
- 服务端可能对 `source`/`deviceId`/`token` 做设备指纹风控，账号有被限制的实际风险。
- 仅用于个人数据互通研究，勿用于商业或批量操作。
