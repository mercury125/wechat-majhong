# 微信云开发部署

本项目支持两种后端运行方式：

- 本地/自有服务器：`server/` + `wx.request` + SQLite
- 微信云开发：`cloudfunctions/api/` + 云数据库 + `wx.cloud.callFunction`

云开发模式不需要公网 IP，也不需要配置 `request` 合法域名。小程序只需要调用同一个云函数，云函数使用 `cloud.getWXContext().OPENID` 识别玩家，不需要在小程序里保存 AppSecret。

## 前置条件

1. 使用真实小程序 AppID 导入项目，游客 AppID 无法使用云开发。
2. 在微信开发者工具中开通云开发环境，并记录环境 ID。
3. 云环境需要满足当前微信云开发的账号和使用要求。

## 1. 创建云数据库集合

云函数第一次被调用时会自动尝试创建以下集合：

```text
users
rooms
matches
history
```

如果环境权限不允许云函数创建集合，请在云开发控制台手动创建。建议把四个集合的权限都设置为“所有用户不可读写”，只允许云函数通过管理端权限访问。客户端不直接读写数据库。

当前实现把一局进行中的完整 match 快照放在 `rooms` 文档中，并限制云开发模式每场最多 **16 局**，避免超过云数据库单文档大小限制。

## 2. 上传角色图片

角色头像和表情图集位于：

```text
assets/characters/*.webp
```

把四个 WebP 文件上传到云存储，保持路径：

```text
assets/characters/ironclad-sheet.webp
assets/characters/silent-sheet.webp
assets/characters/defect-sheet.webp
assets/characters/watcher-sheet.webp
```

在 `miniprogram/config.js` 中把 `assetBase` 设置为这些文件的公共访问前缀，例如云文件前缀或 HTTPS 资源域名：

```js
assetBase: 'cloud://你的云环境文件前缀'
```

如果使用 HTTPS 图片域名，需要在微信公众平台配置为 `downloadFile` 合法域名；如果使用云文件 ID，则按微信当前的云文件组件规则配置。

## 3. 配置小程序

修改 `miniprogram/config.js`：

```js
'use strict';

module.exports = {
  apiBase: 'http://127.0.0.1:8787',
  cloudEnv: '你的云开发环境ID',
  assetBase: 'cloud://你的云环境文件前缀',
  development: false,
};
```

`cloudEnv` 非空时，`miniprogram/lib/api.js` 会把所有页面请求转换为云函数调用。`project.config.json` 已配置：

```json
"cloudfunctionRoot": "cloudfunctions/"
```

## 4. 构建并检查

```bash
npm ci --cache .cache/npm
npm run build
npm run check
npm test
```

`npm run build` 会做两件和云开发有关的事：

1. 生成小程序的牌面资源和验证示例；
2. 把 `miniprogram/lib/` 中云函数需要的纯规则模块复制到 `cloudfunctions/api/shared/`。

云函数部署时只会上传 `cloudfunctions/api/`，所以必须先执行 `npm run build`。

## 5. 部署云函数

在微信开发者工具中：

1. 打开云开发面板，选择目标环境；
2. 在项目树中找到 `cloudfunctions/api`；
3. 右键选择“上传并部署：云端安装依赖”；
4. 确认云函数部署成功；
5. 在云函数控制台把超时时间设置为 20 秒左右，避免冷启动或机器人连续操作超时；
6. 在云函数日志中检查 `api` 的调用和错误。

`cloudfunctions/api/package.json` 声明的依赖是 `wx-server-sdk`。云开发环境安装完成后，云函数会自动使用环境数据库和当前调用者的 OPENID。

If creating or opening a room reports `云端服务暂时异常，请稍后重试`, redeploy `cloudfunctions/api` to the environment named by `miniprogram/config.js`, then recompile the Mini Program. Room snapshot updates now use explicit `db.command.set` field replacements: ordinary object updates flatten nested fields and omit empty objects, which can break replacing a `null` match or clearing old controls. See the [CloudBase object-update documentation](https://docs.cloudbase.net/en/api-reference/webv2/database#set).

To diagnose a remaining failure without cloud logs, reproduce it with the Mini Program's DevTools **Console** open. `Cloud API failed` records the action, status, platform error code, and detail returned by the function. `Cloud function call failed` records failures before a function response is available. Request bodies are not logged. The cloud function also logs its action and preserves SDK `errCode` / `errMsg` fields. Copy the error entry instead of only the generic on-screen message; the latter cannot identify the live cause.

## 6. 调试和体验版

1. 用微信开发者工具编译项目；
2. 打开“云开发”确认环境绑定正确；
3. 使用“真机调试”或“预览”扫码；
4. 进入大厅，创建房间；
5. 四个体验成员分别进入同一房间测试；
6. 验证发牌、碰杠、结算、断线重连、历史和牌谱导出后，再上传体验版。

云开发模式不需要为后端配置公网 HTTPS 域名，也不需要 `WECHAT_APP_SECRET`。角色图片如果使用 HTTPS 资源域名，仍需按图片域名规则配置。

## 已实现的云函数接口

小程序页面仍使用原来的接口形式，客户端 `miniprogram/lib/api.js` 会自动映射到以下云函数 action：

```text
login
me
updateProfile
createRoom
join
command
view
controls
social
history
exportMatch
logout
health
```

Room refresh uses cloud-function polling with the configured `cloudPollMs` interval and a 300 ms minimum after successful requests. Request duration adds to that interval. Failed requests back off through 1, 2, 4, 8, and 15 seconds, subject to a longer configured normal interval. A successful response restores the normal interval and clears stale page errors even when the room revision is unchanged. Polling consumes cloud-function calls and database reads.

Each poll supplies its last room revision. After identity and seat checks, an unchanged room returns only its code, revision, and `unchanged: true`, avoiding player-profile queries and table construction. Full snapshots fetch the occupied players in one query. Player room lookup filters `seats` membership in the database before pagination. A local four-player read-transport fixture counted three database queries for a full view and two for an unchanged view, excluding heartbeat writes and cold initialization; these are query counts, not cloud latency measurements.

The lobby resolves all four character image URLs in one direct storage call, retains the cloud-function and PNG/WebP fallbacks for missing files, and restores the signed-in identity concurrently. PNG remains the configured preference because the existing deployment uses PNG files. Cold-instance collection initialization and the four-player active-match checks now run in parallel. These changes target four players and roughly ten rooms without imposing a new global room cap or changing replay retention.

## 已知限制

- 云开发模式每场最多 16 局。
- Polling delay depends on the configured interval, request duration, and failure retries.
- 房间和历史查询使用分页扫描，适合小规模房间，不适合大量公开房间。
- 云开发免费额度和数据库限制以当前微信云开发控制台为准。
- 本地 `server/` 仍保留，供浏览器预览和自动化测试使用；生产云开发模式不需要启动它。
