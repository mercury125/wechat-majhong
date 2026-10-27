# Friends Mahjong

A native WeChat Mini Program and a small authoritative backend for four friends playing the 108-tile rules in [GOAL.md](GOAL.md). It includes self-draw wins, Pon/Kong, Chaotian, wildcards, floating, exact scoring, configurable matches, and locally verifiable replays.

All matches use `friends-v2`: 1-point exposed/added Kong payments and 2-point concealed Kong payments per payer, with the existing float multipliers. Exposed Kongs charge only the discarder; added and concealed Kongs charge all three opponents. Every Kong payment is a whole number of points.

The implementation runs locally. Native WeChat compilation, live WeChat login, and real iOS/Android usability still need validation with your account and devices; see [implementation evidence](docs/IMPLEMENTATION.md) and the [device checklist](docs/DEVICE_TESTS.md).

For account setup, cloud-function deployment, experience versions and review, follow [Use WeChat Cloud Development](#use-wechat-cloud-development) and [Build, upload and publish](#build-upload-and-publish). The checked-in client is an ordinary Mini Program project that can use either the local HTTPS backend or the optional WeChat Cloud Development backend.

## Documentation map

- [GOAL.md](GOAL.md) — playable-release requirements, rules, shuffle/wall protocol, replay contract and delivery status.
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — layer boundaries, authoritative data flow, persistence model and deliberate constraints.
- [docs/API.md](docs/API.md) — HTTP endpoints, authentication, room/game commands, long polling, idempotency and error conventions.
- [docs/CLOUD_DEVELOPMENT.md](docs/CLOUD_DEVELOPMENT.md) — WeChat Cloud Development setup with cloud functions and cloud database, requiring no public IP.
- [docs/IMPLEMENTATION.md](docs/IMPLEMENTATION.md) — implemented GOAL.md gates, automated-test evidence and known validation limits.
- [docs/DEVICE_TESTS.md](docs/DEVICE_TESTS.md) — the remaining account-backed WeChat and real-device checklist.
- [assets/characters/README.md](assets/characters/README.md) and [assets/tiles/README.md](assets/tiles/README.md) — artwork provenance, layout and licensing.

The README below is the practical setup guide. The API and architecture references describe the current contract; source and tests remain authoritative if a document drifts.

## Start locally

Requires **Node.js 22.13 or newer**, including its built-in SQLite module. The game runtime needs no npm packages. Two pinned development-only packages supply WeChat's [official open-source template/style compilers](https://github.com/wechat-miniprogram/glass-easel); the vendored SHA-256 library and tile images include licenses and source hashes.

```sh
npm ci --cache .cache/npm
npm run build
npm run check
npm run check:native
npm test
npm run dev
```

Open [the local browser preview](http://127.0.0.1:8787/dev) in four tabs. The browser and native interfaces use Simplified Chinese. Create a different identity with **创建试玩身份** in each tab, create a room with **创建房间**, and join its code in the other three with **加入房间**. All four select **准备**; once the fourth player is ready, the match starts automatically. Each client then stores and acknowledges the wall code automatically before any concealed tile is dealt. To discard manually, click a tile to select it, then click that same physical tile again; clicking a different tile only changes the selection. The four controls are toggles: **理** automatically sorts, **和** automatically wins, **鸣** skips calls (including self-Kongs), and **切** automatically discards the actual draw. Automatic wins take priority over cutting when both are on. The three play-automation toggles start off. `理` is enabled by default; with it off the hand follows draw order and can be reordered by dragging. Discards form a ring around the central square, which shows the current hand number / match hand count. Discarded faces appear in the river immediately. All four players distinguish `摸切` by the separated draw disappearing and `手切` by a brief hole in the older hand that closes; river tiles carry no cut-type text. Manual self-draw wins and legal Pon/Kong/Pass choices appear separately. Skip-calls passes on the server before an eligible waiting window is broadcast. Opening/post-Pon hands without a new draw stay manual, as do drawn wildcards that cannot legally float. The three automation preferences survive reconnection within a hand, then reset to off for every player after a win or draw and before the next hand or rematch. Late control updates from the previous hand are rejected. The browser uses the same authoritative APIs and verifier as the native client, with a responsive four-seat table.

For a single-player run, log in once and choose **单人测试** in either client. It creates a private room with three ready server-controlled robots. Adjust the match length, then select **准备** to start; refreshing or saving the settings leaves the human unready. Robots prefer a legal Kong, then Pon, then randomly select one of the legally discardable physical tiles in their hand, including the current draw. A drawn wildcard is floated when permitted; when floating is unavailable, they randomly discard a legal ordinary tile. Opening and post-Pon discards use the same random selection. They do not self-draw win, leaving that test to the human. Robots acknowledge the wall and prepare for the next hand or rematch automatically. **结束测试** exits at any time (under **设置** in narrow browser windows), drops an unfinished test match, and preserves completed replays. Other humans cannot join that test room. Robot users have no login sessions, and robot actions use the same rules, payments and verifiable replay commands as human actions.

Both clients offer the Slay the Spire theme's **战士 / 猎人 / 机器人 / 观者** chibi card backs in red, green, blue and violet. Choose a role in the lobby or select **换牌背** at the table; the native table now uses the same role atlases for avatar portraits and hidden-hand backs. In both clients, **表情** separates **角色表情** (你好、开心、得意、震惊、哭哭) from eight **通用表情** (笑哭、点赞、思考、大哭、惊呆、拜托、鼓掌、得意). Common expressions use the device's emoji artwork and are available to every role. Both categories share a three-second bubble lifetime and three-second send interval. A bubble stays visible until its original expiry while cards are selected or played. Sending is disabled during an outstanding request and until the previous bubble expires; the server enforces the same interval. Role choices and emotes are persisted and broadcast independently of game rules, scores and replays. The lobby collapses after joining; **大厅** reopens it. [Asset prompts, provenance and layout](assets/characters/README.md) document the generated artwork and official references. The native client includes the same emote picker, bubbles, six-face tile treatment, projected table, role portraits and safe-area insets; native WeChat rendering still requires DevTools/device validation.

Click another player's avatar to choose **泼水** or **丢番茄** for that player. **表情 → 互动道具** also offers a target selector. Water sends a bucket that tips and pours, then covers the target's avatar with a square water face that blinks. A tomato flies to the avatar, bursts into eight fragments and leaves a red stain. Each sequence lasts three seconds and reaches all four players once. The two items share **50 uses per player per hand**, available after dealing. The server persists the count through refreshes and reconnection, resets it for the next hand or rematch, and rejects stale requests from an earlier hand. Interactions preserve ordinary emotes' three-second deadline, cards, scores and replay commands.

Both tables follow the supplied `majsoul.png` layout reference. The browser uses a CSS 3D camera; the native WXML/WXSS table now applies the same projected world, standing opponent hands, face-up melds and compact discards with WXSS perspective/rotateX/preserve-3d transforms. Each tile has six actual surfaces, including an ivory top, colored back and shaded sides. Local tiles use a separate readable foreground view and lift when selected. Portraits and controls stay above the table projection. The top-left panel shows Chaotian and the wildcard. **设置** in the top-right opens role/emote shortcuts, automatic sorting, the wall commitment, payment history and control help. On narrow portrait screens the four action buttons move above the local hand; the settings panel scrolls within the viewport. **大厅** returns to the room controls.

Each player's current draw stays at the right end of that player's hand with a gap, including wildcard and replacement draws. Opponents show a separated back without revealing its physical identity; automatic and manual sorting apply to the local older hand. Melds occupy each player's right-hand corner. A called tile is sideways at the left, center or right to identify the source; an added Kong keeps the original called tile and adds the fourth tile above it. Concealed Kongs show two face-down end tiles. These follow the [standard meld-display convention](https://www.nihon-majan.org/furonosikata.html). For a hand discard, a hole remains briefly at a consistent cosmetic position among the older backs; the discarder sees the hole at their selected tile. Neighboring tiles close that hole within 0.28 seconds. Draw discards simply remove the separated draw. The river stays straight even when a tile has been claimed. Replay cut descriptions appear on the event timeline. This game has no riichi. The existing rules continue to prohibit Chi.

Confirmed **碰 / 杠 / 胡** calls appear for all four players near the acting seat, including robot and automatic calls. **过** produces no announcement. Repeated room updates do not replay a call. Manual **碰 / 杠 / 胡 / 过** choices appear above the player's right-hand area as Mahjong Soul-inspired plaques: cyan Pon, gold Kong, red win, and gray pass. Tile previews distinguish the available Pon/Kong choices. A live self-draw win plays a 1.6-second gold burst and **自摸** banner with the winner and win classification, then shows settlement. Polling, emote refreshes, and reconnecting to an already finished hand do not replay the effect. Reduced-motion settings suppress the moving rays and sparks.

The enlarged settlement panel is centered on screen, with larger tile faces and score text; excess content scrolls within the panel. Each completed hand reveals all four players' hands, melds and floated tiles alongside signed hand gains/losses and cumulative match scores. **查看牌桌** closes the panel; **本局结算** reopens it. At the configured match limit, a separate **大局结束 · 最终分数** section displays the four final totals. Consecutive hand wins by the same player within one match add **双连胜 / Double Kill**, **三连胜 / Triple Kill**, and later streak labels to a 2.2-second celebration. A draw, another winner or a new match breaks the streak. Streaks are visual only and do not change scoring.

The development server binds to loopback and permits development login only from loopback. It cannot be exposed with `MAHJONG_HOST=0.0.0.0 --dev`. Test identities are random server-issued identities, not accounts selected by name. Each tab keeps its own token in `sessionStorage`; native clients retain theirs in WeChat storage.

SQLite data lives in `data/mahjong.sqlite` and survives restarts. Stop the server before copying the database for a simple file backup; copying only the database file during WAL writes can miss committed transactions. Test-created databases stay under `test-output/` and are removed by their tests.

## Open the native client

1. Run `npm run build` to bundle the 29 tile PNGs, cloud-function shared modules and verification example.
2. Import the repository root in WeChat DevTools using [project.config.json](project.config.json). The project is configured as `compileType: "miniprogram"` and uses `miniprogramRoot: "miniprogram/"`.
3. Use your real Mini Program AppID. A Mini Game AppID cannot compile the WXML/WXSS pages used by this client.
4. For Cloud Development, set `cloudEnv` and `assetBase` in [miniprogram/config.js](miniprogram/config.js) and deploy `cloudfunctions/api` first.
5. For a loopback trial, keep `development: true`, run `npm run dev`, and point `apiBase` at the local server. Disable domain checks only for that local trial.
6. Compile and preview. Create/join/ready in the lobby; the fourth ready player starts the match.

The local `server/` is required for local HTTP mode but not for Cloud Development mode.

The client has lobby, table/results, replay, and verification pages. Reconnecting restores the authenticated seat. After automatic start, the hand enters the `commit` phase: all four clients must save and acknowledge the same wall code before any concealed tile is dealt. The table shows `正在确认牌山 x / 4` during this phase. Acknowledging is normally automatic and takes one round trip per client; all four acknowledgements may be submitted against the same room revision so they do not queue behind each other. Friend rooms do not use forced move timers or substitute robots for disconnected players; a disconnected friend can pause that table until returning.

Use **邀请好友** from the native lobby or table to share a card that opens the exact room. First-time visitors choose a nickname and log in before joining automatically; existing sessions join directly, including reconnecting to their own active seat. Invitations survive login errors and cold/warm app entry. The browser's waiting table and settings copy a `/dev?room=CODE` link with the same login-then-join behavior; loopback links work only on the machine running the preview. When a hand ends, **下一局** continues an unfinished match. When the configured match ends, **再来一局** marks readiness for a fresh match in the same room. Four ready players start it with scores reset to zero, preserving seats, roles, room settings, and the previous match's replay.

## Use WeChat Cloud Development

If you do not have a public IP, use the cloud-function backend instead of exposing `server/`:

1. Create a Cloud Development environment with a real Mini Program AppID.
2. The cloud function attempts to create the `users`, `rooms`, `matches` and `history` collections on first call; create them manually if the environment restricts collection creation.
3. Upload the four character WebP files to cloud storage and set `assetBase` in [miniprogram/config.js](miniprogram/config.js).
4. Set `cloudEnv` in [miniprogram/config.js](miniprogram/config.js).
5. Run `npm run build` so the shared rule modules are copied into `cloudfunctions/api/shared/`.
6. Deploy `cloudfunctions/api` with **upload and deploy: install dependencies in cloud**.
7. Compile, preview, upload an experience version and add testers.

The Mini Program client uses `wx.cloud.callFunction` when `cloudEnv` is set; the cloud function derives the player identity from `OPENID`. No public IP, request domain or AppSecret is needed for the backend. See [docs/CLOUD_DEVELOPMENT.md](docs/CLOUD_DEVELOPMENT.md) for collection permissions, asset setup and current limits.

## Configure a real WeChat backend

Deploy the backend separately from the WeChat client, on a host with Node.js 22.13 or newer. Preserve the repository layout: `server/` imports shared code from `miniprogram/lib/`, and production serves the role atlases from `assets/characters/`. Run commands from the repository root and keep the SQLite path on persistent storage.

Set these environment variables through your deployment environment, or copy [.env.example](.env.example) to the ignored `.env` file and fill it in locally:

| Variable | Purpose / default |
| --- | --- |
| `WECHAT_APP_ID` | Your Mini Program AppID; required outside development |
| `WECHAT_APP_SECRET` | Server-side AppSecret; never include it in the Mini Program |
| `MAHJONG_HOST` | Listening interface, default `127.0.0.1` |
| `MAHJONG_PORT` | HTTP port, default `8787` |
| `MAHJONG_DATABASE_PATH` | Persistent SQLite file, default `data/mahjong.sqlite` under the launch directory |

For the `.env` approach, start with:

```sh
node --env-file=.env server/index.js
```

With variables already set by your host, use `npm start`. Production startup requires both WeChat credentials. Login exchanges `wx.login()`'s code on the server and issues a separate expiring bearer token; neither the AppSecret nor WeChat's session key is returned to clients.

WeChat login identifies the account by the server-verified OpenID; it does not expose a personal WeChat ID. On first entry, the native login form uses `input type="nickname"` so the player can select their WeChat nickname or enter another name. See WeChat's [official nickname component documentation](https://github.com/wechat-miniprogram/mp-user-avatar/blob/master/README.md). A subsequent login without a supplied name preserves the saved nickname; an explicit selection updates it. Expired app sessions can recover through a fresh `wx.login()` exchange before entering the pending invitation. Real login and share-card launch must still be checked with the configured AppID and HTTPS backend on WeChat devices.

Native role stickers load from the configured backend's `/assets/characters/{role}-sheet.webp` URLs. Add that HTTPS host to the Mini Program's allowed image/download domains. These four fixed public artwork URLs also work outside development; development pages, source files and other files stay restricted. Common emoji need no downloaded artwork, and the role atlases are kept out of the native main package.

Terminate HTTPS in front of the loopback backend and configure that HTTPS request domain in your WeChat project. [nginx.conf.example](docs/nginx.conf.example) supplies a reverse-proxy example with timeouts suitable for the 15-second long-poll updates. This HTTP path is used by the browser preview and local Mini Program mode. The native client uses Cloud Development through `wx.cloud.callFunction` when `miniprogram/config.js` has `cloudEnv` set, so that mode does not need `apiBase`, a request domain, or the server process.

The backend is a single process with SQLite transactions. It writes the accepted command, game snapshot, payment ledger, and idempotency receipt before acknowledging a move. Room revisions reject stale game actions. Idempotent wall acknowledgements may arrive against an older revision for the same commit. Readiness also accepts concurrent older revisions when the match ID and requested room length still match, so four players can prepare together; changed settings, future revisions, and old-match readiness are rejected. Discard-response windows automatically pass players with no legal Pon/Kong. Do not run independent backend copies against separate databases for the same room.

## Build, upload and publish

This procedure covers packaging the native client, uploading an experience version, and the remaining steps toward public release. The **client package** is compiled and uploaded by WeChat DevTools from `miniprogram/`. The **backend** can be the local Node service or the `cloudfunctions/api` function backed by Cloud Database. `npm run build` prepares the tile assets, cloud-function shared modules and verification example.

Confirm the account's release category before preparing a public submission. Online Mahjong provides game services, for which WeChat specifies game-category requirements and qualifications in its [operating rules](https://developers.weixin.qq.com/miniprogram/product). This repository uses `compileType: "miniprogram"` and WXML/WXSS pages. Obtain the Mini Program AppID and complete any category/qualification requirements before public release. WeChat documents the ordinary Mini Program package in its [code-package guide](https://developers.weixin.qq.com/miniprogram/dev/guide/base-ability/code-package.html).

1. **Prepare the account and tools.** Obtain the appropriate real AppID in the [WeChat public platform](https://mp.weixin.qq.com/), add the uploading WeChat account as a project developer, and install [WeChat DevTools](https://developers.weixin.qq.com/miniprogram/dev/devtools/download.html). The checked-in `touristappid` is a local trial value.
2. **Make the backend reachable over HTTPS.** Follow [backend configuration](#configure-a-real-wechat-backend), set the matching `WECHAT_APP_ID` and server-only `WECHAT_APP_SECRET`, and start production with `node --env-file=.env server/index.js` or with injected environment variables and `npm start`. Set up a trusted HTTPS certificate and reverse proxy using [the Nginx example](docs/nginx.conf.example). Keep the service running between player sessions. Request `https://YOUR_DOMAIN/health` and confirm `{"ok":true}`. The public role atlas URLs must also load over HTTPS.
3. **Set the client release configuration.** Replace the AppID in [project.config.json](project.config.json) with a Mini Program AppID. For Cloud Development, set the environment and asset prefix in [miniprogram/config.js](miniprogram/config.js):

   ```js
   module.exports = {
     apiBase: 'http://127.0.0.1:8787',
     cloudEnv: '你的云开发环境ID',
     assetBase: 'cloud://你的云存储文件前缀',
     development: false
   };
   ```

   The client uses `wx.cloud.callFunction` when `cloudEnv` is set; no request/download domain or AppSecret is needed for the backend. The cloud environment and `cloudfunctions/api` must be deployed first. For HTTP mode, configure `apiBase` and the request/download domains.

4. **Prepare and check the client.** Run these commands from the repository root:

   ```sh
   npm ci --cache .cache/npm
   npm run build
   npm run check
   npm run check:native
   npm test
   ```

   This creates `miniprogram/assets/tiles/` and `miniprogram/lib/example.js`. Local compiler/tests are source checks; record account and device results separately in [DEVICE_TESTS.md](docs/DEVICE_TESTS.md).

5. **Import and preview.** In DevTools choose **导入项目**, select the repository root containing `project.config.json`, and use the real Mini Program AppID. The existing `miniprogramRoot: "miniprogram/"` selects the client code. Click **编译**, then **预览**, and scan with a project developer's WeChat. Test real login, invitation entry, a full hand/match, settlement, rematch and reconnection.
6. **Upload an experience version.** Click DevTools **上传**, enter a version such as `0.1.0` and a short description, then open the public platform's **版本管理 → 开发版本**. Set the uploaded version as **体验版**, add the intended testers under **成员管理 → 体验成员**, and let them scan the experience code. Uploading the client leaves backend deployment and availability under your control.
7. **Submit and publish after validation.** Resolve the game-category/runtime requirements above and complete the account's requested submission information. From version management, submit the intended version for review; after approval, publish that reviewed version. WeChat's [official release workflow](https://developers.weixin.qq.com/miniprogram/dev/framework/quickstart/release) distinguishes developer previews, experience versions, review and the online version.

| Symptom | Check |
| --- | --- |
| Upload is unavailable | Real AppID, project developer membership, and the account/project type |
| Simulator works but the phone cannot connect | HTTPS origin, legal domains, trusted certificate and the running production backend |
| WeChat login fails | `development: false`, matching client/server AppID, and server-side AppSecret configuration |
| Role portraits/stickers fail to load | The HTTPS `/assets/characters/{role}-sheet.webp` URL, certificate, and artwork-host configuration |
| Expected browser visuals differ | Inspect the WXML/WXSS client; browser screenshots do not establish native visual parity |

The repository supplies source code and local checks for this process. Account-backed upload, real WeChat login/device behavior and public review have not been completed here.

## Replays and verification

- Match length defaults to **8 hands** and is editable by the owner before starting. Wins and draws each count once, including dealer wins.
- History defaults to **1000 completed matches per player**. Replay settings can change the limit and request confirmation before pruning. One player's pruning does not remove another participant's retained replay, and active matches are preserved.
- Completed hands are available immediately, including during an active match. The viewer supports hand selection, previous/next event, play/pause, seeking, player perspective, and reveal-all. Export writes a JSON file containing all completed hands; the native client asks before sharing this concealed information.
- The verification page accepts a wall/context object, completed hand, or match JSON by paste or file import. It recalculates the wall code and seed shuffle locally and replays commands to check legal actions, draws, events, payments, and final results. It never requests a server verdict.
- A code retained on that client **before dealing** is separate evidence. Imported data without it is labeled unverified for pre-deal publication, even if the file reproduces exactly. Commitments establish wall consistency; they do not establish fair seed selection or protect against a server that reads hidden information.

The byte protocol and public fixture are in [GOAL.md](GOAL.md) and [shuffle-v1.json](docs/fixtures/shuffle-v1.json). Never use a public fixture seed for actual games. The layer boundaries, data flow and deliberate simplifications are documented in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Checks and source layout

`npm test` includes pure rules/protocol tests, prepared boundary cases, simulated full hands/matches, durable-store recovery, replay tampering, history pruning/access checks, native-controller tests, four real HTTP clients, and cosmetic validation, broadcast, expiry and asset-integrity checks. The HTTP tests need permission to open ephemeral loopback ports. `npm run check` checks JavaScript syntax, native page/config presence, and vendored hashes; the client tests check template handlers. `npm run check:native` compiles all WXML and WXSS using the pinned official glass-easel compilers. These source checks do not replace account-backed DevTools compilation or real-device checks.

| Directory | Responsibility |
| --- | --- |
| `miniprogram/lib/` | Shared pure rules/shuffle/engine/verifier, page-state helpers, presentation and native API client |
| `miniprogram/pages/` | Native lobby, table/results, replay, calculator/import views |
| `miniprogram/components/tile/` | Tile face/background composition, wildcards, selection and accessible labels |
| `server/` | Transport, application service, long polling and transactional SQLite storage |
| `test/` | Rule, protocol, recovery, replay, access, client and HTTP checks |
| `docs/ARCHITECTURE.md` | Layer boundaries, data flow and the intentionally small deployment model |
| `docs/API.md` | Authentication, endpoints, command payloads, long polling, idempotency and privacy rules |
| `assets/tiles/` | Pinned original artwork, upstream license and integrity manifest |
| `assets/characters/` | Generated character atlases, optimized transparent WebP files, prompts and provenance |
| `tools/dev.html` | Loopback-only Chinese browser table, role selection and emote picker |

Tile artwork is CC0 with provenance in [its guide](assets/tiles/README.md). Offline hashing uses the pinned MIT-licensed [js-sha256 source](miniprogram/lib/vendor/provenance.json) and [license](miniprogram/lib/vendor/LICENSE.txt).
