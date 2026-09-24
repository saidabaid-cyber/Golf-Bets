# P01 — Course flow closeout

## Version

- Branch: `phase2/admin-control-center-2026-09-22`
- Base SHA: `eff4a80caf70e4d54709cd49a195b38e193a63be`
- Recovery deployment before P01: `dpl_CJLohF922ak9qBdf1oAaZUVXHmCk`
- Final SHA: the Git commit containing this document (the exact immutable SHA is recorded in the owner report and in Vercel deployment metadata after the commit is created).
- Review alias: `https://golf-bets-git-phase2-admin-control-center-2026-09-22-saha8.vercel.app`

The remote branch was fetched immediately before integration and still matched the base SHA. No concurrent commit was overwritten.

## Root cause

The visible round flow used `CatalogCoursePicker` as its primary picker. That component loaded the course cards, rendered its own `Salida / tee inicial` select, and only after that called the page callback. The page then changed to the separate `RoundTeePicker`, producing two tee decisions. `RoundCoursePicker` was only the secondary picker inside **Mis campos guardados**, so changing it alone could not repair the main route.

Location was also resolved differently by the primary picker, saved courses, the course library, Home Club and permission settings. Some paths called geolocation directly and did not consistently enforce the app-level opt-in, the effective browser permission, five-minute cache expiry or cancellation after revocation/account exit.

## Changes

- `CatalogCoursePicker` now selects only club/course and transitions directly to the shared tee step; Home Club remains course-only.
- `RoundTeePicker` is the only tee choice in a round, includes the single existing missing-tee feedback action and blocks duplicate taps during transition.
- The main Play route no longer exposes a field picker before the user chooses one of the three existing modes.
- Full round, score-only and total-score flows now use the same course → tee boundary.
- Valid 9-hole cards remain 9-hole cards; no synthetic holes are created.
- `StartHoleSelector` describes wrapping using the actual first/last hole and the existing play-order logic preserves real hole identities.
- Onboarding quick and complete place the existing optional device-permission step before Home Club and do not repeat it later. Completed accounts remain completed.
- A shared nearby-location resolver enforces app opt-in, browser state when queryable, a five-minute maximum cache, fresh-position refresh, distinct denial/timeout/unavailable states, and cancellation of late responses after revocation, navigation or account change.

## Files modified

- `app/page.tsx`
- `app/components/beta-onboarding-flow.tsx`
- `app/components/catalog-course-picker.tsx`
- `app/components/course-library.tsx`
- `app/components/device-permission-settings.tsx`
- `app/components/profile-account-panel.tsx`
- `app/components/round-course-picker.tsx`
- `app/components/round-tee-picker.tsx`
- `app/components/start-hole-selector.tsx`
- `app/components/total-score-entry.tsx`
- `lib/beta-onboarding.ts`
- `lib/device-permissions.ts`
- `lib/round-course-selection.ts`
- Relevant tests under `tests/`

## Automated verification

- `npm test`: **PASS**, 3,343 passed, 0 failed, 0 skipped, 0 cancelled.
- `tsc --noEmit`: **PASS**.
- `npm run lint`: **PASS**.
- `npm run build`: **PASS** (Next.js production build, 34 static pages generated).
- `git diff --check`: **PASS** (only the repository's existing Windows line-ending notices).

Behavior tests execute the selection/location functions and cover:

- Primary course selection enters a single tee step without choosing a tee in the course picker.
- Incompatible tees are cleared when the course changes; compatible selections are preserved.
- A 9-hole card remains 9 holes.
- Fresh location cache reuse and expired-cache refresh.
- Location-disabled paths never call geolocation.
- Revocation/navigation cancels late geolocation responses.
- Denial and timeout remain distinct and manual search remains available.
- Quick/complete onboarding resolves the optional device decision before Home Club without a later duplicate step.

## Runtime evidence

Local browser smoke used a disposable local QA profile and the real course API, not an owner account:

1. **Jugar → Ronda sin apuestas** opened the principal course picker only after mode selection.
2. Searching and selecting **La Vista** transitioned directly to one tee screen. No course-step tee dropdown remained.
3. The tee screen displayed the published Azul, Blanca, Dorada and Roja cards; **Blancas** was selected once.
4. Selecting start hole **5** produced the real order `5, 6, …, 18, 1, 2, 3, 4`.
5. A disposable player was added, the round started on H5, a score was saved and the view advanced to H6.
6. Leaving returned Home with **Continuar ronda**; reopening restored La Vista, Blancas, the player, H6 and the same play order.
7. The score-only route displayed no betting configuration.

The fixed alias is published only after all local gates pass. Post-deployment smoke and the alias-to-SHA readback are recorded in the final owner report.

## Remaining verification

- `PENDING_DEVICE_QA`: physical iPhone permission prompt, revocation in iOS Settings, swipe behavior and installed-app lifecycle.
- `PENDING_INTERACTIVE_QA`: authenticated onboarding/Home Club walkthrough with a disposable QA account and a live multi-layout club selection in the final Preview.

## Scope confirmation

- No database migration or database write was made.
- No Production, main, beta, DNS, equipment, Bag, Social, Admin, backups, payments, betting engine or handicap formula was changed.
- No real user data or consent was used.
