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

## Frozen Home contract

- `app/components/home-dashboard.tsx` and `app/components/home-dashboard-clean.module.css` are visually frozen at the owner-approved baseline.
- Product work outside Home must not alter Home markup, assets, styling, geometry or navigation labels.
- If a future shared change visibly regresses Home, document the regression before making a Home-specific edit and obtain owner approval.

## Verification rule

`PENDING_VISUAL_QA` means the implementation may be testable, but the owner has not accepted its visual result. Only the owner can change those rows to `VISUAL_APPROVED`.
