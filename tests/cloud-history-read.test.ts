import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { readMissingHistoricalRound } from "../lib/cloud-history-read";
import { canEditSnapshot } from "../lib/round-editing";
import type { RoundSnapshot } from "../lib/types";
import { socialUI, settleUI, uiFind, uiText } from "./helpers/social-ui";

const account = "qa-owner", cloudId = "11111111-1111-4111-8111-111111111111";
const order = Array.from({ length: 18 }, (_, index) => index + 1);
const card: RoundSnapshot = { id: "saved-103", lifecycleState: "completed", completedAt: "2026-10-06T20:00:00Z",
  date: "2026-10-06", courseName: "Isolated QA", teeName: "QA", ownerName: "QA", ownerId: "owner",
  players: [{ id: "owner", accountUserId: account, name: "QA", handicap: 0 }],
  order, roundHoles: 18, courseSnapshot: { id: "qa", name: "Isolated QA", teeName: "QA", holes: order.map(number => ({ number, par: 4, strokeIndex: number })) },
  scores: Object.fromEntries(order.map(number => [number, { owner: number <= 13 ? 6 : 5 }])),
  betResult: 0, expenses: { caddie: 0, food: 0, drinks: 0, greenFee: 0, cartRental: 0, other: 0 }, expenseTotal: 0, netResult: 0, categoryResults: {} };
const row = { id: cloudId, version: 21, snapshot: card };
function response(body: unknown, status = 200): typeof fetch { return async () => new Response(JSON.stringify(body), { status }); }

test("missing owned card uses authenticated GET and remains read-only without modifying its snapshot", async () => {
  const calls: Array<{ url: string; options?: RequestInit }> = [];
  const before = JSON.stringify(row);
  const round = await readMissingHistoricalRound(card.id, account, "qa-session", undefined, async (url, options) => {
    calls.push({ url: String(url), options }); return new Response(JSON.stringify({ data: row }));
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "/api/cloud/rounds?localRoundId=saved-103");
  assert.equal(calls[0].options?.method, "GET");
  assert.equal((calls[0].options?.headers as Record<string, string>).authorization, "Bearer qa-session");
  assert.equal(calls[0].options?.cache, "no-store");
  assert.equal(round?.id, card.id); assert.equal(round?.cloudRoundId, cloudId);
  assert.equal(round?.cloudReadOnly, true); assert.equal(canEditSnapshot(round!), false);
  assert.deepEqual(round?.scores, card.scores); assert.equal(JSON.stringify(row), before);
});

test("missing, malformed, wrong-player, duplicate identity and active cards fail closed", async () => {
  for (const value of [null, { ...row, version: 0 }, { ...row, snapshot: { ...card, id: "different" } },
    { ...row, snapshot: { ...card, players: [{ id: "someone", accountUserId: "other-account" }] } },
    { ...row, snapshot: { ...card, players: [card.players![0], card.players![0]] } },
    { ...row, snapshot: { ...card, lifecycleState: "live" } }])
    assert.equal(await readMissingHistoricalRound(card.id, account, "qa", undefined, response({ data: value })), null);
});

test("a shared card requires the existing server-authorized participant projection", async () => {
  const id = `shared:${cloudId}`;
  const shared = { ...card, id, cloudReadOnly: true, cloudRoundId: cloudId, cloudSourceLocalId: card.id,
    cloudParticipant: { accountUserId: account, playerId: "owner" } };
  const read = (value: unknown) => readMissingHistoricalRound(id, account, "qa", undefined, response({ rounds: [value] }));
  assert.equal((await read(shared))?.id, id);
  assert.equal(await read({ ...shared, cloudParticipant: undefined }), null);
  assert.equal(await read({ ...shared, cloudParticipant: { accountUserId: "stranger", playerId: "owner" } }), null);
  assert.equal(await read({ ...shared, cloudRoundId: "wrong" }), null);
  assert.equal(await read({ ...shared, cloudReadOnly: false }), null);
});

test("authentication and transient failures are distinct from a missing card and never write", async () => {
  await assert.rejects(readMissingHistoricalRound(card.id, account, "qa", undefined, response({}, 401)), /Inicia sesión/);
  await assert.rejects(readMissingHistoricalRound(card.id, account, "qa", undefined, response({}, 503)), /Intenta de nuevo/);
  await assert.rejects(readMissingHistoricalRound(card.id, account, "qa", undefined, async () => new Response("not JSON")), /Intenta de nuevo/);
  let calls = 0;
  const request: typeof fetch = async () => { calls++; throw Error("unexpected"); };
  for (const [id, user, token] of [["", account, "qa"], [card.id, "", "qa"], [card.id, account, ""], ["shared:invalid", account, "qa"]])
    assert.equal(await readMissingHistoricalRound(id, user, token, undefined, request), null);
  assert.equal(calls, 0);
});

test("cloud view cancellation prevents an old account response from appearing in another account", async () => {
  const pending: Array<{ account: string; release: (round: RoundSnapshot | null) => void }> = [];
  const h = socialUI("app/components/cloud-historical-round.tsx", {
    "cloud-history-read": { readMissingHistoricalRound: (_id: string, user: string) => new Promise(resolve => pending.push({ account: user, release: resolve })) },
  });
  const props = { roundId: card.id, accountUserId: account, accessToken: "qa", onPhoto() {} };
  assert.match(uiText(h.render("CloudHistoricalRound", props)), /Consultando tu tarjeta/);
  h.render("CloudHistoricalRound", { ...props, accountUserId: "next-account" });
  pending[0].release(card); await settleUI();
  assert.match(uiText(h.render("CloudHistoricalRound", { ...props, accountUserId: "next-account" })), /Consultando tu tarjeta/);
  pending[1].release(null); await settleUI();
  assert.match(uiText(h.render("CloudHistoricalRound", { ...props, accountUserId: "next-account" })), /no está disponible para tu cuenta/);
  h.unmount();
});

test("cloud view reuses HistoricalRoundDetail with no finalize token or edit action, and errors can retry", async () => {
  let error = true;
  const h = socialUI("app/components/cloud-historical-round.tsx", { "cloud-history-read": {
    readMissingHistoricalRound: async () => { if (error) throw Error("No pudimos consultar esta tarjeta. Intenta de nuevo."); return { ...card, cloudReadOnly: true }; },
  } });
  const props = { roundId: card.id, accountUserId: account, accessToken: "qa", onPhoto() {} };
  h.render("CloudHistoricalRound", props); await settleUI();
  let tree = h.render("CloudHistoricalRound", props); assert.match(uiText(tree), /No pudimos consultar esta tarjeta/);
  error = false; uiFind(tree, n => n.type === "button" && uiText(n) === "Reintentar").props.onClick();
  h.render("CloudHistoricalRound", props); await settleUI(); tree = h.render("CloudHistoricalRound", props);
  const detail = uiFind(tree, n => n.type === "HistoricalRoundDetail");
  assert.equal(detail.props.round.id, card.id); assert.equal(detail.props.round.cloudReadOnly, true);
  assert.equal(detail.props.accessToken, undefined); assert.equal(detail.props.onEdit(), undefined);
  h.unmount();
  const page = readFileSync("app/page.tsx", "utf8");
  assert.match(page, /const saved = history\.find\(round => round\.id === historyDetailId\)/);
  assert.match(page, /saved \? <HistoricalRoundDetail[\s\S]*? : <CloudHistoricalRound/);
});
