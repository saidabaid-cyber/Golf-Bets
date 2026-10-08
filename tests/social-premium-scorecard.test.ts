import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { socialPremiumScorecard } from "../lib/social-premium-scorecard";
import { safeSocialRoundCard } from "../lib/social-round-card";
import { PremiumScorecard } from "../app/components/premium-scorecard";
import { HistoricalRoundDetail } from "../app/components/historical-round-detail";
import { careerRound } from "./helpers/career-round";
import { socialUI, uiFind, uiText } from "./helpers/social-ui";
import * as views from "../lib/scorecard-view";
import type { SocialActivityCard } from "../lib/social-activity-contract";

function activity(): SocialActivityCard {
  const round = careerRound("real-local", 1);
  round.putts = { 1: { "owner-player": 0, "rival-player": 7 } };
  round.advancedStats = { 1: { "owner-player": { fairwayHit: false, greenInRegulation: true, penaltyStrokes: 0, teeDirection: "left" }, "rival-player": { penaltyStrokes: 9 } } };
  return { id: "authorized-post", type: "ROUND_COMPLETED", audience: "FRIENDS", author: { userId: "owner", displayName: "Jugador autorizado", username: null, avatarUrl: null },
    createdAt: "2026-10-05T00:00:00Z", sourceVersion: 1, currentHash: "material", roundId: "cloud-id",
    round: safeSocialRoundCard({ id: "cloud-id", local_round_id: round.id, snapshot: round }, "owner", true)!,
    achievements: [], likesCount: 0, likedByMe: false, commentsCount: 0, attestCount: 0, isAttestedByMe: false, canAttest: false,
    requiresParticipantConfirmation: false, participantPlayerKey: null, targetUserId: "owner" };
}
test("shared Premium preserves canonical round, author and captured facts, never opponents or financials", () => {
  const card = activity(), premium = socialPremiumScorecard(card)!;
  assert.equal(premium.roundId, "cloud-id"); assert.equal(premium.players[0].id, "owner");
  assert.equal(premium.players[0].name, "Jugador autorizado"); assert.equal(premium.order.length, 18);
  assert.deepEqual(premium.putts, { 1: { owner: 0 } }); assert.equal(premium.advancedStats[1].owner?.penaltyStrokes, 0);
  assert.equal(premium.advancedStats[1].owner?.teeDirection, "left");
  assert.doesNotMatch(JSON.stringify(premium), /rival-player|"penaltyStrokes":9|netResult|playerBalances/);
  const markup = renderToStaticMarkup(createElement(PremiumScorecard, { ...premium, view: { kind: "card" }, onBack() {}, onHole() {} }));
  assert.match(markup, /Solo lectura/); assert.doesNotMatch(markup, /Editar score|Captura rápida|Neto|HCP/);
  assert.match(markup, /Putts|FIR \/ Salida|GIR|Penalidades/);
});
test("missing per-hole evidence and total-only records never manufacture a detailed card", () => {
  for (const mutate of [(c: SocialActivityCard) => { c.round!.totalOnly = true; }, (c: SocialActivityCard) => { delete c.round!.scorecard; },
    (c: SocialActivityCard) => { c.round!.scorecard = []; }, (c: SocialActivityCard) => { c.roundId = "wrong-round"; },
    (c: SocialActivityCard) => { c.round!.scorecard![0].par = 0; }, (c: SocialActivityCard) => { c.round!.scorecard!.push(c.round!.scorecard![0]); }]) {
    const card = activity(); mutate(card); assert.equal(socialPremiumScorecard(card), null);
  }
  const card = activity(); card.round!.scorecard = card.round!.scorecard!.slice(0, 1);
  assert.equal(socialPremiumScorecard(card), null);
  card.round!.holesPlayed = 1;
  assert.equal(socialPremiumScorecard(card)!.course.holes.length, 1);
});
test("private course projection hides tee, distance and SI while retaining permitted score facts", () => {
  const round = careerRound("private", 1); round.courseSnapshot!.holes[0].yards = 456;
  const projection = safeSocialRoundCard({ id: "cloud", local_round_id: round.id, snapshot: round }, "owner", true, false)!;
  assert.equal(projection.courseName, "Campo privado"); assert.equal(projection.teeName, null);
  assert.equal(projection.scorecard![0].yards, undefined); assert.equal(projection.scorecard![0].strokeIndex, undefined);
});
test("history has one early Premium entry before sharing, achievements, financials or leaderboard", () => {
  const round = careerRound("historical", 1);
  const markup = renderToStaticMarkup(createElement(HistoricalRoundDetail, { round, onEdit() {}, onPhoto() {} }));
  assert.equal((markup.match(/Ver tarjeta completa/g) ?? []).length, 1);
  assert.ok(markup.indexOf("Ver tarjeta completa") < markup.indexOf("RONDA GUARDADA"));
  assert.ok(markup.indexOf("Ver tarjeta completa") < markup.indexOf("Clasificación"));
  const source = readFileSync("app/components/cloud-social-activity.tsx", "utf8");
  assert.doesNotMatch(source, /setExpanded|detailedRound|<table/);
  assert.match(source, /socialRequest<\{ data: SocialActivityCard \}>\(base, accessToken\)/);
  assert.match(readFileSync("app/scorecard-premium.css", "utf8"), /\[data-scorecard-origin\]\{min-width:0;max-width:100%\}/);
});
test("Feed → Premium → hole → Premium → Feed restores scroll and retains global navigation", () => {
  const listeners = new Set<() => void>(), scroll: number[] = [], location = { search: "?home=feed", pathname: "/" };
  const entries: Array<{ state: Record<string, unknown>; search: string }> = [{ state: { backyardTab: "welcome" }, search: location.search }];
  const history = { state: entries[0].state, scrollRestoration: "auto",
    pushState(state: Record<string, unknown>, _title: string, href: string) { this.state = state; location.search = new URL(href, "https://dev.thebackyard.com.mx").search; entries.push({ state, search: location.search }); },
    replaceState(state: Record<string, unknown>, _title: string, href: string) { this.state = state; location.search = new URL(href, "https://dev.thebackyard.com.mx").search; },
    back() { entries.pop(); const previous = entries[entries.length - 1]; this.state = previous.state; location.search = previous.search; listeners.forEach(fn => fn()); } };
  class Element { focus() {} }
  const window = { history, location, scrollY: 1200, scrollTo({ top }: { top: number }) { this.scrollY = top; scroll.push(top); }, addEventListener(_name: string, fn: () => void) { listeners.add(fn); }, removeEventListener(_name: string, fn: () => void) { listeners.delete(fn); } };
  const h = socialUI("app/components/scorecard-boundary.tsx", { "scorecard-view": views, "premium-scorecard": { PremiumScorecard: "PremiumScorecard" } }, { window, document: { activeElement: new Element() }, HTMLElement: Element });
  const destination = { id: "social:authorized-post", card: socialPremiumScorecard(activity())! };
  const props = { originLabel: "Feed", children: (open: (next: typeof destination) => void) => ({ type: "button", props: { children: "Ver tarjeta", onClick: () => open(destination) } }) };
  let tree = h.render("ScorecardNavigationBoundary", props);
  uiFind(tree, n => n.type === "button" && uiText(n) === "Ver tarjeta").props.onClick();
  tree = h.render("ScorecardNavigationBoundary", props); tree = h.render("ScorecardNavigationBoundary", props);
  let card = uiFind(tree, n => n.type === "PremiumScorecard"); assert.equal(card.props.roundId, "cloud-id"); assert.equal(history.state.backyardTab, "welcome");
  card.props.onHole(10, "owner"); tree = h.render("ScorecardNavigationBoundary", props);
  card = uiFind(tree, n => n.type === "PremiumScorecard"); assert.deepEqual(JSON.parse(JSON.stringify(card.props.view)), { kind: "hole", hole: 10, playerId: "owner" });
  card.props.onBack(); tree = h.render("ScorecardNavigationBoundary", props); card = uiFind(tree, n => n.type === "PremiumScorecard"); assert.equal(card.props.view.kind, "card");
  card.props.onBack(); tree = h.render("ScorecardNavigationBoundary", props); assert.match(uiText(tree), /Ver tarjeta/); assert.equal(window.scrollY, 1200); assert.equal(location.search, "?home=feed");
  h.unmount(); assert.equal(history.scrollRestoration, "auto");
});
