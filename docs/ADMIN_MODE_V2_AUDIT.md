# Admin Mode V2: audit and isolated implementation

## Frozen runtime

- Branch serving DEV: integration/backyard-current.
- Frozen SHA: 1b53cf2e200d5ae6bd95d8f405b3dbe05004ede8.
- Deployment: dpl_CXisyFrTYx4qXgKr7dsyK7hV1X8y.
- Technical URL: https://golf-bets-kxv5aevm4-saha8.vercel.app.
- Alias: https://dev.thebackyard.com.mx. Health: 200 / ok / frozen SHA / preview.
- Remote recovery branch: freeze/dev-2026-09-30-pre-admin-v2.
- Annotated tag: freeze-dev-2026-09-30-pre-admin-v2; peeled commit equals frozen SHA.
- Work branch: feature/admin-mode-v2, created from the exact frozen SHA and a clean worktree.

## Actual sources and boundaries

| Domain | Source of truth | Player read path | Existing write path | Classification |
| --- | --- | --- | --- | --- |
| Authentication/account | Supabase Auth, profiles and account lifecycle RPCs | AccountProvider, server-auth.authenticatedRequest | Existing account APIs/RPCs | READ_ONLY in Simple Admin |
| Admin identity | admin_memberships; active role + scope | /api/admin/access | Controlled membership apply; no ordinary client write grant | SIMPLE_ADMIN for SUPER_ADMIN role assignment |
| Courses/layouts | golf_clubs, golf_courses, golf_course_tees, golf_holes, golf_tee_hole_yardages and versioned COURSE revisions | course-catalog-provider.server, player_published_catalog_v1 | admin_create_revision_v1 → prepare → transition → publish | SIMPLE_ADMIN |
| Scorecard profiles | course_scorecard_profiles, course_scorecard_profile_tees, course_scorecard_profile_holes | Normalized profile projection and round_course_snapshots | admin_create_scorecard_profile_v1, admin_transition_scorecard_profile_v1 | SIMPLE_ADMIN; preserve historical profiles |
| Temporary configurations | course_configurations and child hole/rating tables | player_course_operations_v1 | create/prepare/publish_course_configuration RPCs | SIMPLE_ADMIN for supported structured fields |
| Local rules | course_local_rule_sets, course_local_rules and LOCAL_RULE_SET revisions | player_course_operations_v1 | Versioned publication workflow | SIMPLE_ADMIN |
| Equipment | golf_club_catalog, golf_shaft_catalog, brand tables, versioned equipment revisions | equipment-catalog-provider.server and layered-catalog | Versioned publication; direct CRUD API already rejects writes | SIMPLE_ADMIN for supported catalog fields; imports ADVANCED_ADMIN_ONLY |
| Bags/player equipment | User equipment profile and selections | EquipmentProfilePanel/useEquipmentProfile | Owner APIs/RLS | READ_ONLY; no global rewrite of player selections |
| Balls | golf_ball_catalog, golf_ball_brands, BALL revisions | Layered equipment catalog, public visibility filters | Versioned publication | SIMPLE_ADMIN; fixture rows excluded |
| Ball Fit | Typed fitting engines + measured golf_ball_test_results | Existing fitting and LaunchMonitor modules | Owner fitting persistence; evidence import in Advanced | Engine ADVANCED_ADMIN_ONLY; safe player copy can be versioned |
| Bets | lib/bets/registry.ts and deterministic engines | bet-catalog, existing setup/result components | Source code for algorithms; no existing metadata CMS | Safe presentation SIMPLE_ADMIN with additive persistence; new engines NOT_READY |
| Competitions | competition_definitions, competition_rule_sets, competition_rules and revisions; separate legacy tournaments | Existing competition rules and polla APIs | Versioned COMPETITION workflow, existing tournament owner APIs | SIMPLE_ADMIN for supported competition definitions; unsupported registration/prizes NOT_READY |
| Requests | feedback_requests and admin_request_drafts | Existing admin_feedback_queue_page_v3 | Existing request draft RPC; additive audited status action needed | SIMPLE_ADMIN |
| User directory | Auth/profile operational projections | Existing search RPCs; no credentials exposed | Role-only changes through privileged audited RPC | READ_ONLY profile; SIMPLE_ADMIN role management by SUPER_ADMIN |
| Content | Rules corpus, legal files, typed app copy | Existing UI | Source code, no arbitrary CMS | Safe whitelisted copy SIMPLE_ADMIN; legal/rules source ADVANCED_ADMIN_ONLY |
| Audit | admin_audit_log | Existing privileged RLS and /api/admin/control-center audit view | private.admin_audit_v1, transactional workflow | SUPER_ADMIN READ_ONLY |
| Advanced Admin | /admin → AdminControlCenter; /api/admin/control-center, documents, imports, metrics | Existing technical UI | Existing versioned workflows | ADVANCED_ADMIN_ONLY, SUPER_ADMIN |

## Observed authorization

No permanent email allowlist is used by the audited /api/admin/access or publication routes. They verify a real Auth session, account lifecycle, and active admin_memberships. The existing GLOBAL SUPER_ADMIN is already persisted; it must be preserved, not replaced by an email bootstrap. Existing granular roles remain supported. A normal player has no active administrative grant.

The audit confirmed the requested saidabaid@gmail.com account exists in the current QA database. No membership was changed. Its assignment is pending an isolated target/controlled apply; changing the shared QA database would affect frozen DEV.

## Data and deployment isolation

Current DEV uses canonical QA project bymeopxkxapfizeeqeyb (also encoded in preview-database.ts). That project is shared by current DEV, so this branch must not apply migrations or write there. Shared parent zhqmlpljloumldaczcfp is not a write target either.

An independent Admin V2 Preview must bind a distinct Supabase project ref. Runtime guards will deny Admin V2 writes unless the configured isolated ref matches the actual database URL and differs from both protected refs. Creating a new managed database branch requires Supabase cost confirmation. Migration-created and migration-applied will be reported separately.

The feature branch can enable only its own Vercel Git Preview in vercel.json. No push to integration, alias change, promotion, merge, beta or Production deployment is authorized.

## Planned blocks

A freeze/audit; B persistent role extension and authorization; C audited role management; D visual mode/home; E courses/profile/configuration/local rules; F equipment; G balls and safe fitting administration; H betting presentation; I competition definitions; J requests/users; K immutable audit and Advanced access; L SQL persistence/permissions, regression and responsive QA.

Existing IDs, user bags, rounds, financial engines and historic snapshots remain intact. Simple Admin never accepts code, formulas, raw SQL or arbitrary JSON. Every relevant publish reuses the existing reviewed revision and hash confirmation flow.
