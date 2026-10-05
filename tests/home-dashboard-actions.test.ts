import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const home = readFileSync("app/components/home-dashboard.tsx", "utf8");
const page = readFileSync("app/page.tsx", "utf8");
test("Inicio composes the real paginated friends feed, without private local history or duplicate destinations", () => {
  assert.match(home, /data-home-version="social-home"/);
  assert.match(home, /<CloudSocialActivity[^>]*viewerId=\{identityUserId\}[^>]*accessToken=\{accessToken\}[^>]*friendsOnly/);
  assert.doesNotMatch(home, /QuickCard|onOpenStats|onOpenRules|onAiRound|insights|activeRound=|fake|fixture/i);
  assert.match(home, /Secciones de Inicio/);
  assert.match(home, /Agregar amigos/);
  assert.match(page, /onPrivacy=\{\(\) => openAccountSettings\("privacy"\)\}/);
});
test("Inicio replaces the legacy composer with the three social views", () => {
  assert.doesNotMatch(home, /¿Qué estás compartiendo hoy\?|Encuesta|styles.composer|Amigos y solicitudes|Qué comparto/);
  assert.match(home, /'feed','Feed'[\s\S]*'friends','Amigos'[\s\S]*'add-friends','Agregar amigos'/);
  assert.match(page, /onOpenRounds=\{\(\) => setTab\("history"\)\}/);
});
test("server-filtered feed retains pagination, truthful empty states, likes and comments", () => {
  const feed = readFileSync("app/components/cloud-social-activity.tsx", "utf8");
  assert.match(feed, /nextCursor/);
  assert.match(feed, /IntersectionObserver/);
  assert.doesNotMatch(feed, /Actualizar feed|Ver más actividad/);
  assert.match(feed, /Aún no hay actividad compartida/);
  assert.match(feed, /expectedHash: card.currentHash/);
  assert.match(feed, /\/api\/social\/activity/);
  assert.match(feed, /Ver en Logros/);
});
test("community feed scrolls within a shell that reserves safe-area navigation space", () => {
  assert.match(readFileSync("app/components/home-dashboard-clean.module.css", "utf8"), /overflow:visible/);
  assert.match(readFileSync("app/navigation-redesign.css", "utf8"), /padding:[^;]*112px[^;]*safe-area-inset-bottom/);
  assert.doesNotMatch(page, /tab === "more"|<MoreHub/);
});
