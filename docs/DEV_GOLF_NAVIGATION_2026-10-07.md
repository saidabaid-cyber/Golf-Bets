# DEV golf object navigation

Scope: `integration/backyard-current`, canonical QA `https://dev.thebackyard.com.mx`.
Protected starting HEAD: `5b946739913954770e5c0362bf5f170f1c9712fb`, clean worktree.

## Evidence and baseline

All eight conceptual JPG references were inspected, including the ten-screen ecosystem map. The three chronological TheGrint navigation sheets and `Backyard_current_DEV_1.jpg` supplement them. The user confirmed the videos could not be attached. `Backyard_current_DEV_2.jpg` is not present in the supplied files.

Before: root app-local screen router; social Home subviews; inline social scorecard; a limited Friends identity view; dedicated legacy historical detail; five Career subviews; premium Index/Atest details. Backend already owns social events, comments, likes, friendship requests, notifications, equipment and participant confirmation. GPS abstractions and captured shots already exist; map imagery is not available through the current historical reader.

After: a bounded browser-history object stack above the preserved module. Module and preceding object components stay mounted and hidden while deeper views are shown. URL selections do not confer data access. Back restores the previous frame's scroll, filters and loaded data. Bottom navigation retains the parent module; contextual Coach and Rules use their respective global active state.

## Route map

Existing URLs and QR `/?friend=<UUID>` remain valid. Object URLs retain `screen`, `home`, `career` and `careerDetail` context.

| Destination | Selection |
| --- | --- |
| Player | `object=player&objectId=<UUID>` |
| Round | `object=round&objectId=<reference>&objectSource=activity/history/shared` |
| Hole | round selection plus `object=hole&hole=1..18` |
| Course | round selection plus `object=course` |
| Equipment | `object=equipment&objectId=<activity UUID>&item=<real item ID>` |
| Achievement | `object=achievement&objectId=<activity UUID>&item=<actual earned label>` |
| Round leaderboard | `object=leaderboard&objectId=<activity UUID>` |
| Notification activity | `object=activity&objectId=<activity UUID>` |
| Full statistics | `object=analysis&objectId=mine` |
| Coach from statistics | `object=coach&objectId=mine&category=<category>&metric=<metric>&period=<period>` |
| Rules from an object | `object=rules&objectId=mine` |

## Component map

Reused: PrimaryHeader/BackyardWordmark, AppBottomNav/official Play, ProfileAvatarMedia, ScoreSummary, SocialRoundActivityCard and all social mutations, FriendsHub, real QR/scanner, CareerHub/IndexPanel, canonical StatsDashboard/RulesPanel/MyCoach, RoundParticipationCard and legacy historical options.

Added: GolfNavigationContext/useGolfObjectNavigation, GolfObjectViews, bounded activity reader, GolfDetailHeader/EmptyState/Skeleton, GolfPlayerProfile/EquipmentList/EventDetail, GolfRoundDetailView/HoleDetailView/CourseDetailView, PremiumScorecard/ScoreSymbol, PremiumGolfStatistics/GolfCoachMetricContext.

## Data boundaries

No schema, migration, dependency, font or GPS-provider change. The existing authenticated activity reader gains an author filter after the existing viewer RLS selection. Existing privacy/hash/source checks still run. Social hole details project only the authorized author's captured score, par, putts, FIR, GIR, penalties and permitted yardage. They omit private notes, GPS coordinates and other players' private data.

Private history uses the existing historical recap and personal participant perspective locally. Shots remain in that authorized history. Unknown facts remain absent; incomplete captures do not produce complete totals. Profiles expose only permitted identity and activity; no guessed city, HCP, mutual-friend count, achievement, percentile, proximity or location. Own index uses the existing verified GHIN/Backyard/no-index resolution. Coach context carries a category, metric and period; values are recalculated from real history rather than read from URL claims. There is no fabricated AI recommendation or drill.

## Validation

Implementation verification and DEV runtime evidence will be appended after the checks and deployment QA.
