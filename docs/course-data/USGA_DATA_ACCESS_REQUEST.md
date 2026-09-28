# USGA / NCRDB data access request

**Status:** draft for internal review — **not sent**
**Prepared:** 2026-09-28
**Proposed recipient:** USGA Course Rating (`crdbquestions@usga.org`)
**Subject:** Authorized commercial access to Course Rating Database data for The Backyard

## Request

Hello USGA Course Rating team,

The Backyard is a commercial golf application being developed initially for golfers and courses in Mexico, with international coverage planned later. We are building an internal, provider-agnostic course master that lets a golfer search for a course, select a layout and tee, calculate Course Handicap from authorized rating data, and preserve an accurate snapshot for the round.

We would like to obtain **express authorization and the appropriate commercial license** to use Course Rating and Slope Database data in The Backyard. Please advise whether USGA offers an API, partner feed, bulk export, licensed data delivery, or another approved integration mechanism. We will not scrape NCRDB or use golfer GHIN credentials to collect course data.

### Geographic and product scope

- Phase 1: Mexico.
- Later phases: United States, Canada, and other territories available under the applicable authorization.
- Commercial use inside The Backyard's authenticated web/mobile product.
- Read-only ingestion into an internal course master, with source attribution, update metadata and stable external identifiers.
- Search, course/tee selection, Course Handicap calculation, round setup and immutable historical round snapshots.
- No resale of the raw database and no public data API unless explicitly licensed.

### Requested entities

We request the authorized data contract for:

1. **Facility** — stable external ID, name, address, city, state/province/region, country, status and location when available.
2. **Course** — stable external ID, facility relationship, name, course number/code, status and season/effective dates when available.
3. **Layout** — stable external ID, course relationship, layout name/identity, hole count, par, temporary/permanent status and effective period.
4. **Tee / rating set** — stable external ID and the fields listed below.

For each tee/rating set, when available:

- official external ID;
- tee name and display name;
- gender / rating gender;
- par;
- Course Rating;
- Bogey Rating;
- Slope Rating;
- front-nine Course Rating;
- back-nine Course Rating;
- front-nine Slope Rating;
- back-nine Slope Rating;
- total length;
- units (yards/meters);
- status;
- effective date, revision date or source update timestamp.

### Additional course-detail access

Please confirm whether an authorized product or feed can also provide:

- hole-by-hole yardage by tee;
- par for each hole;
- stroke index / handicap allocation, including gender-specific allocations where applicable;
- front/back-nine identity;
- facility/course latitude and longitude;
- tee, green, hole-center or other course GPS/location information;
- temporary layouts and their validity windows.

If those elements are outside NCRDB, please identify the owner or approved licensing channel, if one exists.

## Integration and operational questions

Please clarify:

1. Which authorized delivery option is available: REST/GraphQL API, scheduled feed, bulk export, event/delta feed or another partner interface?
2. Does coverage include Mexico, and which organizations control the right to license Mexican rating data: USGA, Federación Mexicana de Golf, an Allied Golf Association, the individual clubs, or a combination?
3. Which identifiers are stable across renames, re-ratings, temporary layouts and facility ownership changes?
4. Are records versioned, and are `effective_from`, `effective_to`, revision date, inactive and deleted states available?
5. What refresh cadence, rate limits, pagination, uptime expectations and change-notification mechanisms apply?
6. May authorized records be cached persistently in The Backyard's internal course master and retained in immutable historical round snapshots?
7. May Course Rating, Slope and par be used to calculate and display Course Handicap within the application?
8. What attribution, trademark, display, audit, retention, deletion and data-correction requirements apply?
9. May normalized or derived values be stored if the original source ID and provenance are retained?
10. Are development, QA and production environments covered separately, and is a sandbox/sample dataset available?
11. What commercial terms apply: setup fees, recurring fees, per-request/per-course/per-user pricing, minimums, territorial restrictions and renewal terms?
12. Are there restrictions on sublicensing, offline use, exports, analytics or serving derived results to end users?
13. What is the escalation path for disputed ratings, duplicate facilities, missing courses and stale or conflicting data?

## Technical and security commitments

Subject to the final agreement, The Backyard can:

- keep credentials and provider tokens server-side;
- encrypt secrets and apply least-privilege access;
- enforce documented rate limits and backoff;
- import through an auditable, idempotent pipeline rather than the public NCRDB interface;
- preserve official external IDs, provenance, fetch time and verification time;
- produce a dry-run diff before database changes;
- avoid silent overwrite of manually verified or conflicting records;
- mark missing upstream records inactive instead of deleting historical data;
- segregate QA and production credentials and datasets;
- honor data-retention, correction, deletion and attribution requirements;
- provide reasonable audit evidence of access and updates without storing user GHIN passwords.

## Requested next step

Please direct us to the appropriate technical and commercial contact and provide, if available:

- API/feed/export documentation;
- schema or sample payloads;
- Mexico coverage information;
- licensing and pricing terms;
- attribution/trademark requirements;
- security or vendor-review requirements;
- a sandbox or evaluation agreement.

Thank you. We will not begin automated collection from NCRDB unless and until the appropriate authorization is in place.

## Internal evidence and decision gate

This request is based on the following official pages reviewed on 2026-09-28:

- [USGA National Course Rating Database](https://ncrdb.usga.org/) — public lookup surface; it exposes rating fields but does not document a public bulk/API license.
- [USGA Terms and Conditions](https://www.usga.org/terms-and-conditions.html) — public website access is limited and non-commercial; automated spidering, screen scraping and database scraping are prohibited without authorization.
- [USGA Contact Us](https://www.usga.org/content/usga/home-page/contact-us/usga-contact-us.html) — identifies `crdbquestions@usga.org` as the Course Rating contact.
- [Federación Mexicana de Golf: Calificación de campos](https://fmg.org.mx/index.php/es/clubes-y-campos/Calificaci%C3%B3n%20de%20campos) — FMG describes its official rating process, USGA/The R&A alignment and publication for GHIN.

**Gate:** `LEGAL_REVIEW_REQUIRED` and `BLOCKED_EXTERNAL` until USGA/FMG confirms the license, delivery mechanism, territorial authority and permitted storage/use. This draft is not authorization and has not been sent.
