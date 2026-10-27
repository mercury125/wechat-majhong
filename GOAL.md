# Goal

## 目标

我们想要开发一个微信麻将小程序, 用于我和朋友一起游玩, 不用考虑过大的负载.

## 要求

实现以下朋友局麻将规则, 使用 108 张牌, 只能自摸, 不允许吃, 允许碰杠, 胡牌结构为四副面子加一对雀头, 支持朝天, 癞子和飘癞子.

### 1. 人数, 用牌与术语

- 每桌 4 人, 按逆时针方向轮流行动.
- 使用 108 张麻将牌: 万, 条, 饼三种花色, 每种花色为 1 至 9, 每种牌各 4 张; 不使用风牌, 箭牌和花牌.
- 顺子为同一花色的三个连续数字, 例如 3, 4, 5 饼; 刻子为三张相同的牌; 杠为四张相同的牌. 一个杠在胡牌结构中按一副面子计算.
- 雀头为两张相同的牌. 手牌指玩家尚未亮出的牌; 已碰, 杠的牌称为副露, 也计入胡牌结构.
- 牌墙指尚未摸取的牌; 正常摸牌从牌墙头部取, 补牌从牌墙尾部取.
- 自摸胡指通过自己摸牌完成胡牌. 计分时区分"黑摸"和"带癞自摸", 黑摸满足"夹黑"条件时额外翻倍, 定义与支付规则见第 8 节.

### 2. 开局, 庄家与发牌

- 每局洗牌后, 翻开牌墙最后一张牌作为指示牌, 称为"朝天". 朝天公开展示, 本局不参与发牌, 摸牌, 碰杠或胡牌.
- 癞子由朝天的牌面确定: 保持花色不变, 数字加 1, 9 后回到 1. 例如朝天为 4 饼, 则全部 4 张 5 饼都是癞子; 朝天为 9 饼, 则全部 4 张 1 饼都是癞子. 这里的"下一张"指数字顺序, 不是朝天旁边那张实体牌.
- 首局随机选庄家; 以后由上一局胡牌者坐庄, 流局时原庄家继续坐庄, 无连庄加分.
- 庄家起手 14 张, 其他玩家各 13 张, 由庄家先出牌. 发牌张数与"四副面子加一对雀头"的胡牌结构保持一致.
- 庄家起手满足胡牌条件时可直接胡牌, 按自摸结算.

### 3. 回合与出牌

- 正常轮到自己时, 从牌墙头部摸 1 张, 然后选择胡牌, 杠牌, 飘癞子或打出 1 张普通牌.
- 每次普通出牌后, 其他玩家可选择碰, 明杠或过; 不允许吃, 也不允许用别人打出的牌胡牌.
- 完成碰杠响应后才允许下一位玩家摸牌. 无人碰杠时, 由出牌者的下家行动; 有人碰杠时, 由该玩家完成本次操作和出牌, 再轮到其下家.
- 普通出牌会结束自己的回合; 杠牌或飘癞子后的补牌不会直接结束回合, 补牌后仍需继续操作, 直至胡牌或打出普通牌.

### 4. 碰与杠

- 碰: 其他玩家打出一张普通牌, 自己持有两张同牌时, 可将三张牌组成公开刻子. 碰后不额外摸牌, 直接进入自己的出牌阶段.
- 明杠: 其他玩家打出一张普通牌, 自己持有三张同牌时, 可将四张牌组成公开杠, 并从牌墙尾部补 1 张.
- 允许暗杠和补杠. 暗杠是在自己的摸牌后或出牌阶段, 将手中四张相同的普通牌组成杠; 补杠是在自己的摸牌后或出牌阶段, 将手中一张普通牌加入自己已经碰出的同牌刻子. 二者均须从牌墙尾部补 1 张.
- 癞子仅在胡牌判定时充当任意牌, 不可用于碰, 明杠, 暗杠或补杠, 也不可按其原始牌面碰杠.
- 只能自摸, 因此不允许抢杠胡; 杠后补入的牌可以用于自摸胡牌.
- 牌墙没有可补的牌时, 不允许声明杠; 已完成的碰杠不能撤回.
- 碰不单独计分; 明杠, 暗杠和补杠成功后, 按第 8 节即时结算, 然后继续本回合.

### 5. 癞子与飘癞子

- 癞子在胡牌判定时可以代替任意一种牌, 参与组成顺子, 刻子或雀头, 也可以当作其原始牌面使用.
- 胡牌时手牌中最多有 1 张癞子, 没有癞子也可以胡; 持有 2 张及以上癞子时不能胡. 癞子即使按原始牌面使用, 也计入这个数量限制.
- 轮到自己出牌时, 可以从手牌打出 1 张癞子, 称为"飘癞子", 随后立即从当前牌墙尾部补 1 张. 朝天始终不参与补牌.
- 飘出的癞子单独公开记录, 不能被任何玩家碰, 杠或胡; 每次只飘 1 张, 补牌后可以继续飘, 杠, 自摸或打出普通牌.
- 碰牌后的出牌阶段也可以飘癞子; 普通摸牌, 杠后补牌和飘癞子补牌采用相同的胡牌判定.
- 牌墙剩余 4 张及以下时, 不允许飘癞子; 剩余张数不包括朝天.
- 每次成功飘癞子并补牌后, 先将该玩家本局已飘癞子数加 1, 再按第 8 节即时结算本次飘癞子的收支, 然后判定补牌后是否胡牌或继续操作. 连续飘癞子逐次计数, 逐次结算.

### 6. 胡牌判定

- 只能自摸胡牌, 不存在点炮胡和一炮多响. 自摸包括正常摸牌, 杠后补牌和飘癞子补牌; 庄家起手胡按第 2 节处理.
- 胡牌结构必须为"一对雀头 + 四副面子". 每副面子只能是顺子, 刻子或杠; 已经碰, 杠的副露占用对应的面子数量, 不能再次用于其他组合.
- 无杠时, 胡牌的实际牌数为 14 张; 有杠时, 每个杠额外增加 1 张实际牌. 例如一副杠, 三副顺子加一对雀头共 15 张, 仍是合法结构.
- 癞子数量必须满足第 5 节最多 1 张的限制. 飘出的癞子, 弃牌和朝天都不计入自己的胡牌结构或手牌癞子数量, 但已飘癞子数参与计分.
- 不另设起胡番数, 不增加七对, 十三幺等特殊牌型. 胡牌按第 8 节区分黑摸和带癞自摸, 黑摸满足夹黑条件时额外翻 1 倍; 清一色, 天胡, 杠上开花等不额外加分.

### 7. 结束与流局

- 一名玩家自摸后立即结束本局, 按第 8 节结算胡牌收支, 包括符合条件时的夹黑加倍, 并与此前飘癞子及杠牌的收支合计为本局得分, 不继续血战.
- 摸到或补到最后一张可用牌时, 仍可正常胡牌; 未胡则完成出牌及碰牌响应. 下一次需要摸牌而牌墙已经为空时流局, 朝天不作为最后一张可用牌.
- 流局时不查听, 不罚分, 不产生胡牌收支. 保留本局已经结算的飘癞子及杠牌收支, 不因流局撤销; 因此流局时个人的本局得分仍可能非零.
- 下一局重新洗牌, 翻朝天, 重新确定癞子. 底注为 1 分, 每位玩家本局已飘癞子数归零, 上一局已结算的分数继续累计.

### 8. 底注与结算

#### 8.1. 术语与计数

- 底注记为 $b$, 每局 $b = 1$ 分. 各次支付金额由收款方和付款方各自的飘癞子次数计算.
- 玩家 $i$ 在本局已经成功飘出的癞子数记为 $n_i$, 初始为 0. 普通出牌, 碰牌和杠牌不改变这个计数, 新一局重新计数.
- 黑摸: 胡牌时没有癞子, 或唯一的癞子按原始牌面使用即可组成合法胡牌结构. 若存在这种组成方式, 按黑摸结算, 从 4 倍底注起算.
- 带癞自摸: 胡牌时恰有 1 张癞子, 且必须将其替代其他牌才能组成合法胡牌结构, 从 2 倍底注起算.
- 夹黑: 黑摸的一种. 最后摸入的胡牌张必须是本局癞子, 且在按原始牌面组成的合法胡牌拆分中, 作为同花色顺子的中间张, 补齐手中两张相差 2 的牌, 即卡张. 此时在黑摸的胡牌支付金额上额外翻 1 倍, 每次胡牌仅加倍一次.
- 下表中, $a$ 为飘癞子或杠牌的玩家, $w$ 为胡牌玩家, $i$ 为每一位实际付款玩家. 明杠时, $i$ 仅指打出被杠牌的玩家.

#### 8.2. 各项支付

胡牌时, 双方均未飘癞子的基准支付为带癞自摸 2 分, 普通黑摸 4 分, 夹黑 8 分. 收款方或付款方每多飘出 1 张癞子, 该笔支付金额翻倍. 飘癞子和杠牌采用下表各自的支付公式.

| 事件 | 付款方 | 收款方 | 每位付款方支付的金额(分) |
| --- | --- | --- | --- |
| 飘癞子 | 其余三人 | 飘癞子者 $a$ | $b \cdot 2^{n_a + n_i - 1}$ |
| 补杠 | 其余三人 | 补杠者 $a$ | $b \cdot 2^{n_a + n_i}$ |
| 暗杠 | 其余三人 | 暗杠者 $a$ | $b \cdot 2^{n_a + n_i + 1}$ |
| 明杠 | 打出被杠牌的玩家 | 明杠者 $a$ | $b \cdot 2^{n_a + n_i}$ |
| 带癞自摸 | 其余三人 | 胡牌者 $w$ | $b \cdot 2^{n_w + n_i + 1}$ |
| 黑摸(非夹黑) | 其余三人 | 胡牌者 $w$ | $b \cdot 2^{n_w + n_i + 2}$ |
| 夹黑 | 其余三人 | 胡牌者 $w$ | $b \cdot 2^{n_w + n_i + 3}$ |

- 飘癞子使用本次计数加 1 后的 $n_a$. 杠牌和胡牌使用事件发生时各玩家的计数.
- 每位付款玩家分别计算自己的支付金额, 三人的支付金额可能不同; 收款方得到这些支付金额的合计.
- 飘癞子和杠牌的结算独立于胡牌结算. 因此飘癞子或杠后补牌胡牌时, 先结算该次飘癞子或杠, 再结算胡牌.
- 夹黑的额外翻倍仅作用于本次胡牌收支, 本局飘癞子及杠牌的收支仍按各自公式结算.
- With no floats by either party, exposed and added Kongs pay 1 point per payer; concealed Kongs pay 2 points per payer. Exposed Kongs charge only the discarder; added and concealed Kongs charge all three opponents. Every transfer and each four-player score total must sum to zero.
- 碰不产生收支. 本局个人得分为所有已结算事件的收入减去支出, 并计入累计分数.

#### 8.3. 计分示例

以下取 $b = 1$ 分; "单人支付"指每一位其他玩家各自向胡牌者支付的金额.

| 胡牌者已飘癞子数 $n_w$ | 该付款玩家已飘癞子数 $n_i$ | 带癞自摸单人支付(分) | 黑摸(非夹黑)单人支付(分) | 夹黑单人支付(分) |
| --- | --- | --- | --- | --- |
| 0 | 0 | 2 | 4 | 8 |
| 1 | 0 | 4 | 8 | 16 |
| 0 | 1 | 4 | 8 | 16 |
| 1 | 1 | 8 | 16 | 32 |
| 2 | 1 | 16 | 32 | 64 |

夹黑示例: 朝天为 5 饼, 癞子为 6 饼. 胡牌前手中已有 5, 7 饼, 其余牌已组成两副面子和一对雀头; 最后摸入 6 饼, 按原始牌面组成 5, 6, 7 饼的顺子并黑摸, 判为夹黑. 若四人本局都未飘癞子, 其余三人各支付 8 分, 胡牌者本次收入合计 24 分.

本局首次飘癞子时, 飘癞子者的计数先从 0 变为 1, 其余三人的计数仍为 0, 因此其余三人各支付 1 分, 飘癞子者收入合计 3 分.

再例如 A, B, C, D 本局已飘癞子数分别为 1, 1, 0, 0:

- A 带癞自摸时, B 支付 8 分, C 和 D 各支付 4 分. 本次胡牌收支为 A +16, B -8, C -4, D -4.
- A 黑摸但不满足夹黑时, B 支付 16 分, C 和 D 各支付 8 分. 本次胡牌收支为 A +32, B -16, C -8, D -8.
- A 夹黑时, B 支付 32 分, C 和 D 各支付 16 分. 本次胡牌收支为 A +64, B -32, C -16, D -16.
- If A declares a concealed Kong, B pays 8 points and C and D pay 4 each: A +16, B -8, C -4, D -4.
- If A declares an exposed Kong on B's discard, only B pays 4 points: A +4, B -4, C 0, D 0.
- If A declares an added Kong, B pays 4 points and C and D pay 2 each: A +8, B -4, C -2, D -2.

以上各例为独立事件, 事件的收支需与本局其他已发生事件合计.

## Implementation scope and match lifecycle

The target is a WeChat Mini Program for four friends playing the rules above. Prioritize a reliable private table, readable controls, and independently verifiable replays at modest load.

- A **hand** is one deal ending in self-draw or an exhausted wall. A **match** contains a configured number of completed hands, default **8**. A **room** holds four fixed seats for the active match.
- The room owner creates a room; friends join through a room code or WeChat invitation, choose an empty seat, and mark themselves ready. The match starts automatically as soon as all four seats are occupied and all four players are ready; there is no separate owner start action. Bind each seat to its authenticated player; a room code alone does not authorize acting as another player.
- The owner may set `handsPerMatch` before starting, using a positive integer within the hand-number range defined below. Freeze the setting, seat assignments, and `rulesVersion = friends-v3` for new matches. Existing `friends-v2` matches and replays retain their 11/10 deal and three-meld win structure; `friends-v1` is no longer supported.
- A win or draw counts as one completed hand. Dealer retention does not add extra hands: an 8-hand match ends after hand 8 even if the dealer wins. Apply the existing dealer rule between hands; choose a new random first dealer for a new match.
- Match scores start at zero and accumulate every settled payment, including payments in drawn hands. Allow negative scores. Show hand deltas and match totals separately; the four-player total remains zero.
- Between hands, show the result and require all four players to continue. Reconnection restores the same seat and authoritative state, including an unresolved response window. Friend rooms have no forced move timer or bot substitution; a disconnected player can therefore pause progress until returning. Separate single-player test rooms use three robots.
- Keep the deployment simple: one authoritative backend, durable game/replay storage, and real-time client updates. Public matchmaking, rankings, chat, and elaborate distributed infrastructure are outside the first release.

### Rule implementation details

These details make the existing rules executable without changing their scoring:

- Track the current phase explicitly: dealing, own action, discard responses, or finished. A client submits an intended action; the server checks player, phase, tile ownership, wall availability, and legality before accepting it.
- A self-draw declaration requires the dealer's opening hand or the player's latest normal/replacement draw. A Pon alone does not allow an immediate win; after Pon, discard or perform a permitted Kong/float and its replacement draw. For Jiahei (夹黑), keep the identity of the last actually drawn tile; the opening deal has no such draw and does not qualify for Jiahei.
- Evaluate natural-tile decompositions before wildcard substitutions. Black self-draw (黑摸) takes precedence whenever a natural decomposition exists. Jiahei requires at least one valid natural decomposition placing that exact last-drawn wildcard tile in the middle of a same-suit sequence. Award its multiplier once, irrespective of the number of valid decompositions.
- Collect Pass/Pon/exposed-Kong responses before advancing to the next draw. Four physical copies and the ban on wildcard calls permit at most one legal claimant for any discard; reject impossible or repeated claims. A claimed discard moves into its meld and is not counted twice.
- Automatically pass any player who has no legal Pon/Exposed-Kong response to a discard, so an uncontested discard advances without three extra client round trips. Only players with a real call opportunity receive a response window.
- Check all preconditions before changing state. Commit a Kong or float, replacement draw, counter update where applicable, event log, and payment together. Failed or duplicate commands must not consume a tile or settle twice. Persist before acknowledging success; recovering after a restart must not reshuffle or repeat settlement.
- Keep scores stored as integer **half-point units**: one internal unit is 0.5 displayed points. Current rules produce even internal amounts, so every displayed Kong payment is a whole number of points. Convert the formulas above exactly, without rounding; record each payer-to-recipient transfer and verify zero sum per event, hand, and match.
- All 108 physical tiles must occupy exactly one zone: indicator, remaining wall, concealed hand, meld, unclaimed discards, or floated wildcards. Live clients receive only their own concealed faces and public information. Never include the seed, remaining wall order, or opponents' concealed faces/identities in live broadcasts.

## Shuffle algorithm and UI design

### Tenhou reference and project choices

Tenhou documents reproducible wall generation, publishes seed hashes before play, and supplies sample code and validation data. Its published sample uses MT19937 and SHA-512. These are the references for reproducibility and pre-play commitments, rather than a claim that this project implements Tenhou's format. See the [official verification overview](https://tenhou.net/stat/rand/), [shuffle sample](https://tenhou.net/stat/rand/sample_code.txt), and [validation data](https://tenhou.net/stat/rand/validation.txt).

For this 108-tile ruleset, use the project-specific algorithm **`fy-hmac-sha256-v1`** below: a fresh secret seed, a deterministic HMAC-SHA-256 byte stream, and Fisher–Yates with rejection sampling. It has no dice roll, dead wall, or Tenhou replay compatibility. The dealing and replacement rules remain those of this document.

### Tile identity, shuffle, and dealing

Define a tile **type** $t$ from 0 to 26: 1–9 wan (万) are 0–8, 1–9 sou (条) are 9–17, and 1–9 pin (饼) are 18–26. Each type has four copies $c \in \{0,1,2,3\}$, with physical ID $4t+c$. Tile images depend on type; conservation and verification use physical IDs.

Use the following byte conventions throughout: `||` concatenates bytes; `U32BE(x)` is an unsigned 4-byte big-endian integer; `U8(x)` is one unsigned byte; `UTF8(s)` encodes the exact string without normalization; and `LP(s) = U32BE(len(UTF8(s))) || UTF8(s)`. Hash and HMAC results are raw bytes until explicitly converted to lowercase hexadecimal.

1. Fix the match ID, 1-based hand number, dealer seat, and rules version. Generate an independent 32-byte seed `S` using the server platform's cryptographically secure random generator. Do not use timestamps, `Math.random()`, or a previous hand's revealed seed.
2. Initialize `W = [0, 1, ..., 107]`. Starting at counter `c = 0`, generate blocks `HMAC-SHA256(key=S, message=UTF8("wechat-mahjong/shuffle/v1\0") || U32BE(c))`, incrementing `c` for each block. Here `\0` means a single NUL byte. Read each block as eight unsigned 32-bit big-endian values in order; consume values continuously across shuffle steps.
3. For `i` from 107 down to 1, set `m = i + 1` and `L = floor(2^32 / m) * m`. Consume the next value `x`; reject it and consume another while `x >= L`. Set `j = x % m`, then swap `W[i]` and `W[j]`. This avoids modulo bias. Never sort tiles by random keys or reshuffle in response to gameplay.
4. Preserve `W` as the complete original wall. Set aside `W[107]` as Chaotian (朝天), derive the wildcard type by advancing its rank within its suit, and initialize the usable-wall pointers to `head = 0`, `tail = 106`, inclusive.
5. Seats are fixed indices 0–3 in counterclockwise order. Starting at the dealer, deal one tile at a time from the head to each seat for 13 passes; give the next head tile to the dealer. Thus the dealer has 14 tiles, the others 13, `head = 53`, and **54 playable tiles remain**. The dealer begins in the own-action phase without another draw.
6. Normal draws consume `W[head]` and increment `head`. Every Kong/float replacement consumes `W[tail]` and decrements `tail`. The remaining count is `max(0, tail - head + 1)`. Indicator and previously consumed tiles never return to the wall. For floating, check that this count is greater than 4 **before** removing the wildcard.

### Wall code: commit before dealing, reveal after the hand

The **wall code** is a commitment to the complete ordered wall and its context. Define `matchId` as a unique UTF-8 string, `handNo` as an integer from 1 to $2^{32}-1$, `dealerSeat` as 0–3, `rulesVersion` as `friends-v3`, and `shuffleVersion` as `fy-hmac-sha256-v1`.

```text
context = LP(matchId) || U32BE(handNo) || U8(dealerSeat)
          || LP(rulesVersion) || LP(shuffleVersion)
wallCode = "sha256:" + lowercase_hex(SHA256(
    UTF8("wechat-mahjong/wall/v1\0") || context || bytes(W)
))
```

`bytes(W)` is exactly 108 bytes, one physical ID per byte in original shuffled order. It is not JSON text, a sorted wall, or a list of tile faces. The visible prefix `sha256:` is not part of the hashed input.

- **Before dealing:** durably save the private seed and original wall, then broadcast the context and `wallCode`. Each client retains its observed code locally, keyed by match ID and hand number, and acknowledges it before any concealed tiles are sent. Reconnection must recover the same commitment and wall.
- **During play:** show the full code in an expandable/copyable details panel. Keep the seed and full wall private. Record which head/tail position each deal or draw consumed.
- **After every hand, including a draw:** publish the 64-character lowercase hexadecimal seed, the original 108-ID wall, context, and wall code to all four participants and the hand's replay. Disclosure happens before continuing to the next hand, not only at match end. Subsequent hands use independent seeds.
- Verification regenerates `W` from the seed, checks the permutation, recomputes its code, and compares it to the pre-deal code retained by the client. It then checks indicator selection, dealing, all draws/replacements, and tile conservation against the replay.
- A matching pre-deal commitment establishes consistency with that committed wall; it does not establish that the server never selected a favorable seed beforehand, read hidden tiles, colluded, or withheld a hand. A file containing only a self-consistent wall and hash also cannot prove when that hash was published. Keep these limits visible in verification details.

The fixed [shuffle and wall-code test vector](docs/fixtures/shuffle-v1-friends-v3.json) specifies seed, first stream block, context, complete wall, code, initial hands, and remaining-wall boundaries under the current rules version; the original friends-v2 vector is retained for compatibility checks. It is public test data and must never be used as a production seed.

### Table layout and interactions

Use the [Tenhou web client](https://tenhou.net/3/) and [official manual](https://tenhou.net/man/) as references for a compact table and replay controls. The layout below is this project's design, adapted to the local rules and touch input.

- Use Simplified Chinese for all player-facing text, including navigation, controls, tile names, game states, settlement, verification, error messages, and accessibility labels.
- Offer separate character-sticker and common-emoji categories in both clients. Show each sent emote for three seconds and enforce a shared three-second send interval across both categories. Disable another send while a request or cooldown is active, with server enforcement. Card selection, play, sorting, and refreshes must not flash the bubble or extend its original expiry.
- Clicking another seated player's avatar opens **泼水 / 丢番茄** directly for that player after dealing; retain the emote picker's interaction category as another entry. Show a bucket flying over and tipping to pour, then cover the target avatar with a square water face that blinks. Show a flying tomato, an eight-fragment burst and a lingering stain. Both three-second sequences reach all four players without replaying on ordinary table refreshes. Both items share fifty uses per player per hand, enforced and persisted on the server, with idempotent retries and a match/hand fence. Reset the quota on the next hand or rematch. Refreshing or reconnecting must not replenish uses. Interactions must preserve ordinary-emote timing, cards, scores and replay commands.
- Offer an explicit single-player test room in both clients, filling the other three seats with server robots. Robots prefer Kong, then Pon, otherwise randomly select a legally discardable physical tile from their hand, including the current draw. Honor wildcard/float restrictions and use the same random selection after Pon or the opening deal. They do not self-draw win. Automate their commitments, responses, next-hand continuation and rematch readiness. Keep the human in control of their own actions and provide an exit that discards unfinished test progress while retaining completed replays. Test rooms cannot admit other human players.
- Use WeChat identity login with user-selected nickname filling on first entry, preserving the nickname on identity restoration. Share cards from the native room or table must open that room and join after login, including cold and warm starts. The browser preview offers equivalent room invitation links.
- Keep next-hand continuation within a match. After the configured match ends, offer rematch readiness and a four-player ready count in the same room; reset the new match scores while preserving settings, seats, characters, and previous replays. Concurrent readiness must be fenced by the intended match and room settings.
- Use a landscape, top-down four-seat table with the local player at the bottom. Opponents' concealed tiles show backs; the four discard ponds closely surround a central square. All four scores face the local viewer. Melds occupy each player's right-hand area, with the called tile positioned to indicate its source; an added Kong puts the fourth tile above the original sideways tile. Floated wildcards occupy a distinct labeled area. The central square shows the current hand number / configured hand count, remaining tiles, Chaotian and the wildcard face. Preserve discard history when a tile is claimed by marking its former position, keeping it aligned with its river. This game has no riichi or sideways riichi discards.
- The center shows current actor, dealer marker, hand number/hand limit, remaining playable tiles, Chaotian, and the wildcard face. Each player panel shows name, connection status, current match score, and floated-wildcard count. Keep Chaotian and wildcard labels distinct.
- Render the local hand face-up. Keep each player's latest draw at the right end of their own hand with a visible gap, including wildcard draws and replacement draws. Opponents see only the separated back; never reveal its concealed physical ID. Sort only the existing local hand, grouping its wildcards at the left when sorting is enabled. With sorting disabled, preserve the existing hand's manual order; the current draw remains separated on the right. Mark wildcards with both a badge and an outline so natural-use black self-draw remains understandable.
- Provide four persistent toggles `理 / 和 / 鸣 / 切`, vertically on the left side of the table. `理` enables automatic sorting and starts on; with it off, the hand follows manual/draw order and can be rearranged by dragging. `和` enables automatic self-draw wins. `鸣` enables skip-calls: do not Pon/Kong, suppress self-Kong choices, and pass eligible discard responses on the server before publishing a waiting state. `切` automatically discards or legally floats the actual last draw, never an older hand tile. Automatic wins take priority when both `和` and `切` are on. These three automation toggles start off, remain usable during the current hand, and survive reconnection within that hand. Reset all three to off for all players after every win or draw and before continuation/rematch. Disable their controls while the hand is finished and reject delayed updates from an earlier hand. Keep the local sort preference independent.
- Manual discarding selects a physical tile on the first tap and sends its legal discard/float on a second tap of that same tile. Selecting another tile only changes the selection; dragging must not confirm a discard. Show legal manual win and Pon/Kong/Pass choices separately without requiring the `鸣` toggle. Lock actions during requests and retain a still-valid selection after rejection. Opening hands and post-Pon hands with no new draw remain manual; a drawn wildcard that cannot legally float also waits for manual selection.
- Record draw discards (`摸切`) and hand discards (`手切`) in the replay. Display the discarded face in the river immediately. A draw discard removes only the separated final tile. A hand discard briefly leaves an empty slot, then neighboring tiles close it within 0.28 seconds. Other viewers use a consistent cosmetic random older-hand position, excluding the draw; the discarder uses their selected physical tile. Show this distinction to all four players without flight or flip overlays. Preserve hand interactions during closure, handle batches, and avoid replaying earlier actions on repeated snapshots or initial entry. Respect reduced-motion settings. Remove cut-type text from live and replay rivers; replay descriptions belong on the timeline. Explain disabled Kong/float actions when the wall limit prevents them. There are no Chi or discard-win controls.
- Offer self-draw, Pon, Kong, float, and Pass in the relevant phases, enabling them only when legal. Place manual Pon/Kong/win/pass choices to the player's right as Mahjong Soul-inspired colored plaques with tile previews. When multiple Kongs are possible, let the player choose the tile/set.
- A live self-draw win plays a short gold celebration with the winner and classification before settlement. Play it once per live transition; repeated snapshots, emotes and reconnecting to a finished hand must not replay it. Respect reduced-motion settings.
- At every hand end, including a draw, show an enlarged settlement panel centered horizontally and vertically, with readable tile faces and scores and scrolling within the screen bounds. Reveal all four hands, melds and floated tiles with each player's signed hand delta and cumulative match total. Concealed cards remain private during play. At the configured match limit, display all four final totals separately. Allow closing and reopening settlement while keeping continuation and rematch controls available.
- Derive consecutive hand wins by the same player from the match's authoritative results. On the second and later consecutive wins, add **双连胜 / Double Kill**, **三连胜 / Triple Kill**, **四连胜 / Quadra Kill**, **五连胜 / Penta Kill**, then the numbered streak, to the live celebration. A draw, another winner or a new match breaks the streak. Retain the static streak label on settlement/reconnection; do not replay the animation or change scores.
- Show Kong/float payments immediately, with payer, recipient, counts used, and amount. The result screen separates these event payments from win payments, identifies wildcard/black/Jiahei self-draw, and shows each hand delta and match total. Indicate wins and losses with signs/text as well as color.
- Provide room, table, hand-result, match-result, replay-list, replay-viewer, and verification views. Keep room settings limited to the match length; expose history retention in replay settings.
- Respect screen safe areas and the WeChat menu area. Use at least 44 × 44 logical-pixel hit regions for action controls and selected-tile confirmation, legible tile faces, and text labels alongside status colors. Verify layout on 667 × 375 and 812 × 375 landscape viewports and on real iOS/Android WeChat devices. Portrait entry should explain how to return to the landscape table.

### Downloaded artwork

The repository includes **27 suited tile faces, a face background, and a tile back** (29 PNGs), each 600 × 800 pixels, from FluffyStuff's regular tile set, pinned to commit `26e127ba2117f45cdce5ea0225748cc0cfad3169`. The upstream project dedicates these assets under CC0. See the [upstream project](https://github.com/FluffyStuff/riichi-mahjong-tiles), [upstream license](https://github.com/FluffyStuff/riichi-mahjong-tiles/blob/26e127ba2117f45cdce5ea0225748cc0cfad3169/LICENSE.md), and local [asset guide](assets/tiles/README.md).

- Use `assets/tiles/Man1.png`–`Man9.png` for wan, `Sou1.png`–`Sou9.png` for sou, and `Pin1.png`–`Pin9.png` for pin. These transparent face overlays require `Front.png` underneath at identical bounds; `Back.png` renders hidden tiles/wall backs on its own. Render four physical copies from each face; no honor, flower, or red-five images are required.
- [manifest.json](assets/tiles/manifest.json) records immutable source URLs, byte lengths, and SHA-256 hashes; [LICENSE.upstream.md](assets/tiles/LICENSE.upstream.md) preserves the downloaded license. Bundle these images locally, rather than hotlinking at runtime. Optimize sizes during the eventual client build while retaining these originals.
- Build the table background, dealer/current-player markers, wildcard badges, and action controls with native drawing and text. This needs no extra artwork download. Tenhou is a design reference; the shipped assets come from the separately licensed tile set.

## Replay storage and verification

### Retention and access

- Save every hand and accepted action durably, including drawn hands, and finalize the match record after the configured number of hands. Do not wait for a client to remain connected to save results.
- Default `historyMatchLimit` to **1000 matches per player**, not 1000 hands. Make it a positive-integer replay setting; show the current value and obtain confirmation before applying a reduction that removes history. With the default match length this retains up to 8000 completed hands per player.
- Count completed matches and prune each player's oldest match references first, ordered by completion time and match ID. Never prune an active match. Shared replay data may be removed only when no participant's retained history still references it; changing one player's limit must not delete another player's retained replay.
- Participants can view their completed hands, including earlier hands of an active match. An unfinished hand exposes only the player's live permitted view. Restrict replay retrieval to its four participants; guessing a match/room ID must not grant access. JSON export is an explicit participant action, and the UI should explain that an exported completed-hand replay contains all hands and the wall.

### Required replay contents

Use UTF-8 JSON with `schemaVersion = 1`. Do not depend on a transient UI snapshot or on Tenhou's log format. Store enough to reproduce all states and payments deterministically:

| Record | Required contents |
| --- | --- |
| Match | `schemaVersion`, match ID, start/end timestamps, four seats and display-name snapshots, settings/rules snapshot, rules/shuffle versions, hand limit, completion status, and final match scores |
| Hand | 1-based hand number, dealer, initial score snapshot, observed commitment context/code, commitment publication and acknowledgement records, disclosed seed and original wall after completion, Chaotian/wildcard types, result, and hand deltas |
| Action | Monotonic sequence number, unique action ID, server timestamp, actor/phase, action kind, physical tile IDs, consumed wall position and head/tail source where applicable, referenced discard/meld, and resulting phase |
| Payment | Triggering event ID, payer, recipient, relevant float counts after any increment, base/multiplier, exact amount in half-points, and resulting scores |
| Result | Winner and win classification or draw, final concealed hands/melds/discards/floated tiles, unused wall boundaries, hand scores, and cumulative match scores |

Log dealing, normal/replacement draws, ordinary discards, Pass decisions, each Kong kind, Pon, floats, wins, and draws. Reject duplicate action IDs without applying them again. A timestamp alone is insufficient to order actions. Freeze completed-hand contents; corrections need an explicitly distinguishable replacement record rather than silently changing an existing replay.

### Viewer and wall-code calculator

- The list shows time, players, completed-hand count, match result, and the retention setting. A match opens its hand list; a hand opens a viewer with previous/next action, play/pause, hand selection, player perspective, and a completed-hand-only reveal-all toggle. Seeking must reconstruct the same state as sequential playback.
- Alongside each completed hand, provide **Verify wall** and copy/export controls. Show the originally observed code, recomputed code, seed, algorithm version, and outcome. Keep the full original wall accessible after completion, including unused tiles.
- Provide a calculator accepting pasted/imported context plus an ordered JSON array of all 108 physical tile IDs. It must recompute the wall code using the byte encoding above. With a seed supplied, also regenerate the wall and compare it. This path must work locally from the downloaded/exported data, without asking the game server for a verdict.
- Validate the schema, versions, integer ranges, seed encoding, and exactly one occurrence of every ID 0–107 before calculation. Reject missing/duplicate/out-of-range IDs, malformed metadata, unknown algorithms, and truncated logs with an actionable error. Never silently sort, repair, or reinterpret input.
- Report checks separately: wall reproduction, hash equality, availability/match of a locally retained pre-deal code, draw/deal consistency, rule legality, and settlement consistency. Identify the first failing action or field. If the original pre-deal code is unavailable, report **reproducible but pre-deal commitment unverified** even when all file-internal checks pass.
- Validate each event using its recorded rules version, reconstruct scores from the payment ledger, and compare them with stored hand/match totals. Never label an unsupported or incomplete replay as verified.

## Acceptance criteria for the playable release

These are implementation gates, not claims that the game has already been built.

1. **Rules and scores:** cover all three suits, rank-9 wildcard wraparound, ordinary/wildcard/natural-use black wins, multiple decompositions, true and false Jiahei, opening wins, meld-aware three-set-plus-pair validation, two-wildcard rejection, and forbidden Chi/discard-win/wildcard calls. Reproduce every numeric example in Section 8, including 1/1/2-point Kong bases, unequal payer counts, consecutive floats, replacement-draw wins, whole-point Kong payments, and zero-sum totals.
2. **Wall boundaries:** verify the indicator exclusion, 14/13/13/13 deal and 54 remaining tiles, head/tail consumption, all Kong kinds, float allowed at 5 remaining but rejected at 4, Kong rejected at 0, last-tile wins, final-discard Pon handling, and draw settlement preserving earlier payments. Assert 108-tile conservation after each accepted action.
3. **Reproducibility:** match the fixed vector byte for byte in both backend and client verifier, including the first HMAC block, wall code, dealing, and nonzero dealer seat. Exercise rejection sampling with a forced rejected value. Changing one wall position, seed, hand number, dealer, or version must fail the appropriate check. Include malformed/unsupported inputs and missing pre-deal evidence.
4. **Four-player flow:** four authenticated clients can create/join/ready, complete a hand and a configured match, retain the correct dealer, reconnect during own actions and discard responses, and recover a server restart without tile or payment duplication. Duplicate/stale commands and unauthorized seat actions are rejected. Inspect live traffic to confirm hidden information is absent before hand completion.
5. **Replay lifecycle:** replay every action and payment to the recorded final state, seek backward/forward consistently, export/reopen a completed replay, verify a hand before the match finishes, retain 1000 completed matches by default, and exercise adjustable limits. Test pruning with a small limit, active matches, shared records with different participant limits, and unauthorized replay access.
6. **UI and assets:** all 29 PNGs load locally and match their recorded hashes; faces map to the correct suit/rank and composite over the face background. On the specified viewport sizes and real iOS/Android devices, tiles and controls remain readable, safe areas remain clear, wildcard/Chaotian indicators cannot be confused, and legal-action/payment/result/replay flows are usable by touch.

## Delivery status

The repository now includes a native WeChat Mini Program, an authoritative SQLite-backed local browser server, an optional WeChat Cloud Development backend using cloud functions and Cloud Database, shared replay/rules modules, downloaded artwork, and a Chinese browser preview with character card backs, room emotes, avatar interactions and four-player settlement. The most recent full suite passed 133 tests and open-source WXML/WXSS compilation, plus four-tab Chromium checks of browser gameplay, cosmetics and narrow-screen layout; see the [setup guide](README.md) and [implementation evidence](docs/IMPLEMENTATION.md). Account-backed WeChat compilation/login and real iOS/Android viewport, touch, recovery, and file-sharing checks remain unverified in the [device checklist](docs/DEVICE_TESTS.md). The fairness limit is precommitted-wall consistency, and the initial no-timer room policy can wait indefinitely for a disconnected player.

The [upload and release guide](README.md#build-upload-and-publish) describes the current Mini Program package and Cloud Development backend. Public release still requires the appropriate game category, account qualifications and review. Browser/native visual parity, an account-backed upload, review and publication remain unverified.
