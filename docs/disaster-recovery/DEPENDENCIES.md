# Dependencies and independent custody

The authoritative package versions are in pnpm-lock.yaml, not the semver ranges in package.json. Restore with Node 24 and `pnpm install --frozen-lockfile`. This audit used pnpm 11.19.0 and did not rewrite the lock.

| Dependency | Role | Failure/exit path |
|---|---|---|
| Node 24 + Next 16.3.3 + React 19.2.8 | Web runtime/rendering/API | Keep source and lock, mirror package tarballs/cache outside source if registry loss is in threat model |
| TypeScript 5.7.2 / ESLint 9.39.5 | Quality gate | Reinstall from frozen dependency set |
| @supabase/supabase-js 2.112.4 | Auth, database API, Storage | Self-host compatible Supabase; standard PG requires replacement service adapters |
| PostgreSQL 17.6 | Durable relational data | Logical encrypted archive + role/schema/data + application migrations |
| Vercel | Build/hosting/Preview | Next production server on another Node host |
| GitHub | Git hosting | Independent verified bundle/mirror; Git CLI is sufficient |
| OpenAI SDK 7.8.0 / optional Gemini | Optional AI services | Keep disabled when unavailable; deterministic app still independent of Codex/OpenAI |
| Resend | Group invite/feedback notifications | Requests remain in DB; delivery feature explicitly unavailable without credentials |
| Supabase Auth SMTP + Google / optional Apple | Email/OAuth | Recover provider registrations, URLs and secret custody separately |
| jsPDF, qrcode, jsqr, emoji-regex, pdfjs-dist | Exports, QR, text/PDF support | Frozen source packages, local tests; no invented provider |
| PGlite, canvas, Tesseract and language data | Test/asset tooling | Native/build compatibility must be checked on the recovery OS |

## Assets and licenses

Git public/data assets are in source archive. Ignored rules-source, rules-sources and brand-source originals are not. Preserve originals and licenses separately, encrypted when private. Course/equipment data reuse authorization is not established by a technical backup. Do not redistribute licensed imagery or PDFs.

No application GitHub Actions, Supabase local config, Docker deployment or automatic backup scheduler was found. This work supplies commands and policy, not an already-running paid backup service.

## Software supply-chain portability

For an owner-approved offline preparation machine: fetch the pnpm store for the locked dependencies with `pnpm fetch --frozen-lockfile`, record pnpm/Node/OS/architecture, and copy the store and appropriate Node installer to independent storage. Test a clean `pnpm install --offline --frozen-lockfile` there. A cache prepared for Windows is not proof of a Linux/native-module restore. This offline install was not performed in this task; do not mark it PASS.

Archive installers/checksums from official sources. Keep an SBOM/license inventory if redistribution is planned; do not include node_modules or registry credentials in the public Git bundle.
