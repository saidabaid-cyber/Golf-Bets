# Phase 2 external and legal gates

## External dependencies

| Capability | Status | Delivered now | Required to unblock |
| --- | --- | --- | --- |
| GolfAPI | BLOCKED_EXTERNAL | `CourseCatalogProvider`, local provider, fixture-backed adapter contract, paginated UI | Licensed API access, base URL, key and provider terms review |
| GHIN official | BLOCKED_EXTERNAL | `HandicapProvider` and `ScoreExportProvider`, both fail closed | Authorized GHIN/API agreement and credentials; scraping remains prohibited |
| Push delivery | BLOCKED_EXTERNAL | Event/preferences model, `PushNotificationProvider`, flag off | Approved provider, VAPID keys, retention/security review and device QA |
| Wearable | BLOCKED_EXTERNAL | `WearableProvider`, flag off | Target platform SDK, signing credentials and device |
| Rangefinder | BLOCKED_EXTERNAL | `RangefinderProvider`, flag off | Supported vendor SDK/API and hardware |
| Phase 2 database | PENDING_CONTROLLED_DB_APPLY | Four forward-only migrations and RLS tests | Confirm isolated Preview Supabase, controlled apply and multi-user authorization test |
| Safari iPhone/PWA | PENDING_DEVICE_QA | Mobile CSS, safe-area/offline regressions and browser contracts | Physical iPhone test with GPS, camera, keyboard and installed PWA |
| Google OAuth | PENDING_INTERACTIVE_QA | Same-origin callback contract preserved | Human Google login against the final Preview redirect allowlist |

## Legal review

Status: `LEGAL_REVIEW_REQUIRED` before enabling these capabilities beyond controlled testers:

- Social graph, friend requests, recent players and group membership/activity.
- Precise or approximate geolocation, shot start/end locations and derived distances.
- Invitation tokens, Guest-to-user linking and its audit trail.
- Notification preferences and future push subscription tokens.
- Privacy-minimized product analytics and admin aggregates.
- AI Insights over golf aggregates and live-round questions.
- Equipment-linked shot history and course/tee performance history.

No substantive legal text was changed. Existing Privacy V6, Terms V2 and consent boundaries remain intact. Feature flags provide a technical kill switch; they are not a substitute for legal approval.

