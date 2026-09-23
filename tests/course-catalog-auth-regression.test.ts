import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = (path: string) => readFileSync(path, "utf8");

test("authenticated catalog reads use the player's JWT instead of requiring service_role", () => {
  const route = source("app/api/courses/catalog/route.ts");
  const reviewed = source("lib/review-course-catalog.server.ts");
  const provider = source("lib/course-catalog-provider.server.ts");
  assert.match(route, /getCourseCatalog\(auth\.client\)/);
  assert.match(reviewed, /loadReviewedCourseCatalog\(database\?:SupabaseClient\|null\)/);
  assert.match(reviewed, /const db=database\?\?getSupabaseAdmin\(\)/);
  assert.match(provider, /loadReviewedCourseCatalog\(database\)/);
  assert.doesNotMatch(route, /getSupabaseAdmin|service_role/i);
});

test("search and course operations propagate bearer auth and reject an invalid bearer", () => {
  const route = source("app/api/courses/search/route.ts");
  const operations = source("app/api/courses/[courseId]/operations/route.ts");
  const picker = source("app/components/round-course-picker.tsx");
  const playerOperations = source("lib/player-course-operations.ts");
  assert.match(route, /const auth = await authenticatedRequest\(request\)/);
  assert.match(route, /status: auth\.status/);
  assert.match(route, /searchCourseCards\(input, database\)/);
  assert.match(operations, /getCourseCatalog\(auth\?\.ok \? auth\.client : null\)/);
  assert.match(picker, /authorization: `Bearer \$\{accessToken\}`/);
  assert.match(playerOperations, /authorization: `Bearer \$\{accessToken\}`/);
});

test("existing additive RLS policies authorize public catalog reads for authenticated players", () => {
  const migration = source("supabase/migrations/20260906211937_golf_profile_course_architecture.sql");
  for (const table of ["golf_clubs", "golf_courses", "golf_course_tees", "golf_holes", "golf_tee_hole_yardages"]) {
    assert.match(migration, new RegExp(`create policy ${table}_authenticated_read[\\s\\S]+on public\\.${table} for select to authenticated`));
  }
  assert.doesNotMatch(migration, /disable row level security/i);
});

test("catalog failure cannot silently replace authenticated data because every player picker sends its token", () => {
  const page = source("app/page.tsx");
  const total = source("app/components/total-score-entry.tsx");
  const notice = source("app/components/course-operations-notice.tsx");
  assert.match(page, /<RoundCoursePicker[^>]+accessToken=\{identity\.accessToken\}/);
  assert.match(page, /<TotalScoreEntry[^>]+accessToken=\{identity\.accessToken\}/);
  assert.match(page, /<CourseOperationsNotice[^>]+accessToken=\{identity\.accessToken\}/);
  assert.match(total, /<RoundCoursePicker[^>]+accessToken=\{accessToken\}/);
  assert.match(notice, /authorization: `Bearer \$\{accessToken\}`/);
});
