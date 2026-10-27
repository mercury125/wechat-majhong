# Tile artwork

These files supply the 27 suited faces, face background, and back needed by the 108-tile rules in [GOAL.md](../../GOAL.md). The four physical copies of a tile share one face image.

Source: [FluffyStuff/riichi-mahjong-tiles](https://github.com/FluffyStuff/riichi-mahjong-tiles), `Export/Regular`, commit [`26e127ba2117f45cdce5ea0225748cc0cfad3169`](https://github.com/FluffyStuff/riichi-mahjong-tiles/tree/26e127ba2117f45cdce5ea0225748cc0cfad3169/Export/Regular). The upstream author dedicates the artwork under [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/); the original license is preserved in [LICENSE.upstream.md](LICENSE.upstream.md).

| Files | Faces | Tile type IDs |
| --- | --- | --- |
| `Man1.png`–`Man9.png` | 1–9 wan (万) | 0–8 |
| `Sou1.png`–`Sou9.png` | 1–9 sou (条) | 9–17 |
| `Pin1.png`–`Pin9.png` | 1–9 pin (饼) | 18–26 |
| `Front.png` | Base underneath each transparent face | No face/type |
| `Back.png` | Hidden tile / wall back | No face/type |

All 29 root PNGs are unmodified upstream exports at 600 × 800 pixels. The 27 faces are transparent overlays: draw `Front.png` first, then a face at the same bounds. Use `Back.png` without a face overlay. No honors, flowers, or red fives are included. The original PNGs total about 1.55 MB.

The checked-in [miniprogram/](miniprogram/) copies are 240 × 320 indexed PNGs, normally using up to 128 colors. `Sou6.png` uses 256 colors to retain a fully transparent background. Together they total 181,586 bytes. `npm run build` verifies the original hashes and copies these smaller files into `miniprogram/assets/tiles/` without changing image URLs. Builds require only Node.js. The original artwork remains available to the browser client.

To regenerate one display copy with ImageMagick 6:

```bash
convert assets/tiles/Man1.png -resize 240x320 -strip -colors 128 -define png:compression-level=9 assets/tiles/miniprogram/Man1.png
convert assets/tiles/Sou6.png -resize 240x320 -strip -colors 256 -define png:compression-level=9 assets/tiles/miniprogram/Sou6.png
```

[manifest.json](manifest.json) lists the immutable download URL, byte length, and SHA-256 digest of every PNG and the upstream license. No runtime request to GitHub or Tenhou is needed. The table background and UI markers described in the goal can use native drawing and text.
