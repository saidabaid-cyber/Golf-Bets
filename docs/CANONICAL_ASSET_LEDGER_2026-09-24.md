# The Backyard — canonical visual asset ledger — 2026-09-24

## Cross-branch result

The audit enumerated image paths and Git blob IDs with `git ls-tree -r` for all 28 remote branch refs, then compared each `(path, blob)` against cross-branch audit anchor `108a8642c856a2034f98c9680e57717948f50019`. Results:

- Canonical visual blobs: **22**.
- Historical branch-only image paths or alternate image blobs absent from canonical: **0**.
- Visual blobs under `public/`: **13**; app icon: **1**; retained QA screenshots: **8** (total **22**). The runtime auditor separately counts `public/manifest.webmanifest`, so its public-asset total is **14**.
- No branch contains licensed club, ball or shaft product photography. The catalog intentionally renders a provenance-safe fallback rather than scraping or inventing media.

This Git-object comparison proves cross-branch recovery. `pnpm run audit:assets` is a separate working-tree/runtime check for broken references, active Vercel URLs and unexplained public orphans.

The latest working-tree audit scanned **722** text/config/source files, including eligible root files as well as `.github`, `app`, `data`, `docs`, `lib`, `scripts` and `public`. It found **14** public assets and **30** local references, with 0 missing references, 0 active Vercel URLs and 0 unexplained public orphans. The increase from 721 is exactly the new bundle-security scanner `scripts/lib/qa-client-bundle-security.mjs`. Three isolated auditor fixtures exercise relative Markdown/script references, root-level references and missing-target failure behavior.

## Canonical Git objects

| Blob | Path | Role |
|---|---|---|
| `1674c0f24f3288acc5b287fb294125cb3eb95f29` | `app/apple-icon.png` | App icon |
| `c058223170d82d7353748ab2d83ab4ee22943538` | `docs/evidence/beta-2026-09-17/ai-fallback-390.png` | Historical QA evidence |
| `01d747fa32916281b05c5be2125f46de6a5036bd` | `docs/evidence/beta-2026-09-17/ai-fallback-430.png` | Historical QA evidence |
| `35c1cccca823eaaa2a9199d8b7a352768b01377b` | `docs/evidence/beta-2026-09-17/ai-fallback-review-full.png` | Historical QA evidence |
| `a616706f5177c931079afb0b2641d27b2a252bb6` | `docs/evidence/beta-2026-09-17/delete-complete-390.png` | Historical QA evidence |
| `ac421325d253d39accdb74d418ce87c7517a2893` | `docs/evidence/beta-2026-09-17/delete-confirm-390.png` | Historical QA evidence |
| `184af613a32c5756e032a161007898e590bee384` | `docs/evidence/beta-2026-09-17/equipment-430.png` | Historical QA evidence |
| `9d47bcb30a640fbc24cf6d0ccbf4f87a14980a84` | `docs/evidence/beta-2026-09-17/qr-390.png` | Historical QA evidence |
| `78ab79098de90cd3b119b1a14f59725419a07bf4` | `docs/evidence/beta-2026-09-17/reset-390.png` | Historical QA evidence |
| `230ba1dabe6854c44aee10736fed595672ad6517` | `public/avatars/flag-sunset.svg` | Persisted legacy avatar |
| `36d3159e08b51e5d53658ef1af89dbea56566293` | `public/avatars/golf-ball.svg` | Persisted legacy avatar |
| `0ffa330345e88885d2250fab2a64154dbbcd0d6a` | `public/avatars/golfer-green.svg` | Persisted legacy avatar |
| `516d9d6f1595849d215a39df68efd10fcd818f96` | `public/brand/backyard-fairway-scene.svg` | Preserved historical artwork, intentionally not imported |
| `13bb4987acbcedbe80c6d448ff1fb9d82c68dc10` | `public/brand/home-golf-ball.jpg` | Home artwork |
| `b51d98f2430cf471a81e4669f720fa285d031aa5` | `public/brand/home-hero-sunrise.jpg` | Home hero artwork |
| `3c4b5a1b198787dd8a1c897ffeae91c2f7ef09a6` | `public/brand/home-swing.jpg` | Home artwork |
| `1d3b315c19baeaeee06c77a42bc3e091a1e22f7d` | `public/brand/the-backyard-logo.png` | Brand logo |
| `361bd03a08cbbd18d6034ab35b9299c127d58704` | `public/brand/the-backyard-logo.svg` | Brand logo |
| `b1ce5e4d1ecea4b4a8226ffe141675d871ee626b` | `public/icons/icon-192.png` | PWA icon |
| `dbfb330618cccaa12b1a25228e313a61fd61546e` | `public/icons/icon-512.png` | PWA icon |
| `372a43c3c427816dfe1aaedfb51ee0ab74f5e731` | `public/icons/maskable-192.png` | PWA maskable icon |
| `fc20a1caacd2b03bec06be766a43622f73b26d19` | `public/icons/maskable-512.png` | PWA maskable icon |

## Deletion decision

No image was deleted during consolidation. The four public files without an active import remain because three are accepted persisted avatar values and one is intentional historical brand artwork. Historical screenshots remain evidence, not runtime product media.
