import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync("app/components/home-dashboard.tsx", "utf8");
const bottomNav = readFileSync("lib/app-navigation.ts", "utf8");
const moreHub = readFileSync("app/components/more-hub.tsx", "utf8");

test("approved Home separates the manual ball from the AI action", () => {
  assert.match(source, /data-home-version="approved-golf-home-v1"/);
  assert.match(source, /const playAction = activeRound \? onContinueRound : onNewRound/);
  assert.match(source, /aria-label=\{activeRound \? "Continuar ronda" : "Configurar ronda manualmente"\}/);
  assert.match(source, /<BackyardBallMark \/>/);
  assert.match(source, /onClick=\{onAiRound\}/);
  assert.match(source, /THE BACKYARD/);
  assert.match(source, /PLAY WITH IT/);
});

test("approved Home has exactly three quick actions and only two More Backyard actions", () => {
  const quickSection = source.match(/<nav className=\{styles\.quickActions\}[\s\S]*?<\/nav>/)?.[0] || "";
  const moreSection = source.match(/<section className=\{styles\.moreBackyard\}[\s\S]*?<\/section>/)?.[0] || "";
  assert.equal((quickSection.match(/<button/g) || []).length, 3);
  for (const label of ["ESTADÍSTICAS", "HISTORIAL", "REGLAS DE GOLF"]) assert.match(quickSection, new RegExp(label));
  assert.doesNotMatch(quickSection, /Mi Bolsa|Perfil|Campos|JUGAR/);
  assert.equal((moreSection.match(/<button/g) || []).length, 2);
  assert.match(moreSection, /BALANCES/);
  assert.match(moreSection, /GRUPOS/);
});

test("Home uses only saved golf data for progress and preserves an elegant empty state", () => {
  assert.match(source, /insights\.scoredRounds > 0/);
  assert.match(source, /typeof insights\.averageScore === "number"/);
  assert.match(source, /Tus tendencias aparecerán al guardar tarjetas completas/);
  assert.match(source, /typeof insights\.betBalance === "number"/);
  assert.doesNotMatch(source, /Tu promedio es 80|Ganaste|Mejoraste/);
});

test("active round remains inside the approved Home and routes both visible continuation controls", () => {
  assert.match(source, /<small>RONDA ACTIVA<\/small>/);
  assert.match(source, /onClick=\{onContinueRound\}/);
  assert.match(source, /CONTINUAR RONDA/);
  assert.match(source, /currentHole/);
  assert.match(source, /partialGross/);
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
});

test("Más is a real scalable tool container", () => {
  for (const label of ["Campos", "Mi Bolsa", "Handicap / GHIN", "Fitting", "GPS / Hole Map"]) assert.match(moreHub, new RegExp(label.replace("/", "\\/")));
  assert.match(moreHub, /GHIN oficial: próximamente/);
});
