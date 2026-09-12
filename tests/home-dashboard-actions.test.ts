import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync("app/components/home-dashboard.tsx", "utf8");
const bottomNav = readFileSync("lib/app-navigation.ts", "utf8");
const bottomNavComponent = readFileSync("app/components/app-bottom-nav.tsx", "utf8");
const homeStyles = readFileSync("app/components/home-dashboard-clean.module.css", "utf8");
const globalStyles = readFileSync("app/globals.css", "utf8");
const moreHub = readFileSync("app/components/more-hub.tsx", "utf8");

test("approved Home uses one ball action and offers manual or AI setup in a closable choice dialog", () => {
  assert.match(source, /data-home-version="approved-golf-home-v2"/);
  assert.match(source, /const playAction = activeRound \? onContinueRound : \(\) => setRoundChoiceOpen\(true\)/);
  assert.match(source, /aria-label=\{activeRound \? "Continuar ronda" : "Elegir cómo armar tu ronda"\}/);
  assert.match(source, /<BackyardBallAction activeRound=\{activeRound\} onClick=\{playAction\} \/>/);
  assert.match(source, /<ModalShell open=\{roundChoiceOpen\}/);
  assert.match(source, /CONFIGURAR MANUALMENTE/);
  assert.match(source, /ARMAR CON BACKYARD AI/);
  assert.match(source, /chooseRoundSetup\("manual"\)/);
  assert.match(source, /chooseRoundSetup\("ai"\)/);
  assert.doesNotMatch(source, /className=\{styles\.aiButton\}/);
  assert.match(source, /THE BACKYARD/);
  assert.match(source, /PLAY WITH IT/);
  assert.match(source, /src="\/brand\/home-hero-sunrise\.jpg"/);
  assert.match(source, /src="\/brand\/the-backyard-logo\.svg"/);
  assert.match(source, /src="\/brand\/home-swing\.jpg"/);
  assert.match(source, /src="\/brand\/home-golf-ball\.jpg"/);
  assert.match(homeStyles, /\.ballLogoFull \{[^}]*overflow: hidden/);
  assert.match(source, /data-home-logo/);
  assert.match(source, /data-home-play/);
  assert.match(homeStyles, /\.ballLogoFull \{[^}]*position: relative/);
  assert.match(homeStyles, /\.playCircle \{[^}]*left: 50%[^}]*transform: translate\(-50%, -50%\)/);
});

test("Home keeps dynamic full names in a responsive, non-overlapping headline zone", () => {
  assert.match(source, /const resolvedDisplayName = displayName\.trim\(\) \|\| "Golfista"/);
  assert.match(source, /data-name-size=\{heroNameSize\}/);
  assert.match(source, /data-home-headline/);
  assert.match(source, /<em>\{resolvedDisplayName\}<\/em>/);
  assert.match(homeStyles, /\.heroCopy\[data-name-size="long"\]/);
  assert.match(homeStyles, /\.heroCopy\[data-name-size="extended"\]/);
  assert.match(homeStyles, /white-space: normal/);
});

test("approved Home has exactly three quick actions and only two More Backyard actions", () => {
  const quickSection = source.match(/<nav className=\{styles\.quickActions\}[\s\S]*?<\/nav>/)?.[0] || "";
  const moreSection = source.match(/<section className=\{styles\.moreBackyard\}[\s\S]*?<\/section>/)?.[0] || "";
  assert.equal((quickSection.match(/<QuickCard/g) || []).length, 3);
  for (const label of ["Estadísticas", "Historial", "Reglas de golf"]) assert.match(quickSection, new RegExp(label));
  assert.doesNotMatch(quickSection, /Mi Bolsa|Perfil|Campos|JUGAR/);
  assert.equal((moreSection.match(/<button/g) || []).length, 2);
  assert.match(moreSection, /Balances/);
  assert.match(moreSection, /Grupos/);
});

test("Home uses only saved golf data for progress and preserves an elegant empty state", () => {
  assert.match(source, /insights\.scoredRounds > 0/);
  assert.match(source, /typeof insights\.averageScore === "number"/);
  assert.match(source, /Tips, insights/);
  assert.match(source, /typeof insights\.betBalance === "number"/);
  assert.doesNotMatch(source, /Tu promedio es 80|Ganaste|Mejoraste/);
});

test("active round remains inside the approved Home and routes both visible continuation controls", () => {
  assert.match(source, /<small>RONDA ACTIVA<\/small>/);
  assert.match(source, /onClick=\{onContinueRound\}/);
  assert.match(source, /CONTINUAR RONDA/);
  assert.match(source, /currentHole/);
  assert.match(source, /activeRoundLabel/);
  assert.match(source, /partialToPar/);
});

test("header actions expose Profile, notifications and Settings without Home duplicates", () => {
  assert.match(source, /aria-label="Abrir mi perfil"/);
  assert.match(source, /aria-label="Abrir notificaciones"/);
  assert.match(source, /aria-label="Abrir Configuración"/);
  assert.match(source, /ProfileAvatarMedia/);
});

test("bottom navigation is exactly Inicio, Social, Más and Perfil", () => {
  const block = bottomNav.match(/export const BOTTOM_NAV_TARGETS = \{[\s\S]*?\} as const/)?.[0] || "";
  for (const label of ["Inicio", "Social", "Más", "Perfil"]) assert.match(block, new RegExp(label));
  for (const removed of ["Jugar", "Grupos"]) assert.doesNotMatch(block, new RegExp(removed));
  assert.equal((block.match(/:\s*"/g) || []).length, 4);
  assert.match(bottomNavComponent, /aria-label=\{label\}/);
  assert.match(bottomNavComponent, /betaNavLabel">\{label\}/);
  assert.doesNotMatch(bottomNavComponent, /label === "Perfil" \? "Cuenta"/);
  assert.match(globalStyles, /\.bottomNav\.homeBottomNav\{[^}]*bottom:0[^}]*left:0/);
  assert.match(globalStyles, /\.bottomNav\.homeBottomNav\{[^}]*safe-area-inset-bottom/);
  assert.match(globalStyles, /\.app\.homeApp\{[^}]*height:100dvh[^}]*overflow:hidden/);
  assert.match(homeStyles, /\.home \{[^}]*height: 100%[^}]*grid-template-rows:/);
  assert.match(homeStyles, /\.content \{[^}]*padding:[^}]*safe-area-inset-bottom/);
});

test("Más is a real scalable tool container", () => {
  for (const label of ["Campos", "Mi Bolsa", "Handicap / GHIN", "Fitting", "GPS / Hole Map"]) assert.match(moreHub, new RegExp(label.replace("/", "\\/")));
  assert.match(moreHub, /GHIN oficial: próximamente/);
});
