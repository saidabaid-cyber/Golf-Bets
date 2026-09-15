# The Backyard — Visual QA Master

This file records owner-controlled visual gates. A technical test or successful build does not change an owner approval.

| Screen | Status | Owner gate | Pending visual review |
| --- | --- | --- | --- |
| HOME | VISUAL_APPROVED | **NO TOUCH WITHOUT OWNER APPROVAL** | None. Preserve the approved hero, PLAY, cards, navigation, spacing and responsive behavior byte-for-byte unless the owner explicitly reopens Home. |
| ROUND SETUP | PENDING_VISUAL_QA | Owner review required | Manual course/player/preflight flow, Foursome Match controls and animal determination controls. |
| HOLE CAPTURE | PENDING_VISUAL_QA | Owner review required | Compact capture at 390/393/402/430 widths, all animal visibility states, GPS closed/open and persistence across player/hole changes. |
| MORE | PENDING_VISUAL_QA | Owner review required | Tool hierarchy and mobile density. |
| PROFILE | PENDING_VISUAL_QA | Owner review required | Profile/account separation and settings discoverability. |
| SOCIAL | PENDING_VISUAL_QA | Owner review required | Empty state, friends and private activity/notification navigation. |
| MI BOLSA V2 | PENDING_VISUAL_QA | Owner review required | Full-page category, equipment editor, success and delete confirmation; local 390/393/430 evidence, real authenticated Preview pending. |

## Frozen Home contract

- `app/components/home-dashboard.tsx` and `app/components/home-dashboard-clean.module.css` are visually frozen at the owner-approved baseline.
- Product work outside Home must not alter Home markup, assets, styling, geometry or navigation labels.
- If a future shared change visibly regresses Home, document the regression before making a Home-specific edit and obtain owner approval.

## Verification rule

`PENDING_VISUAL_QA` means the implementation may be testable, but the owner has not accepted its visual result. Only the owner can change those rows to `VISUAL_APPROVED`.

## 2026-09-15 — Perfil / ronda / Index

HOME remains VISUAL_APPROVED / NO TOUCH. No hero, Home component, Home CSS or asset edits. Owner explicitly authorized only a conditional central JUGAR destination in the shared tab bar while a recoverable active round exists; the four-destination inactive layout remains unchanged. Profile/manual avatar, destructive dialogs and the active navigation require owner visual review. See `PROFILE_ROUND_INDEX_CLOSEOUT.md` for local browser evidence and outstanding isolated cloud/legal verification.

## 2026-09-15 — Index / course data follow-up

HOME remains VISUAL_APPROVED / NO TOUCH. Owner explicitly requested only the active-round label
`CONTINUAR / RONDA` in the existing conditional shared tab. Home hero/component/CSS/assets are
unchanged. Local 390/393/430 browser evidence covers that label and the Index help/card, not an
owner approval. See `INDEX_COURSE_CLOSEOUT.md`; Stats reset cloud remains `PENDING_CONTROLLED_DB_APPLY`.

## 2026-09-15 — Mi Bolsa / Social / logros / attest

HOME remains VISUAL_APPROVED / NO TOUCH. Home components, CSS, assets and shared navigation are unchanged.
Mi Bolsa full-page flows and real Social components were exercised locally at 390×844, 393×852 and
430×932 using clearly labelled synthetic fixtures. This is not authenticated Preview or owner approval.
Social needs isolated Supabase Preview migration/application and multiuser Auth QA before activation.
See `BAG_SOCIAL_ATTEST_CLOSEOUT.md` for the evidence boundary and exact outstanding work.
