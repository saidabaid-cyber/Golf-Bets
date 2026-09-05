import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { calculateMonkey, calculatePersonalBets, settleBalances } from "../lib/engine";
import { normalizeBackyardProfileCache, profileHandicapInput, profileHandicapLabel, validateProfileDraft } from "../lib/account-state";
import { buildGeneralResultsTable } from "../lib/result-breakdown";
import { resultSummaryText } from "../lib/round-editing";
import { COUNTER_BET_META } from "../lib/side-bets";
import { monkeyHoleSummary, personalHoleSummary } from "../lib/personal-summary";
import { realCases, realCourse, realOrder, realPersonal, realPlayers, realScores } from "./fixtures/personals-real";

const read = (path: string) => readFileSync(path, "utf8");

test("CounterBetHolePanel usa artículos correctos para Víboras, Camellos y Peces", () => {
  assert.deepEqual(Object.fromEntries(Object.entries(COUNTER_BET_META).map(([kind, meta]) => [kind, meta.article])), {
    vipers: "las",
    camels: "los",
    fish: "los",
  });
  assert.match(read("app/components/side-bet-panels.tsx"), /¿Quién se quedó \{meta\.article\} \{meta\.emoji\} \{meta\.plural\}/);
});

test("resumen post-hoyo reutiliza Personales guardadas y presenta Match y Medal compactos", () => {
  const partialScores = { 1: realScores[1] };
  const result = calculatePersonalBets([realPersonal(realCases[0])], "said", realPlayers, realCourse, partialScores, realOrder).results[0];
  const summary = personalHoleSummary(result, "Said", "Carlos", 1);
  assert.match(summary, /^PERSONAL · Said vs Carlos\n/);
  assert.match(summary, /Match:/);
  assert.match(summary, /Medal:/);
  const page = read("app/page.tsx");
  assert.match(page, /const savedPersonals = calculatePersonalBets\(personalBets, ownerId, players, course, savedScores, order\)/);
  assert.match(page, /personalHoleSummary\(result, playerName\(ownerId\), playerName\(result\.rivalId\), holeNumber\)/);
});

test("resumen post-hoyo Monkey usa los puntos acumulados del mismo motor", () => {
  const players = realPlayers.slice(0, 3);
  const config = { enabled: true, value: 100, participantIds: players.map(player => player.id) };
  const result = calculateMonkey(realCourse, { 1: realScores[1] }, players, config, [1]);
  const summary = monkeyHoleSummary(players, result.points);
  assert.match(summary, /^Monkey:/);
  players.forEach(player => assert.match(summary, new RegExp(`${player.name} ${result.points[player.id]} pts`)));
  assert.match(read("app/page.tsx"), /monkeyHoleSummary\(participants, savedMonkey\.points\)/);
});

test("alta exige Nombre y deja HCP Index opcional como null", () => {
  assert.deepEqual(validateProfileDraft("", "8.4"), { ok: false, message: "Escribe tu nombre para continuar." });
  assert.deepEqual(validateProfileDraft("  Said  ", ""), { ok: true, displayName: "Said", defaultHandicap: null });
});

test("HCP Index conserva decimales y notación plus sin convertir vacío a cero", () => {
  assert.deepEqual(validateProfileDraft("Said", "8.4"), { ok: true, displayName: "Said", defaultHandicap: 8.4 });
  assert.deepEqual(validateProfileDraft("Said", "12,7"), { ok: true, displayName: "Said", defaultHandicap: 12.7 });
  assert.deepEqual(validateProfileDraft("Said", "+1.2"), { ok: true, displayName: "Said", defaultHandicap: -1.2 });
  assert.equal(profileHandicapInput(null), "");
  assert.equal(profileHandicapInput(-1.2), "+1.2");
  assert.equal(profileHandicapLabel(null), "Sin capturar");
});

test("perfil completado conserva nombre y HCP Index null o decimal al recargar", () => {
  const fallback = { userId: "account-1", displayName: "Jugador", email: "said@example.com", avatarUrl: "", defaultHandicap: 10 };
  assert.deepEqual(normalizeBackyardProfileCache({ displayName: "Said", defaultHandicap: null, avatarUrl: "" }, fallback), {
    ...fallback, displayName: "Said", defaultHandicap: null,
  });
  assert.deepEqual(normalizeBackyardProfileCache({ displayName: "Said", defaultHandicap: 8.4, avatarUrl: "" }, fallback), {
    ...fallback, displayName: "Said", defaultHandicap: 8.4,
  });
  assert.match(read("app/components/account-provider.tsx"), /setProfileSetupRequired\(!cloudProfile\.onboarding_completed_at\)/);
});

test("pantalla de perfil usa labels, estado vacío y validación compartida", () => {
  const provider = read("app/components/account-provider.tsx");
  const account = read("app/components/account-panel.tsx");
  assert.match(provider, /<label htmlFor="profile-setup-name">Nombre<\/label>/);
  assert.match(provider, /placeholder="Tu nombre"/);
  assert.match(provider, /<label htmlFor="profile-setup-hcp">HCP Index \(opcional\)<\/label>/);
  assert.match(provider, /disabled=\{busy\}/);
  assert.doesNotMatch(provider, /disabled=\{busy \|\| !name\.trim\(\) \|\| handicap === ""\}/);
  assert.match(account, /<span>HCP Index<\/span>/);
  assert.match(account, /validateProfileDraft\(name, handicap\)/);
});

test("alta social prellena el nombre disponible y exige perfil incompleto para cualquier sesión", () => {
  const provider = read("app/components/account-provider.tsx");
  assert.match(provider, /user\.user_metadata\?\.full_name \|\| user\.user_metadata\?\.name/);
  assert.match(provider, /identity\.mode === "authenticated" && profileSetupRequired/);
  assert.match(provider, /await saveCloudProfile\(supabase, identity\.userId, profile, updatedAt\)/);
});

test("layout de alta es seguro para 390x844, 430x932 y teclado iOS", () => {
  const css = read("app/globals.css");
  assert.match(css, /\.profileSetupScreen\{[^}]*height:100dvh[^}]*overflow-x:hidden[^}]*overflow-y:auto/);
  assert.match(css, /\.profileSetupForm input\{[^}]*width:100%[^}]*min-width:0/);
  assert.match(css, /@media\(max-width:430px\)\{\.profileSetupScreen\{[^}]*safe-area-inset-bottom/);
});

test("Resultados mantiene Personales fuera del Resumen General y dentro del total consolidado final", () => {
  const balances = { said: 800, flavio: -500, juan: -300 };
  const general = buildGeneralResultsTable(Object.keys(balances), [
    { key: "all", label: "Apuestas", balances, active: true, played: true },
  ], balances);
  const transfers = settleBalances(balances);
  const whatsapp = resultSummaryText("La Vista", "2026-09-03", [
    { id: "said", name: "Said" }, { id: "flavio", name: "Flavio" }, { id: "juan", name: "Juan" },
  ], balances, "said", 0);
  assert.deepEqual(general.rows.map(row => row.total), [800, -500, -300]);
  assert.equal(general.grandTotal, 0);
  assert.equal(transfers.reduce((sum, transfer) => sum + transfer.amount, 0), 800);
  assert.match(whatsapp, /Said \+\$800/);
  const page = read("app/page.tsx");
  for (const pattern of [
    /settleBalances\(allBetBalances\)/,
    /buildGeneralResultsTable\(players\.map\(player => player\.id\), generalResultCategories, generalBetBalances\)/,
    /allBetBalances\[p\.id\]/,
    /resultSummaryText\(course\.name, roundDate, settlementIds\.map[\s\S]*allBetBalances/,
  ]) assert.match(page, pattern);
  assert.doesNotMatch(page, /key: "personals"[\s\S]*generalResultCategories/);
  assert.match(page, /title="Personales"/);
  assert.match(page, /supplemental\.results\.filter\(\(result\) => !isPersonalSupplementalType\(result\.type\)\)/);
});
