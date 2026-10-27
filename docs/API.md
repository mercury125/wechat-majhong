# HTTP API 参考

本文档描述原生小程序、浏览器开发页与后端之间的 HTTP 契约；小程序也可通过 `miniprogram/lib/api.js` 调用云函数，部署说明见 [CLOUD_DEVELOPMENT.md](CLOUD_DEVELOPMENT.md)。实现以 [server/http.js](../server/http.js)、[server/service.js](../server/service.js) 和 [miniprogram/lib/engine.js](../miniprogram/lib/engine.js) 为准；如果本文与代码不一致，应更新本文并补充对应测试。

## 基础约定

- 开发地址默认为 `http://127.0.0.1:8787`，生产环境应由 HTTPS 反向代理暴露同一服务。客户端在 [miniprogram/config.js](../miniprogram/config.js) 中配置 `apiBase`；如果配置 `cloudEnv`，则改走云函数。
- 若配置 `cloudEnv`，客户端会把同样的路径映射为 `wx.cloud.callFunction` 的 `action`；云函数部署说明见 [CLOUD_DEVELOPMENT.md](CLOUD_DEVELOPMENT.md)。
- 除登录、`/health` 和静态资源外，所有 API 接口都要求请求头 `Authorization: Bearer <token>`。令牌由登录接口签发，有效期 30 天；服务端只保存令牌的 SHA-256 摘要。
- 请求体必须是 JSON 对象，最大 64 KiB。响应统一为 JSON。
- 错误响应格式为 `{"error":"中文错误说明"}`。常用状态码：`400` 参数或规则错误，`401` 未登录/令牌过期，`403` 不是房间成员，`404` 资源不存在，`409` revision 过期或状态冲突，`413` 请求体过大，`429` 频率限制，`500` 服务异常，`502/503` 微信登录或上游暂不可用。
- `/commands` 中每个会改变房间或对局状态的请求都必须带客户端生成的 `id`。`id` 须匹配 `^[A-Za-z0-9_-]{1,128}$`，并在重试时保持原值。服务端按“用户 + id + 规范化 payload”保存幂等回执；相同 id 和相同内容重试不会重复结算，相同 id 改用其他内容会得到 `409`。
- 长轮询断开或返回错误时，客户端应重新获取当前房间视图；不要仅凭本地缓存推进对局。

## 接口总览

| 方法 | 路径 | 鉴权 | 用途 |
| --- | --- | --- | --- |
| `GET` | `/health` | 否 | 健康检查，返回 `{"ok":true}` |
| `POST` | `/api/login/wechat` | 否 | 用 `wx.login()` 的 code 换取登录令牌 |
| `POST` | `/api/login/dev` | 否，仅本机开发模式 | 创建开发身份并换取登录令牌 |
| `GET` | `/api/me` | 是 | 当前用户资料及所在房间 |
| `POST`/`PATCH` | `/api/me` | 是 | 修改昵称或牌谱保留上限 |
| `POST` | `/api/logout` | 是 | 注销当前令牌 |
| `GET` | `/api/history` | 是 | 列出已完成对局 |
| `GET` | `/api/matches/:id` | 是 | 导出有权访问的对局牌谱 |
| `POST` | `/api/rooms` | 是 | 创建好友房或单人测试房 |
| `POST` | `/api/rooms/:code/join` | 是 | 加入房间或重连已占座位 |
| `GET` | `/api/rooms/:code` | 是，房间成员 | 获取房间视图；带 `after` 时进行长轮询 |
| `POST` | `/api/rooms/:code/commands` | 是，房间成员 | 提交房间或对局命令 |
| `POST`/`PATCH` | `/api/rooms/:code/controls` | 是，房间成员 | 更新私有自动操作偏好 |
| `POST` | `/api/rooms/:code/appearance` | 是，房间成员 | 选择角色牌背/头像 |
| `POST` | `/api/rooms/:code/emotes` | 是，房间成员 | 发送角色或通用表情 |
| `POST` | `/api/rooms/:code/interactions` | 是，房间成员 | 向其他玩家发送泼水或番茄互动 |

开发模式还提供 `GET /dev`、`GET /dev/lib/*`、`GET /dev/styles/interactions.wxss`、`GET /assets/tiles/*.png`；这些开发用静态资源在生产模式不可访问。角色图集 `GET /assets/characters/{role}-sheet.webp` 在两种模式下均可公开访问，供原生客户端作为图片来源加载。

## 登录与资料

### `POST /api/login/wechat`

请求体：

```json
{ "code": "wx.login 返回的临时 code", "name": "可选昵称" }
```

服务端使用 `WECHAT_APP_ID`、`WECHAT_APP_SECRET` 调用微信 `jscode2session`，按 OpenID 查找或创建用户。生产模式缺少微信配置时返回 `503`。首次登录时 `name` 可省略，默认昵称为“牌友”；已有用户再次登录时，只有显式传入 `name` 才会更新昵称。

### `POST /api/login/dev`

请求体：`{"name":"可选昵称"}`。仅在 `npm run dev` 且请求来自 loopback 时可用；每次调用生成不同的开发身份。该接口不能用于部署环境。

两个登录接口都返回：

```json
{
  "token": "不透明 bearer token",
  "user": { "id": "uuid", "name": "昵称", "historyMatchLimit": 1000 }
}
```

客户端应保存 `token`，并在后续请求中发送 `Authorization: Bearer <token>`。开发页把令牌保存在标签页 `sessionStorage`，原生客户端保存在微信本地存储。

### `GET /api/me`

返回当前用户资料和用户所在房间摘要：

```json
{
  "user": { "id": "uuid", "name": "昵称", "historyMatchLimit": 1000 },
  "rooms": [{ "code": "ABCD1234", "testMode": false, "active": true }]
}
```

### `POST`/`PATCH /api/me`

请求体字段均可选：

```json
{ "name": "新昵称", "historyMatchLimit": 500, "confirmPrune": false }
```

降低牌谱上限时会先删除超额历史；若会删除记录且没有 `confirmPrune: true`，返回 `409`。`name` 为 1–32 个可显示字符，`historyMatchLimit` 为正整数。成功时返回 `{"user":{...}}`。

### `POST /api/logout`

删除当前令牌，返回 `{"ok":true}`。再次使用已删除的令牌请求会得到 `401`；客户端应同时清理本地令牌和用户缓存。

## 房间

### `POST /api/rooms`

请求体：

```json
{ "handsPerMatch": 8, "testMode": false }
```

`handsPerMatch` defaults to 8 and must be a positive integer. The owner can change it before starting. `testMode: true` creates a private single-player room with three ready server robots. The match starts only when the human selects Ready; changing settings or refreshing the room does not start it. Other humans cannot join. Returns `201` and the room view.

### `POST /api/rooms/:code/join`

请求体中的 `seat` 可选，缺省时自动选择第一个空位。每个用户在同时刻只能参与一场进行中的对局。已在该房间且对局进行中的用户会直接拿回自己的视图。加入成功返回房间视图。

### `GET /api/rooms/:code`

返回当前玩家可见的房间视图。视图中的关键字段：

| 字段 | 说明 |
| --- | --- |
| `code`、`ownerId`、`seat`、`revision` | 房间号、房主、当前玩家座位和单调递增 revision |
| `ready`、`settings`、`matchId`、`testMode` | 准备状态、房间设置、当前对局与测试模式 |
| `controls` | 当前玩家私有的 `autoWin`、`skipCalls`、`autoCut` 偏好 |
| `characters`、`emotes` | 四个座位的角色与当前未过期表情 |
| `interactions`、`interactionRemaining` | 未过期互动效果和当前玩家本局剩余次数 |
| `callNotices` | Unexpired public Pon/Kong/win announcements with unique `id`, `seat`, `kind`, `label`, and `expiresAt`; includes robot and automatic actions. Pass produces no announcement. |
| `seats` | 四个座位的玩家、机器人/在线状态 |
| `match` | 当前对局摘要、比分、连续胜利和公开牌局 |
| `match.hand` | 只包含当前玩家可见信息的牌局状态 |

`match.hand.players[i].hand` 对未结束牌局中的其他玩家只显示 `null` 占位；对手手牌、牌墙顺序和种子不会出现在实时视图中。牌局结束后，公开视图才包含完整牌山和种子。`match.hand.actions` 是服务端根据当前阶段、轮到谁和调用者座位计算出的合法动作；开启“鸣”后，会过滤掉碰/杠类动作。

长轮询：

```http
GET /api/rooms/ABCD1234?after=<客户端最新 revision>
Authorization: Bearer <token>
```

当 `after` 等于服务端当前 revision 时，请求最多等待 15 秒；房间有变化时立即返回最新视图。`after` 缺失、不是整数或与当前 revision 不同时立即返回当前视图。服务端最多保留 100 个等待中的长轮询。客户端每次收到响应后更新 revision 再发起下一次请求。

Cloud-function polling uses `action: "view"` with `{ code, after? }` instead of HTTP long polling. The function validates membership before returning `{ code, revision, unchanged: true }` for an equal revision. Changed revisions and reads without `after` return the full private room view. The client requests a full view after any polling error so a successful same-revision response can clear the error. Invalid cloud `after` values return `400`.

### `POST /api/rooms/:code/commands`

这是房间流程和游戏动作的统一命令入口。请求体公共字段：

```json
{
  "id": "客户端唯一命令 id",
  "kind": "room 或 game command",
  "expectedRevision": 12,
  "matchId": "有对局时必填",
  "handNo": 1
}
```

`expectedRevision` 必须与客户端看到的 `revision` 一致，以下两种情况例外：

- `ack`：同一 `commit` 阶段内四个客户端可能同时确认，因此只校验 `matchId`、`handNo` 和牌山校验码，不要求等于最新 revision。
- 并发 `ready`：如果请求带当前 `matchId` 和 `handsPerMatch`，可用不晚于服务端当前 revision 的 `expectedRevision` 提交，服务端还会校验对局与设置未变化。

房间命令：

| `kind` | 额外字段 | 说明 |
| --- | --- | --- |
| `sit` | `seat` | 坐到空位；未开局时可用 |
| `addBot` | `seat` | Owner adds a ready bot to an empty seat in an ordinary room; unavailable during an active match |
| `removeBot` | `seat` | Owner removes a bot before the next match; human seats and private test-room bots cannot be removed |
| `leave` | 无 | 离开房间；测试房会清空座位并丢弃未完成测试对局 |
| `ready` | `ready` | 更新准备状态；四人入座并全部准备后自动开始 |
| `settings` | `handsPerMatch` | 房主在未开局时修改每场局数，修改后所有人取消准备 |

Ordinary rooms support one to three human players with bots filling the other seats. Bots automatically acknowledge, play, continue, and prepare for rematches using the existing single-player policy: Kong before Pon, legal wildcard floating, otherwise a random legal discard, with no self-draw win declaration. Adding the final bot starts the match if all humans have already readied. Bot management uses the same revision checks and command receipts as other room commands. Ownership passes to another human on departure, and the last human leaving clears all bots. Only humans receive replay-history entries for completed mixed matches.

对局命令（均为 `POST` 到同一 commands 路径）：

| `kind` | 额外字段 | 说明 |
| --- | --- | --- |
| `ack` | `code` | 确认牌山校验码；四个确认都到达后才发牌 |
| `discard` | `tile` | 打出一张实际手牌，进入响应窗口 |
| `float` | `tile` | 飘出一张摸到的癞子并补牌/结算 |
| `pon` | `type` | 碰；`type` 为牌型 0–26 |
| `exposedKong` | `type` | 明杠；必须先有对应响应窗口 |
| `concealedKong` | `type` | 暗杠；手中四张同型且牌墙有牌 |
| `addedKong` | `type` | 加杠；已有同型碰且牌墙有牌 |
| `win` | 无 | 在自己可胡的回合确认胡牌 |
| `pass` | 无 | 放弃当前响应窗口中的碰/杠机会 |
| `continue` | 无 | 本局结束后确认进入下一局；四人确认后发新局 |

成功时返回最新玩家视图。`leave` 成功时返回 `{"left":true,"code":"ABCD1234"}`。出错时返回统一错误 JSON，客户端通常应重新拉取房间视图后重试。

### 自动操作偏好

`POST` 或 `PATCH /api/rooms/:code/controls`：

```json
{ "autoWin": true, "skipCalls": false, "autoCut": true, "matchId": "current-match-id", "handNo": 1 }
```

Provide at least one Boolean control preference. Settings are private and persist through reconnection within the hand. Every win or draw resets all three controls for all players; continuation and rematch also start with them off. Current clients include `matchId` and `handNo`; a stale scope or a finished hand returns `409` before changing preferences. Legacy unscoped callers remain accepted. `skipCalls` still passes eligible responses before broadcasting, and automatic actions use the same rules and idempotent commands as manual actions.

### 角色与表情

`POST /api/rooms/:code/appearance`：

```json
{ "character": "ironclad" }
```

`character` 必须是 `ironclad`、`silent`、`defect` 或 `watcher`。

`POST /api/rooms/:code/emotes`：

```json
{ "id": "唯一操作 id", "emote": "joy" }
```

角色表情为 `greet`、`joy`、`smug`、`shock`、`cry`；通用表情为 `common_laugh`、`common_like`、`common_think`、`common_cry`、`common_shock`、`common_pray`、`common_clap`、`common_cool`。两类表情共用 3 秒展示时间和每玩家 3 秒发送间隔。成功发送返回房间视图，效果通过 `emotes` 广播。

### 泼水与番茄

`POST /api/rooms/:code/interactions`：

```json
{
  "id": "唯一操作 id",
  "effect": "water",
  "target": 2,
  "matchId": "当前对局 id",
  "handNo": 1
}
```

`effect` 为 `water` 或 `tomato`，`target` 必须是另一个已入座玩家。只有在牌局发牌后、且 `matchId`/`handNo` 为当前牌局时才能使用；每次效果广播 3 秒。两种道具共享每人每局 50 次额度，额度通过 `interactionRemaining` 返回，刷新、重连、下一局和再来一局按服务端状态恢复/重置。旧牌局请求会返回 `409`，用完额度返回 `429`。

## 牌谱与验证

### `GET /api/history`

返回当前用户保留的已完成对局摘要，包括 `id`、`testMode`、`startedAt`、`endedAt`、`seats`、`hands`、`handsPerMatch`、`scores` 和 `status`。默认每个用户保留 1000 场；实际保留数由用户资料里的 `historyMatchLimit` 决定。

### `GET /api/matches/:id`

导出有权限访问的牌谱。活动对局中只能导出已结束的小局；比赛结束后仍要求该对局在用户的保留范围内。响应包含对局元数据、已结束小局、命令、事件、支付和最终分数，并删除 `roomCode`，避免泄露房间入口。实时玩家视图中的隐藏信息不会提前出现在该响应中。

牌谱验证完全在客户端本地进行。导出文件本身不证明发牌前曾见过牌山码；只有客户端在对局开始前留存、并与牌谱中的 `wallCode` 一致的本地证据，才能支持“事先承诺”检查。洗牌、校验码和回放格式的细节见 [GOAL.md](../GOAL.md) 和 [fixtures/shuffle-v1-friends-v3.json](fixtures/shuffle-v1-friends-v3.json)。

## 对局状态流

1. 玩家创建/加入房间，四人入座并 `ready`。第四个准备命令自动创建对局，进入 `commit` 阶段。
2. 客户端保存并在本地记录当前 `wallCode`，随后发送 `ack`。服务端收到四人的确认后发牌，进入庄家的 `own` 阶段。
3. 玩家提交自己的 `discard`/`float`/`concealedKong`/`addedKong`/`win`；弃牌后服务端只向真正有碰杠机会的玩家广播响应窗口，无机会的玩家自动过牌。
4. 响应阶段提交 `pon`/`exposedKong`/`pass`；所有响应完成后继续摸牌或处理叫牌结果。
5. 牌局以自摸或流局结束。四人提交 `continue` 后开始下一局；达到 `handsPerMatch` 后对局完成。完成后四人再次 `ready` 会创建比分清零的新对局，并保留旧牌谱。

## 客户端实现位置

- 原生请求、登录、长轮询和导入导出：[miniprogram/lib/api.js](../miniprogram/lib/api.js)
- revision 保护和中文错误：[miniprogram/lib/room-state.js](../miniprogram/lib/room-state.js)
- 房间/动作权威逻辑：[server/service.js](../server/service.js)
- 路由、鉴权、限流与静态资源：[server/http.js](../server/http.js)
- 规则、状态机与公开视图裁剪：[miniprogram/lib/engine.js](../miniprogram/lib/engine.js)
- 浏览器四标签页联调页：[tools/dev.html](../tools/dev.html)
