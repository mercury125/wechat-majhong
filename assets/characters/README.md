# Character artwork, emotes and interactions

Four original chibi fan-art atlases were generated with the built-in `image_gen` tool on October 24, 2026. The complete prompts are in [prompts.json](prompts.json); file dimensions and SHA-256 hashes are in [manifest.json](manifest.json).

| Character | Chinese UI name | Card background | Signature pose | Display asset |
| --- | --- | --- | --- | --- |
| Ironclad | 战士 | Ember red `#8e3235` | Sword at the ready | [ironclad-sheet.webp](ironclad-sheet.webp) |
| Silent | 猎人 | Forest green `#28634b` | Twin poisoned daggers | [silent-sheet.webp](silent-sheet.webp) |
| Defect | 机器人 | Ice blue `#276889` | Lightning and frost orbs | [defect-sheet.webp](defect-sheet.webp) |
| Watcher | 观者 | Violet `#69508b` | Staff and meditation | [watcher-sheet.webp](watcher-sheet.webp) |

Each transparent atlas has three columns and two rows. Reading left to right, the six square cells contain the neutral card-back pose, greeting, joy, smug triumph, shock, and crying. Both clients use the same atlas for role avatars and emote bubbles; the browser additionally clips the cells as CSS 3D card backs. The browser applies the character's background color with HTML/CSS, while the native client uses the role color as a table accent and the existing `Back.png` for concealed tiles.

The PNG files are the untouched generated masters (1536 × 1024). The WebP files are display derivatives (1152 × 768), resized and encoded with ImageMagick at quality 86, preserving alpha. All four display atlases together are under 900 KiB. The existing CC0 tile art and its original `Back.png` are preserved. Role artwork is shared by the browser and native clients for avatars and emotes; only the browser's CSS 3D table and character-backed tile surfaces remain browser-specific.

## References and provenance

Character appearance references came from [Mega Crit's official merchandise page](https://www.megacrit.com/merch/), including the linked [Ironclad](https://youtooz.com/products/the-ironclad), [Silent](https://youtooz.com/products/the-silent), [Defect](https://theyetee.com/collections/slay-the-spire/products/defect-1), and [Watcher](https://theyetee.com/collections/slay-the-spire/products/watcher) products. The atlases are newly generated interpretations, not extracted game sprites or copies of merchandise illustrations. Slay the Spire and its character designs are credited to Mega Crit; these files do not inherit the tile set's CC0 license.

The layout takes inspiration from the four-seat table, character portraits and restrained gold/green presentation shown in [Mahjong Soul's official beginner guide](https://mahjongsoul.com/startguide/). No Mahjong Soul character art, logo or UI image is bundled.

## Room behavior

Players choose a character with `POST /api/rooms/:code/appearance`, then send one of five role stickers or one of eight common emoji with `POST /api/rooms/:code/emotes`. Only seated, authenticated players can use either endpoint, and character/emote IDs are allowlisted. Role and common emoji share a three-second bubble lifetime and a three-second per-player send interval. IDs in the most recent 4096 room receipts prevent retries from replaying stickers, including after expiry.

Avatar interactions use `POST /api/rooms/:code/interactions` with an idempotency `id`, an allowlisted `effect` (`water` or `tomato`), another seated player's `target`, and the current `matchId`/`handNo`. They are available only after dealing. The two effects share 50 uses per player per hand; exhausted quotas are returned through `interactionRemaining`, persist across reconnect and reset for the next hand or rematch. Stale requests from an earlier hand are rejected. A successful effect is broadcast through the room's `interactions` list with a three-second expiry.

The latest sticker per seat, role choices, interaction events and quotas are stored in the room's SQLite JSON and shared through the existing room subscription. These cosmetic/interaction updates never enter the match commands, scoring events or replay data. Changing seats carries the selected role; leaving clears the seat's sticker and restores its default role. Older room records without cosmetic fields receive the four default characters on read.
