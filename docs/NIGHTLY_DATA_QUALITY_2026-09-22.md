# Nightly catalog quality — 22 September 2026

This audit inventories existing evidence and gaps; it does not add or repair golf facts.
`PASS` means the audit and integrity checks completed, not that catalog coverage is complete.

## Reproduce

```sh
node node_modules/typescript/bin/tsc -p tsconfig.test.json
node scripts/qa-catalog-data.mjs --check
node --test .test-dist/tests/nightly-catalog-quality.test.js
```

After an authorized source change, omit `--check` to regenerate both JSON backlogs.
No command above accesses the network, credentials or database. The generator only writes
`data/qa/course-gaps.json` and `data/qa/equipment-gaps.json`. Regeneration is byte-stable;
the check accepts Windows LF/CRLF conversion but detects changed content.

Equipment uses the same normalized, deduplicated `golfClubCatalog`, `golfBallCatalog`
and `golfShaftCatalog` arrays consumed by the runtime provider. Source file SHA-256 values
are calculated from UTF-8 text normalized to LF, and the normalized catalog has a separate
content digest. Raw master/seed counts are deliberately not substituted for runtime IDs.

The course provider is database-backed. `course-audit-source.json` is a compact read-only
SELECT capture from the explicitly verified QA project `bymeopxkxapfizeeqeyb`, captured
for the nightly release. It includes active `OWNER_CATALOG_REVIEW` metadata only, not
users, credentials, scores or complete hole cards. The equivalent projection is in
`scripts/sql/nightly-course-audit-source.sql`. Project identity must be checked by the
caller before using that SQL: a literal projectRef in query output is not authentication
of the database connection. The capture's digest makes offline regeneration reproducible;
it does not claim continuous equality with a database that may subsequently change.

## Derived inventory

Courses: 153 clubs, 176 courses, 769 tees, 91 clubs with evidenced coordinates,
758 complete cards, 11 incomplete cards, 62 clubs without location evidence.
Completeness follows the current API's 18-entry rule, not an independent certification
of each hole value or physical-hole count. No municipal centroid is accepted.

All 769 tees have reported rating/slope but no enabled runtime category. Three have
supplemental category evidence; this audit preserves that distinction and does not
enable rating/slope. Source reuse remains `LEGAL_REVIEW_REQUIRED`.

| Runtime kind | Total | Active | Historical | Bag eligible | Fit eligible | Active fit eligible |
|---|---:|---:|---:|---:|---:|---:|
| Clubs/equipment | 1276 | 242 | 1034 | 1276 | 0 | 0 |
| Balls | 310 | 84 | 226 | 310 | 80 | 71 |
| Shafts | 474 | 203 | 271 | 474 | 80 | 80 |

The historical 1,531 entries are retained. All 2,060 normalized records lack image
assets with image-specific rights evidence; generic data licenses cannot clear image rights.
There are 381 shafts without weight, 358 without flex, and 84 wedges without verified lofts.
No loft, weight or OEM flex is supplied by inference.

## Unknown and unverified are different

`SPECS_UNKNOWN` identifies no values in the audited technical fields: 1,202 clubs and
228 balls. `SPECS_UNVERIFIED` identifies populated fields without dated catalog source
provenance: zero current records. This is **not** a claim that all other specifications
were independently verified: the schema has no field-level verification flag.
`SPECS_PARTIAL` inventories missing technical fields (74 clubs, 72 balls, 474 shafts);
some fields may not apply to that category and require human triage before sourcing.

Every backlog record has a stable ID, reason codes and source evidence references.
Missing values remain absent. A source URL or timestamp proving model identity alone
is never promoted into a specification value, image permission or playable rating.

## Verification

Eleven deterministic tests cover canonical counts/IDs, artifact freshness, ordering,
input immutability, duplicate/orphan rejection, source scope, image-rights separation,
unknown versus unverified specs, legacy shaft values, wedge absence, geometry evidence,
hole-derived completeness and rating-category boundaries. No skipped cases, DB writes,
new Auth users, historical edits or external integration calls are introduced.
