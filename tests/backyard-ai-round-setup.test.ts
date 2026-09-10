import assert from "node:assert/strict";
import test from "node:test";

import type { BackyardProfile } from "../lib/account-state";
import { createGroupGameTemplate } from "../lib/group-game-template";
import { DEFAULT_COURSES } from "../lib/golf-course-directory";
import { initialBets } from "../lib/new-round-bets";
import { createSupplementalBet } from "../lib/supplemental-bets";
import type { Course, FrequentGroup, FrequentPlayer, Player, RoundSnapshot } from "../lib/types";
import { createRoundSetupDraft } from "../lib/backyard-ai/schemas/round-setup";
import { assignTeeToEveryPlayer, updatePlayerTeeAssignment } from "../lib/player-tee-assignments";
import { parseUnknownPlayerClarification } from "../lib/backyard-ai/runtime/clarification";
import { parseRoundSetupIntent } from "../lib/backyard-ai/runtime/intent-parser";
import { planRoundSetup } from "../lib/backyard-ai/runtime/round-setup";
import type { UserPreference } from "../lib/backyard-ai/memory/types";

function course(id: string, name = "La Vista", teeName = "Azules"): Course {
  return {
    id,
    name,
    teeName,
    holes: Array.from({ length: 18 }, (_, index) => ({ number: index + 1, par: 4, strokeIndex: index + 1 })),
  };
}

const laVista = course("la-vista-azules");
const laVistaWhite: Course = { ...course("la-vista-blancas", "La Vista", "Blancas"), catalogCourseId: "la-vista", catalogTeeId: "white" };
const laVistaBlue: Course = { ...laVista, catalogCourseId: "la-vista", catalogTeeId: "blue" };
const profile: BackyardProfile = {
  userId: "user-said",
  displayName: "Said",
  email: "said@example.test",
  avatarUrl: "",
  defaultHandicap: 8,
  homeClub: "La Vista",
  preferredTee: "Azules",
};
const frequentPlayers: FrequentPlayer[] = [
  { id: "fp-pedro", name: "Pedro", handicap: 10, uses: 8, updatedAt: "2026-09-06T12:00:00Z" },
  { id: "fp-juan", name: "Juan", handicap: 12, uses: 7, updatedAt: "2026-09-06T12:00:00Z" },
  { id: "fp-carlos", name: "Carlos", handicap: 14, uses: 6, updatedAt: "2026-09-06T12:00:00Z" },
];

function ids(prefix = "generated") {
  let sequence = 0;
  return () => `${prefix}-${++sequence}`;
}

function context(overrides: Record<string, unknown> = {}) {
  return {
    profile,
    frequentPlayers,
    frequentGroups: [] as FrequentGroup[],
    history: [] as RoundSnapshot[],
    courses: [laVista],
    today: "2026-09-07",
    idFactory: ids(),
    ...overrides,
  };
}

const roundPlayers: Player[] = [
  { id: "said", name: "Said", handicap: 8, accountUserId: "user-said" },
  { id: "pedro", name: "Pedro", handicap: 10 },
  { id: "juan", name: "Juan", handicap: 12 },
  { id: "carlos", name: "Carlos", handicap: 14 },
];

function activeDraft() {
  return createRoundSetupDraft({
    date: "2026-09-07",
    course: laVista,
    players: roundPlayers,
    ownerId: "said",
  });
}

function snapshot(id: string, date: string, mutate?: (bets: ReturnType<typeof initialBets>) => void): RoundSnapshot {
  const bets = initialBets(roundPlayers.map((player) => player.id));
  mutate?.(bets);
  return {
    id,
    date,
    courseName: laVista.name,
    teeName: laVista.teeName,
    ownerName: "Said",
    ownerId: "said",
    roundHoles: 18,
    startHole: 1,
    handicapBasis: "relative",
    betResult: 0,
    expenses: { caddie: 0, food: 0, drinks: 0, greenFee: 0, cartRental: 0, other: 0 },
    expenseTotal: 0,
    netResult: 0,
    categoryResults: {},
    players: structuredClone(roundPlayers),
    courseSnapshot: laVista,
    betConfig: bets,
    scores: {},
    completedAt: `${date}T20:00:00Z`,
  };
}

test("interpreta roster, Skins y Nassau grupal hacia el modelo real de Pollas", () => {
  const plan = planRoundSetup(
    "Jugamos Said, Pedro, Juan y Carlos en La Vista. Skins de 100 y Nassau de 500.",
    context(),
  );

  assert.deepEqual(plan.draft.players.map((player) => player.name), ["Said", "Pedro", "Juan", "Carlos"]);
  assert.equal(plan.draft.course?.id, laVista.id);
  assert.equal(plan.draft.bets.skins.enabled, true);
  assert.equal(plan.draft.bets.skins.value, 100);
  assert.deepEqual(
    [plan.draft.bets.polla.first9, plan.draft.bets.polla.second9, plan.draft.bets.polla.total18]
      .map((component) => [component.enabled, component.value]),
    [[true, 500], [true, 500], [true, 500]],
  );
  assert.equal(plan.draft.supplementalBets.length, 0);
  assert.equal(plan.canConfirm, true);
});

test("Peces modela su presión real 3x sin convertirla en Presiones independientes", () => {
  const plan = planRoundSetup(
    "Peces de 100 con presión 3x.",
    context({ activeDraft: activeDraft() }),
  );

  assert.equal(plan.draft.bets.fish.enabled, true);
  assert.equal(plan.draft.bets.fish.value, 100);
  assert.equal(plan.draft.bets.fish.secondNinePressed, true);
  assert.equal(plan.draft.bets.fish.secondNineMultiplier, 3);
  assert.equal(plan.draft.supplementalBets.some((bet) => bet.type === "individual_pressures" || bet.type === "team_pressures"), false);
  assert.equal(plan.questions.some((question) => question.field === "bets.pressures"), false);
  assert.equal(plan.canConfirm, true);
});

test("Peces bloquea una presión incompleta o fuera del rango real en vez de ignorarla", () => {
  for (const input of ["Peces de 100 con presión.", "Peces de 100 con presión 7x.", "Peces de 100 sin presión 3x."]) {
    const plan = planRoundSetup(input, context({ activeDraft: activeDraft() }));
    assert.equal(plan.draft.bets.fish.value, 100);
    assert.equal(plan.canConfirm, false, input);
    assert.ok(plan.questions.some((question) => question.field === "bets.fish.secondNineMultiplier"), input);
  }
});

test("Agua y Peces/agua sólo activan Peces en una cláusula de apuesta explícita", () => {
  for (const [input, value] of [["Peces / agua de 100.", 100], ["Agua de 125.", 125]] as const) {
    const plan = planRoundSetup(input, context({ activeDraft: activeDraft() }));
    assert.equal(plan.draft.bets.fish.enabled, true, input);
    assert.equal(plan.draft.bets.fish.value, value, input);
    assert.equal(plan.questions.some((question) => question.code === "unknown_bet"), false, input);
    assert.equal(plan.canConfirm, true, input);
  }

  const ordinaryWater = parseRoundSetupIntent("Jugamos Said y Pedro en Agua Caliente.");
  assert.equal(ordinaryWater.actions.some((action) => action.type === "configure_core_bet" && action.bet === "fish"), false);
  assert.deepEqual(
    ordinaryWater.actions.find((action) => action.type === "replace_players")?.playerNames,
    ["Said", "Pedro"],
  );
  assert.equal(
    ordinaryWater.actions.find((action) => action.type === "select_course")?.courseName,
    "Agua Caliente",
  );
});

test("TEST A: Said y La Vista se resuelven; jugadores nuevos sólo piden tee y HCP agrupados", () => {
  const saidAbaid: BackyardProfile = {
    ...profile,
    displayName: "Said Abaid",
    givenName: "Said",
    familyName: "Abaid",
    username: "saidabaid",
    homeClub: "",
    preferredTee: "",
  };
  const plan = planRoundSetup(
    "Hoy jugamos Said, Pedro, Juan y Carlos en La Vista. Skins de $200, Nassau de $500, Bola Amiga y Viboritas. Ventajas entre jugadores.",
    context({ profile: saidAbaid, frequentPlayers: [], courses: DEFAULT_COURSES }),
  );

  assert.deepEqual(plan.draft.players.map((player) => player.name), ["Said Abaid", "Pedro", "Juan", "Carlos"]);
  assert.equal(plan.draft.players[0]?.accountUserId, saidAbaid.userId);
  assert.deepEqual(plan.draft.players.slice(1).map((player) => player.handicap), [null, null, null]);
  assert.equal(plan.draft.course, null, "la identidad del campo no debe inventar un tee");
  assert.equal(plan.draft.courseIdentity?.name, "La Vista");
  assert.equal(plan.draft.courseIdentity?.catalogCourseId, "course-la-vista");
  assert.equal(plan.draft.handicapBasis, "relative");
  assert.equal(plan.draft.bets.skins.enabled, true);
  assert.equal(plan.draft.bets.skins.value, 200);
  assert.deepEqual(
    [plan.draft.bets.polla.first9, plan.draft.bets.polla.second9, plan.draft.bets.polla.total18]
      .map((component) => [component.enabled, component.value]),
    [[true, 500], [true, 500], [true, 500]],
  );
  assert.equal(plan.draft.presentation?.groupNassauTerm, "nassau");
  assert.equal(plan.draft.bets.ballFriend.enabled, true);
  assert.equal(plan.draft.bets.ballFriend.value, initialBets([]).ballFriend.value);
  assert.equal(plan.draft.bets.vipers.enabled, true);
  assert.equal(plan.draft.bets.vipers.value, initialBets([]).vipers.value);
  assert.deepEqual(plan.questions.map((question) => question.field).sort(), ["course.tee", "players.handicaps"]);
  const handicaps = plan.questions.find((question) => question.code === "missing_player_handicaps");
  assert.deepEqual(handicaps?.playerTargets?.map((player) => player.label), ["Pedro", "Juan", "Carlos"]);
  assert.equal(plan.configurationIssues.some((issue) => issue.code === "round-course"), false);
  assert.ok(plan.configurationIssues.some((issue) => issue.code === "round-tee"));
  assert.equal(plan.canConfirm, false);
});

test("el perfil autenticado por givenName tiene prioridad sobre un homónimo frecuente exacto", () => {
  const saidAbaid: BackyardProfile = { ...profile, displayName: "Said Abaid", givenName: "Said" };
  const plan = planRoundSetup("Jugamos Said y Pedro en La Vista. Skins de 100.", context({
    profile: saidAbaid,
    frequentPlayers: [
      { id: "frequent-said", name: "Said", handicap: 22, uses: 20, updatedAt: "2026-09-07" },
      ...frequentPlayers,
    ],
  }));

  assert.equal(plan.draft.players[0]?.name, "Said Abaid");
  assert.equal(plan.draft.players[0]?.accountUserId, saidAbaid.userId);
  assert.equal(plan.draft.players[0]?.handicap, saidAbaid.defaultHandicap);

  const withoutGivenName = planRoundSetup("Jugamos Said y Pedro en La Vista. Skins de 100.", context({
    profile: { ...saidAbaid, givenName: "" },
    frequentPlayers: [
      { id: "frequent-said", name: "Said", handicap: 22, uses: 20, updatedAt: "2026-09-07" },
      ...frequentPlayers,
    ],
  }));
  assert.equal(withoutGivenName.draft.players[0]?.name, "Said Abaid");
  assert.equal(withoutGivenName.draft.players[0]?.accountUserId, saidAbaid.userId);
});

test("tee y HCP completan el draft identificado sin perder campo, roster ni apuestas", () => {
  const saidAbaid: BackyardProfile = {
    ...profile,
    displayName: "Said Abaid",
    givenName: "Said",
    homeClub: "",
    preferredTee: "",
  };
  const first = planRoundSetup("Jugamos Said y Pedro en La Vista. Skins de $200.", context({
    profile: saidAbaid,
    frequentPlayers: [],
    courses: DEFAULT_COURSES,
  }));
  const completed = planRoundSetup("Tee Blancas. Pedro HCP 12.", context({
    profile: saidAbaid,
    frequentPlayers: [],
    courses: DEFAULT_COURSES,
    activeDraft: first.draft,
  }));

  assert.equal(completed.draft.course?.id, "lavista-blancas");
  assert.equal(completed.draft.courseIdentity?.catalogCourseId, "course-la-vista");
  assert.equal(completed.draft.players.find((player) => player.name === "Pedro")?.handicap, 12);
  assert.equal(completed.draft.bets.skins.value, 200);
  assert.deepEqual(completed.questions, []);
  assert.equal(completed.canConfirm, true);
});

test("TEST B: cambiar únicamente Skins conserva el resto del draft y la terminología Nassau", () => {
  const draft = activeDraft();
  draft.bets.skins = { ...draft.bets.skins, enabled: true, value: 200 };
  draft.bets.polla.first9 = { ...draft.bets.polla.first9, enabled: true, value: 500 };
  draft.bets.polla.second9 = { ...draft.bets.polla.second9, enabled: true, value: 500 };
  draft.bets.polla.total18 = { ...draft.bets.polla.total18, enabled: true, value: 500 };
  draft.presentation = { groupNassauTerm: "nassau" };
  draft.bets.ballFriend = { ...draft.bets.ballFriend, enabled: true };
  draft.bets.vipers = { ...draft.bets.vipers, enabled: true };
  const before = structuredClone(draft);
  const plan = planRoundSetup("Skins mejor a $300.", context({ activeDraft: draft }));

  assert.equal(plan.draft.bets.skins.value, 300);
  assert.deepEqual(plan.draft.bets.polla, before.bets.polla);
  assert.deepEqual(plan.draft.bets.ballFriend, before.bets.ballFriend);
  assert.deepEqual(plan.draft.bets.vipers, before.bets.vipers);
  assert.deepEqual(plan.draft.players, before.players);
  assert.deepEqual(plan.draft.course, before.course);
  assert.equal(plan.draft.presentation?.groupNassauTerm, "nassau");
});

test("ediciones AI conservan tees individuales y el cambio explícito actualiza sólo los tees", () => {
  const draft = createRoundSetupDraft({
    date: "2026-09-07",
    course: laVistaWhite,
    players: roundPlayers,
    ownerId: "said",
    playerTeeAssignments: updatePlayerTeeAssignment(
      assignTeeToEveryPlayer(roundPlayers, laVistaWhite, "2026-09-07T12:00:00.000Z"),
      "juan",
      laVistaBlue,
      "2026-09-07T12:00:00.000Z",
    ),
  });
  draft.bets.skins = { ...draft.bets.skins, enabled: true, value: 200 };
  draft.bets.polla.first9 = { ...draft.bets.polla.first9, enabled: true, value: 500 };
  draft.bets.polla.second9 = { ...draft.bets.polla.second9, enabled: true, value: 500 };
  draft.bets.polla.total18 = { ...draft.bets.polla.total18, enabled: true, value: 500 };
  draft.bets.ballFriend = { ...draft.bets.ballFriend, enabled: true };
  draft.bets.vipers = { ...draft.bets.vipers, enabled: true };

  const skins = planRoundSetup("Cambia únicamente los Skins a $300.", context({ activeDraft: draft, courses: [laVistaWhite, laVistaBlue] }));
  assert.equal(skins.draft.bets.skins.value, 300);
  assert.deepEqual(skins.draft.playerTeeAssignments, draft.playerTeeAssignments);

  const withoutVipers = planRoundSetup("Quita Viboritas y deja todo lo demás igual.", context({ activeDraft: skins.draft, courses: [laVistaWhite, laVistaBlue] }));
  assert.equal(withoutVipers.draft.bets.vipers.enabled, false);
  assert.deepEqual(withoutVipers.draft.playerTeeAssignments, draft.playerTeeAssignments);

  const tees = planRoundSetup("Juan juega azules y los demás blancas.", context({ activeDraft: withoutVipers.draft, courses: [laVistaWhite, laVistaBlue] }));
  assert.deepEqual(
    tees.draft.playerTeeAssignments.map((assignment) => [assignment.playerId, assignment.teeName]),
    [["said", "Blancas"], ["pedro", "Blancas"], ["juan", "Azules"], ["carlos", "Blancas"]],
  );
  assert.equal(tees.draft.course?.id, laVistaWhite.id);
  assert.equal(tees.draft.bets.skins.value, 300);
  assert.equal(tees.draft.bets.polla.first9.value, 500);
  assert.equal(tees.draft.bets.ballFriend.enabled, true);
  assert.equal(tees.draft.bets.vipers.enabled, false);
  assert.deepEqual(tees.draft.players, draft.players);
});

test("‘Mejor Nassau de 300’ actualiza sólo los componentes grupales activos", () => {
  const draft = activeDraft();
  draft.bets.polla.first9 = { ...draft.bets.polla.first9, enabled: true, value: 100 };
  draft.bets.polla.second9 = { ...draft.bets.polla.second9, enabled: false, value: 175 };
  draft.bets.polla.total18 = { ...draft.bets.polla.total18, enabled: false, value: 250 };
  draft.presentation = { groupNassauTerm: "nassau" };
  const original = structuredClone(draft);

  const changed = planRoundSetup("Mejor Nassau de 300.", context({ activeDraft: draft }));

  assert.deepEqual(
    [changed.draft.bets.polla.first9.enabled, changed.draft.bets.polla.first9.value],
    [true, 300],
  );
  assert.deepEqual(changed.draft.bets.polla.second9, original.bets.polla.second9);
  assert.deepEqual(changed.draft.bets.polla.total18, original.bets.polla.total18);
  assert.deepEqual(draft.bets.polla, original.bets.polla, "el cambio no muta el draft de entrada");
  assert.equal(changed.draft.presentation?.groupNassauTerm, "nassau");
  assert.deepEqual(
    changed.actions.find((action) => action.type === "configure_group_nassau")?.componentScope,
    ["first9"],
  );
  assert.equal(changed.canConfirm, true);

  const explicitlyCreated = planRoundSetup("Nassau de 300.", context({ activeDraft: draft }));
  assert.deepEqual(
    [
      explicitlyCreated.draft.bets.polla.first9,
      explicitlyCreated.draft.bets.polla.second9,
      explicitlyCreated.draft.bets.polla.total18,
    ].map((component) => [component.enabled, component.value]),
    [[true, 300], [true, 300], [true, 300]],
    "una instrucción de creación explícita sí configura el Nassau completo de 18 hoyos",
  );
});

test("separa roster, handicaps, campo y salida cuando llegan en una sola frase", () => {
  const parsed = parseRoundSetupIntent(
    "Hoy jugamos Said HCP 10, Pedro HCP 12, Juan HCP 18 y Carlos HCP 20 en La Vista, salimos por el 1, 18 hoyos. Skins de $200.",
  );
  const roster = parsed.actions.find((action) => action.type === "replace_players");
  const selectedCourse = parsed.actions.find((action) => action.type === "select_course");
  assert.deepEqual(roster?.type === "replace_players" ? roster.playerNames : [], ["Said", "Pedro", "Juan", "Carlos"]);
  assert.equal(selectedCourse?.type === "select_course" ? selectedCourse.courseName : "", "La Vista");
  assert.equal(parsed.actions.filter((action) => action.type === "set_player_handicap").length, 4);
  assert.ok(parsed.actions.some((action) => action.type === "set_start_hole" && action.startHole === 1));
  assert.ok(parsed.actions.some((action) => action.type === "set_round_holes" && action.roundHoles === 18));
  const plan = planRoundSetup(parsed.input, context({ frequentPlayers: [] }));
  assert.deepEqual(plan.draft.players.map((player) => [player.name, player.handicap]), [
    ["Said", 10], ["Pedro", 12], ["Juan", 18], ["Carlos", 20],
  ]);
  assert.equal(plan.canConfirm, true);
});

test("HCP con coma decimal o signo plus nunca crea jugadores basura", () => {
  const parsed = parseRoundSetupIntent("Jugamos Said HCP +1,2, Pedro HCP 12,4 en La Vista. Skins de 100.");
  const roster = parsed.actions.find((action) => action.type === "replace_players");
  const handicaps = parsed.actions
    .filter((action): action is Extract<(typeof parsed.actions)[number], { type: "set_player_handicap" }> => action.type === "set_player_handicap")
    .map((action) => [action.playerName, action.handicap]);
  assert.deepEqual(roster?.type === "replace_players" ? roster.playerNames : [], ["Said", "Pedro"]);
  assert.deepEqual(handicaps, [["Said", -1.2], ["Pedro", 12.4]]);

  const points = parseRoundSetupIntent("Jugamos Said HCP +1.2, Pedro HCP 12.4 en La Vista. Skins de 100.");
  const pointRoster = points.actions.find((action) => action.type === "replace_players");
  assert.deepEqual(pointRoster?.type === "replace_players" ? pointRoster.playerNames : [], ["Said", "Pedro"]);

  const sentenceBoundary = parseRoundSetupIntent("Jugamos Said HCP +1.2, Pedro HCP 12.4. Skins de 100.");
  const boundaryRoster = sentenceBoundary.actions.find((action) => action.type === "replace_players");
  assert.deepEqual(boundaryRoster?.type === "replace_players" ? boundaryRoster.playerNames : [], ["Said", "Pedro"]);
});

test("acepta varias formas prefijas HCP de jugador en un solo cambio", () => {
  const parsed = parseRoundSetupIntent("HCP de Said es 8 y HCP de Pedro es 12.");
  assert.deepEqual(parsed.actions
    .filter((action): action is Extract<(typeof parsed.actions)[number], { type: "set_player_handicap" }> => action.type === "set_player_handicap")
    .map((action) => [action.playerName, action.handicap]), [["Said", 8], ["Pedro", 12]]);
});

test("bloquea ajustes HCP o redondeo que una apuesta core no puede representar", () => {
  const hcp = planRoundSetup("Skins de 100 con HCP 80%.", context({ activeDraft: activeDraft() }));
  assert.equal(hcp.draft.bets.skins.value, 100);
  assert.equal(hcp.canConfirm, false);
  assert.ok(hcp.questions.some((question) => question.field === "bets.skins.hcpPct"));

  const rounding = planRoundSetup("Bola Amiga de 200 con .5 sube.", context({ activeDraft: activeDraft() }));
  assert.equal(rounding.canConfirm, false);
  assert.ok(rounding.questions.some((question) => question.field === "bets.ballFriend.decimals"));
});

test("recupera sólo los jugadores del domingo y aplica el cambio explícito de Skins", () => {
  const sunday = snapshot("sunday-round", "2026-09-06", (bets) => {
    bets.rabbits = { ...bets.rabbits, enabled: true, value: 999 };
  });
  const plan = planRoundSetup("Los mismos del domingo pero skins a 200.", context({ history: [sunday] }));

  assert.deepEqual(plan.draft.players.map((player) => player.name), ["Said", "Pedro", "Juan", "Carlos"]);
  assert.equal(plan.draft.bets.skins.enabled, true);
  assert.equal(plan.draft.bets.skins.value, 200);
  assert.equal(plan.draft.bets.rabbits.enabled, false, "‘los mismos’ recupera roster, no apuestas no expresadas");
  assert.equal(plan.memory[0]?.id, "sunday-round");
});

test("‘como la semana pasada’ copia configuración limpia con IDs remapeados", () => {
  const prior = snapshot("prior-round", "2026-09-03", (bets) => {
    bets.skins = { ...bets.skins, enabled: true, value: 275 };
  });
  const plan = planRoundSetup("Como la semana pasada.", context({ history: [prior], idFactory: ids("history") }));

  assert.equal(plan.draft.basedOnRoundId, "prior-round");
  assert.equal(plan.draft.bets.skins.value, 275);
  assert.equal(plan.draft.bets.skins.enabled, true);
  assert.ok(plan.draft.players.every((player) => player.accountUserId || player.id.startsWith("history-")));
  assert.deepEqual(new Set(plan.draft.bets.skins.participantIds), new Set(plan.draft.players.map((player) => player.id)));
  assert.equal("scores" in plan.draft, false);
});

test("memoria legacy deriva salida por H10 y nueve hoyos desde un order válido", () => {
  const prior = snapshot("legacy-h10-nine", "2026-09-03");
  prior.order = Array.from({ length: 9 }, (_, index) => index + 10);
  delete prior.startHole;
  delete prior.roundHoles;

  const plan = planRoundSetup("Como la semana pasada.", context({ history: [prior], idFactory: ids("legacy") }));

  assert.equal(plan.draft.basedOnRoundId, prior.id);
  assert.equal(plan.draft.startHole, 10);
  assert.equal(plan.draft.roundHoles, 9);
});

test("Bola Amiga usa participantes y BallFriendHole reales para parejas explícitas", () => {
  const draft = activeDraft();
  draft.bets.ballFriend = { ...draft.bets.ballFriend, enabled: true, value: 75 };
  const plan = planRoundSetup("Bola Amiga Said/Juan contra Pedro/Carlos.", context({ activeDraft: draft }));

  assert.equal(plan.draft.bets.ballFriend.enabled, true);
  assert.deepEqual(new Set(plan.draft.bets.ballFriend.participantIds), new Set(["said", "juan", "pedro", "carlos"]));
  assert.deepEqual(plan.draft.ballFriendSetup[1]?.teamA, ["said", "juan"]);
  assert.deepEqual(plan.draft.ballFriendSetup[18]?.teamA, ["said", "juan"]);
  assert.equal(plan.questions.some((question) => question.code === "missing_amount"), false);
});

test("una excepción individual sólo cambia participantes de la apuesta mencionada", () => {
  const draft = activeDraft();
  draft.bets.skins = { ...draft.bets.skins, enabled: true, value: 100 };
  draft.bets.polla.first9 = { ...draft.bets.polla.first9, enabled: true, value: 300 };
  const pollaBefore = structuredClone(draft.bets.polla);
  const plan = planRoundSetup("Todos juegan Skins menos Carlos.", context({ activeDraft: draft }));

  assert.deepEqual(plan.draft.bets.skins.participantIds, ["said", "pedro", "juan"]);
  assert.deepEqual(plan.draft.bets.polla, pollaBefore);
  assert.equal(draft.bets.skins.participantIds.includes("carlos"), true, "el executor no muta el draft de entrada");
  assert.equal(plan.questions.some((question) => question.code === "missing_amount"), false);

  const nassau = activeDraft();
  nassau.bets.polla.first9 = { ...nassau.bets.polla.first9, enabled: true, value: 500 };
  nassau.bets.polla.second9 = { ...nassau.bets.polla.second9, enabled: true, value: 500 };
  nassau.bets.polla.total18 = { ...nassau.bets.polla.total18, enabled: true, value: 500 };
  const withoutPedro = planRoundSetup("Pedro hoy no juega Nassau.", context({ activeDraft: nassau }));
  assert.equal(withoutPedro.draft.bets.polla.first9.enabled, true);
  assert.equal(withoutPedro.draft.bets.polla.first9.participantIds.includes("pedro"), false);
});

test("mapea ‘Ventajas entre jugadores’ al basis relative", () => {
  const draft = activeDraft();
  draft.handicapBasis = "course";
  const plan = planRoundSetup("Ventajas entre jugadores.", context({ activeDraft: draft }));
  assert.equal(plan.draft.handicapBasis, "relative");
});

test("‘Quita Nassau’ desactiva Pollas y Nassau individual sin tocar Skins", () => {
  const draft = activeDraft();
  draft.bets.skins = { ...draft.bets.skins, enabled: true, value: 321 };
  draft.bets.polla.first9.enabled = true;
  draft.bets.polla.second9.enabled = true;
  draft.bets.polla.total18.enabled = true;
  const individual = createSupplementalBet("individual_nassau", roundPlayers, "nassau-1");
  draft.supplementalBets = [individual];
  const plan = planRoundSetup("Quita Nassau.", context({ activeDraft: draft }));

  assert.deepEqual([
    plan.draft.bets.polla.first9.enabled,
    plan.draft.bets.polla.second9.enabled,
    plan.draft.bets.polla.total18.enabled,
  ], [false, false, false]);
  assert.equal(plan.draft.supplementalBets[0].enabled, false);
  assert.equal(plan.draft.bets.skins.value, 321);
});

test("cambios parciales de salida y duración preservan el resto del draft", () => {
  const draft = activeDraft();
  draft.bets.skins = { ...draft.bets.skins, enabled: true, value: 180 };
  draft.bets.polla.first9.enabled = true;
  draft.bets.polla.second9.enabled = true;
  draft.bets.polla.total18.enabled = true;

  const start = planRoundSetup("Lo mismo pero ahora salimos por el 10.", context({ activeDraft: draft }));
  assert.equal(start.draft.startHole, 10);
  assert.equal(start.draft.bets.skins.value, 180);
  assert.equal(start.draft.course?.id, draft.course?.id);

  const nine = planRoundSetup("Sólo jugamos 9 hoyos.", context({ activeDraft: draft }));
  assert.equal(nine.draft.roundHoles, 9);
  assert.equal(nine.draft.bets.polla.first9.enabled, true);
  assert.equal(nine.draft.bets.polla.second9.enabled, false);
  assert.equal(nine.draft.bets.polla.total18.enabled, false);
  assert.equal(nine.draft.bets.skins.value, 180);

  const amountOnly = planRoundSetup("Mejor skins de 300.", context({ activeDraft: draft }));
  assert.equal(amountOnly.draft.bets.skins.value, 300);
  assert.deepEqual(amountOnly.draft.bets.polla, draft.bets.polla);
  assert.deepEqual(amountOnly.draft.players, draft.players);
});

test("cambios parciales de tee, HCP y carry se aplican al mismo draft", () => {
  const draft = activeDraft();
  draft.bets.skins = { ...draft.bets.skins, enabled: true, value: 180 };
  const blancas = course("la-vista-blancas", "La Vista", "Blancas");
  const plan = planRoundSetup("Mejor tee Blancas. Pedro HCP 9.5. Skins sin carry.", context({
    activeDraft: draft,
    courses: [laVista, blancas],
  }));

  assert.equal(plan.draft.course?.id, blancas.id);
  assert.equal(plan.draft.players.find((player) => player.id === "pedro")?.handicap, 9.5);
  assert.equal(plan.draft.bets.skins.mode, "no_carry");
  assert.equal(plan.draft.bets.skins.accumulate, false);
  assert.equal(plan.canConfirm, true);
});

test("una instrucción no ejecutable nunca habilita confirmar un draft válido", () => {
  const plan = planRoundSetup("Cambia algo de las apuestas.", context({ activeDraft: activeDraft() }));
  assert.equal(plan.actions.length, 0);
  assert.equal(plan.canConfirm, false);
  assert.ok(plan.questions.some((question) => question.field === "instruction"));
});

test("una preferencia confirmada excluye al jugador y una orden explícita la reemplaza", () => {
  const draft = activeDraft();
  draft.bets.skins = { ...draft.bets.skins, enabled: true, value: 100 };
  const now = "2026-09-07T12:00:00.000Z";
  const preference: UserPreference = {
    recordType: "USER_PREFERENCE",
    schemaVersion: 1,
    id: "pedro-never-skins",
    ownerId: profile.userId,
    key: "bet.participation",
    value: { playerName: "Pedro", participates: false },
    context: { region: "MX", gameKey: "skins" },
    origin: "CORRECTION",
    status: "CONFIRMED",
    confidence: 1,
    createdAt: now,
    updatedAt: now,
    confirmedAt: now,
    useCount: 0,
    dataScope: "PERSONAL",
    trainingUse: "EXCLUDED",
  };

  const remembered = planRoundSetup("Mejor skins de 200.", context({ activeDraft: draft, userPreferences: [preference] }));
  assert.deepEqual(remembered.draft.bets.skins.participantIds, ["said", "juan", "carlos"]);
  assert.ok(remembered.memory.some((entry) => entry.id === preference.id));

  const overridden = planRoundSetup("Todos juegan Skins.", context({ activeDraft: remembered.draft, userPreferences: [preference] }));
  assert.deepEqual(overridden.draft.bets.skins.participantIds, ["said", "pedro", "juan", "carlos"]);
});

test("pregunta únicamente por nombres y campos desconocidos o ambiguos", () => {
  const homonyms: FrequentPlayer[] = [
    ...frequentPlayers,
    { id: "juan-perez", name: "Juan Pérez", handicap: 11, uses: 1, updatedAt: "2026-09-01" },
    { id: "juan-lopez", name: "Juan López", handicap: 13, uses: 1, updatedAt: "2026-09-01" },
  ].filter((player) => player.name !== "Juan");
  const ambiguousPlayer = planRoundSetup("Jugamos Said y Juan.", context({ frequentPlayers: homonyms }));
  assert.ok(ambiguousPlayer.questions.some((question) => question.code === "ambiguous_player"));

  const unknownPlayer = planRoundSetup("Jugamos Said y Roberto.", context());
  assert.equal(unknownPlayer.questions.some((question) => question.code === "unknown_player"), false);
  assert.deepEqual(unknownPlayer.draft.players.map((player) => [player.name, player.handicap]), [["Said", 8], ["Roberto", null]]);

  const ambiguousCourse = planRoundSetup(
    "Jugamos Said y Pedro en La Vista.",
    context({ profile: { ...profile, preferredTee: "" }, courses: [laVista, course("la-vista-blancas", "La Vista", "Blancas")] }),
  );
  assert.ok(ambiguousCourse.questions.some((question) => question.code === "ambiguous_course"));

  const unknownCourse = planRoundSetup("Jugamos Said y Pedro en Campo Fantasma.", context());
  assert.ok(unknownCourse.questions.some((question) => question.code === "unknown_course"));
});

test("un jugador nuevo queda temporal y su HCP se completa sin rehacer la ronda", () => {
  const first = planRoundSetup("Jugamos Said, Pedro y Roberto. Skins de 100.", context());
  const question = first.questions.find((candidate) => candidate.code === "missing_player_handicaps");
  assert.deepEqual(question?.playerTargets?.map((player) => player.label), ["Roberto"]);
  assert.deepEqual(first.draft.players.map((player) => player.name), ["Said", "Pedro", "Roberto"]);
  assert.equal(first.draft.players.find((player) => player.name === "Roberto")?.handicap, null);

  const syntheticUnknown = { code: "unknown_player" as const, field: "players.Roberto", prompt: "¿Quién es Roberto y qué HCP juega?" };
  assert.deepEqual(parseUnknownPlayerClarification(syntheticUnknown, "Roberto HCP 18.4"), { name: "Roberto", handicap: 18.4 });
  assert.deepEqual(parseUnknownPlayerClarification(syntheticUnknown, "Roberto HCP +2.4"), { name: "Roberto", handicap: -2.4 });
  assert.deepEqual(parseUnknownPlayerClarification(syntheticUnknown, "18"), { name: "Roberto", handicap: 18 });
  assert.equal(parseUnknownPlayerClarification(syntheticUnknown, "Roberto"), null);
  assert.deepEqual(parseUnknownPlayerClarification(syntheticUnknown, "Roberto HCP 80"), { name: "Roberto", handicap: 36 });

  const replay = planRoundSetup("Roberto HCP 18.4.", context({
    activeDraft: first.draft,
  }));
  assert.equal(replay.questions.some((candidate) => candidate.code === "missing_player_handicaps"), false);
  assert.deepEqual(replay.draft.players.map((player) => player.name), ["Said", "Pedro", "Roberto"]);
  assert.equal(replay.draft.players.find((player) => player.name === "Roberto")?.handicap, 18.4);
  assert.equal(replay.draft.bets.skins.value, 100);
  assert.equal(replay.draft.course?.id, laVista.id);
});

test("monto faltante y términos sin mapeo real generan pregunta, nunca una modalidad ficticia", () => {
  const missingAmount = planRoundSetup("Jugamos Said y Pedro. Skins.", context());
  assert.ok(missingAmount.questions.some((question) => question.code === "missing_amount" && question.field === "bets.skins.value"));
  assert.equal(missingAmount.draft.bets.skins.enabled, false, "una apuesta incompleta no se activa con el monto default");

  const unknown = parseRoundSetupIntent("Agrega Calcuta de 100.");
  assert.ok(unknown.questions.some((question) => question.code === "unknown_bet"));
  assert.equal(unknown.actions.length, 0);

  const mixed = parseRoundSetupIntent("Skins de 100 y Calcuta de 50.");
  assert.ok(mixed.actions.some((action) => action.type === "configure_core_bet" && action.bet === "skins"));
  assert.ok(mixed.questions.some((question) => question.code === "unknown_bet"));

  for (const [phrase, field] of [
    ["Jugamos Presses.", "bets.pressures"],
    ["Agrega Oyes.", "bets.oyes"],
    ["También Personales.", "bets.personales"],
  ]) {
    const parsed = parseRoundSetupIntent(phrase);
    assert.ok(parsed.questions.some((question) => question.field === field), phrase);
  }
});

test("Nassau con el principal usa PersonalBet canónica; otra pareja conserva la modalidad real representable", () => {
  const plan = planRoundSetup("Nassau Said contra Pedro de 500.", context({ activeDraft: activeDraft() }));
  const personal = plan.draft.personalBets[0];
  assert.equal(personal.rivalMode, "group");
  assert.equal(personal.rivalPlayerId, "pedro");
  assert.equal(personal.baseValue, 500);
  assert.equal(plan.draft.supplementalBets.length, 0);
  assert.equal(plan.draft.bets.polla.first9.enabled, false);

  const otherPair = planRoundSetup("Nassau Pedro contra Juan de 300.", context({ activeDraft: activeDraft() }));
  const supplemental = otherPair.draft.supplementalBets.find((bet) => bet.type === "individual_nassau");
  assert.ok(supplemental && supplemental.type === "individual_nassau");
  assert.deepEqual(new Set([supplemental.playerAId, supplemental.playerBId]), new Set(["pedro", "juan"]));
  assert.equal(supplemental.value, 300);
});

test("‘Mejor Nassau’ actualiza la única instancia personal activa sin crear Nassau grupal", () => {
  const configured = planRoundSetup("Nassau Said contra Pedro de 500.", context({ activeDraft: activeDraft() }));
  const changed = planRoundSetup("Mejor Nassau de 300.", context({ activeDraft: configured.draft }));

  assert.equal(changed.draft.personalBets.length, 1);
  assert.equal(changed.draft.personalBets[0].rivalPlayerId, "pedro");
  assert.equal(changed.draft.personalBets[0].baseValue, 300);
  assert.deepEqual([
    changed.draft.bets.polla.first9.enabled,
    changed.draft.bets.polla.second9.enabled,
    changed.draft.bets.polla.total18.enabled,
  ], [false, false, false]);
  assert.equal(changed.canConfirm, true);
});

test("‘Mejor Nassau’ pregunta la pareja si existen varias instancias personales", () => {
  const first = planRoundSetup("Nassau Said contra Pedro de 500.", context({ activeDraft: activeDraft() }));
  const second = planRoundSetup("Nassau Said contra Juan de 400.", context({ activeDraft: first.draft }));
  const changed = planRoundSetup("Mejor Nassau de 300.", context({ activeDraft: second.draft }));

  assert.deepEqual(changed.draft.personalBets.map((bet) => bet.baseValue), [500, 400]);
  assert.equal(changed.draft.bets.polla.first9.enabled, false);
  assert.ok(changed.questions.some((question) => question.field === "supplementalBets.individual_nassau.instance"));
  assert.equal(changed.canConfirm, false);
});

test("configura una sola Polla explícita sin convertirla en Nassau grupal", () => {
  const plan = planRoundSetup("Polla de la primera vuelta de 250.", context({ activeDraft: activeDraft() }));

  assert.deepEqual([
    plan.draft.bets.polla.first9.enabled,
    plan.draft.bets.polla.second9.enabled,
    plan.draft.bets.polla.total18.enabled,
  ], [true, false, false]);
  assert.equal(plan.draft.bets.polla.first9.value, 250);
  assert.equal(plan.questions.some((question) => question.field === "bets.polla.variant"), false);
  assert.equal(plan.canConfirm, true);
});

test("cada componente Polla toma sólo su monto, incluso junto a Skins o a otra Polla", () => {
  const mixed = planRoundSetup("Skins de 100 y Polla segunda vuelta de 500.", context({ activeDraft: activeDraft() }));
  assert.equal(mixed.draft.bets.skins.value, 100);
  assert.equal(mixed.draft.bets.polla.second9.value, 500);
  assert.equal(mixed.draft.bets.polla.first9.enabled, false);

  const total = planRoundSetup("Polla total de 18 hoyos de 700.", context({ activeDraft: activeDraft() }));
  assert.equal(total.draft.bets.polla.total18.value, 700);

  const two = planRoundSetup("Polla primera vuelta de 200 y Polla segunda vuelta de 300.", context({ activeDraft: activeDraft() }));
  assert.equal(two.draft.bets.polla.first9.value, 200);
  assert.equal(two.draft.bets.polla.second9.value, 300);
  assert.equal(two.draft.bets.polla.total18.enabled, false);
});

test("quitar una Polla no apaga otra configurada en la misma instrucción", () => {
  const draft = activeDraft();
  draft.bets.polla.first9 = { ...draft.bets.polla.first9, enabled: true, value: 100 };
  const plan = planRoundSetup("Quita Polla primera vuelta y Polla segunda vuelta de 250.", context({ activeDraft: draft }));
  assert.equal(plan.draft.bets.polla.first9.enabled, false);
  assert.equal(plan.draft.bets.polla.second9.enabled, true);
  assert.equal(plan.draft.bets.polla.second9.value, 250);
});

test("quitar una lista coordinada de componentes Polla propaga la intención", () => {
  const draft = activeDraft();
  draft.bets.polla.first9 = { ...draft.bets.polla.first9, enabled: true, value: 100 };
  draft.bets.polla.second9 = { ...draft.bets.polla.second9, enabled: true, value: 200 };
  const plan = planRoundSetup("Quita Polla primera vuelta y Polla segunda vuelta.", context({ activeDraft: draft }));
  assert.equal(plan.draft.bets.polla.first9.enabled, false);
  assert.equal(plan.draft.bets.polla.second9.enabled, false);
});

test("Dollar a Stroke conserva pareja y monto en la entidad suplementaria real", () => {
  const plan = planRoundSetup("Dollar a Stroke Said contra Pedro de 20.", context({ activeDraft: activeDraft() }));
  const bet = plan.draft.supplementalBets.find((candidate) => candidate.type === "dollar_stroke");

  assert.ok(bet && bet.type === "dollar_stroke");
  assert.deepEqual(new Set([bet.playerAId, bet.playerBId]), new Set(["said", "pedro"]));
  assert.equal(bet.valuePerStroke, 20);
  assert.equal(plan.canConfirm, true);
});

test("Presiones individuales y por parejas usan configuración canónica, carry y equipos", () => {
  const individualPlan = planRoundSetup("Presiones individuales de 150 sin carry.", context({ activeDraft: activeDraft() }));
  const individual = individualPlan.draft.supplementalBets.find((candidate) => candidate.type === "individual_pressures");
  assert.ok(individual && individual.type === "individual_pressures");
  assert.equal(individual.value, 150);
  assert.equal(individual.carryEnabled, false);
  assert.deepEqual(new Set(individual.participantIds), new Set(roundPlayers.map((player) => player.id)));

  const teamPlan = planRoundSetup(
    "Presiones por parejas Said/Juan contra Pedro/Carlos de 200 con carry.",
    context({ activeDraft: activeDraft() }),
  );
  const team = teamPlan.draft.supplementalBets.find((candidate) => candidate.type === "team_pressures");
  assert.ok(team && team.type === "team_pressures");
  assert.equal(team.value, 200);
  assert.equal(team.carryEnabled, true);
  assert.deepEqual(new Set(team.teamA), new Set(["said", "juan"]));
  assert.deepEqual(new Set(team.participantIds), new Set(roundPlayers.map((player) => player.id)));
  assert.equal(teamPlan.canConfirm, true);
});

test("presión singular y equipos son alias mexicanos completos, incluso al quitar", () => {
  const individual = planRoundSetup("Presión individual de 75.", context({ activeDraft: activeDraft() }));
  assert.equal(individual.draft.supplementalBets.some((bet) => bet.type === "individual_pressures" && bet.enabled && bet.value === 75), true);

  const configured = planRoundSetup("Presiones por equipos Said/Juan contra Pedro/Carlos de 90.", context({ activeDraft: activeDraft() }));
  const removed = planRoundSetup("Quita presiones por equipos.", context({ activeDraft: configured.draft }));
  assert.equal(removed.draft.supplementalBets.some((bet) => bet.type === "team_pressures" && bet.enabled), false);
});

test("Chicago, Vegas y Menos Putts llenan los mismos modelos del modo manual", () => {
  const chicagoPlan = planRoundSetup("Chicago de 15.", context({ activeDraft: activeDraft() }));
  const chicago = chicagoPlan.draft.supplementalBets.find((candidate) => candidate.type === "chicago");
  assert.ok(chicago && chicago.type === "chicago");
  assert.equal(chicago.valuePerPoint, 15);

  const vegasPlan = planRoundSetup(
    "Vegas Said/Juan contra Pedro/Carlos de 10.",
    context({ activeDraft: activeDraft() }),
  );
  const vegas = vegasPlan.draft.supplementalBets.find((candidate) => candidate.type === "vegas");
  assert.ok(vegas && vegas.type === "vegas");
  assert.equal(vegas.valuePerUnit, 10);
  assert.deepEqual(new Set(vegas.teamA), new Set(["said", "juan"]));

  const puttsPlan = planRoundSetup("Menos Putts de 100.", context({ activeDraft: activeDraft() }));
  const putts = puttsPlan.draft.supplementalBets.find((candidate) => candidate.type === "minimum_putts");
  assert.ok(putts && putts.type === "minimum_putts");
  assert.equal(putts.ante, 100);
  assert.equal(putts.holes, 18);
  assert.equal(chicagoPlan.canConfirm && vegasPlan.canConfirm && puttsPlan.canConfirm, true);
});

test("Dollar a Stroke aplica y elimina una ventaja explícita sin defaults silenciosos", () => {
  const configured = planRoundSetup(
    "Dollar a Stroke Said contra Pedro de 20 con 3 golpes de ventaja para Pedro.",
    context({ activeDraft: activeDraft() }),
  );
  const dollar = configured.draft.supplementalBets.find((bet) => bet.type === "dollar_stroke");
  assert.ok(dollar && dollar.type === "dollar_stroke");
  assert.equal(dollar.advantageStrokes, 3);
  assert.equal(dollar.advantageReceiverId, "pedro");
  assert.equal(configured.canConfirm, true);

  const cleared = planRoundSetup("Dollar a Stroke Said contra Pedro sin ventaja.", context({ activeDraft: configured.draft }));
  const clearedDollar = cleared.draft.supplementalBets.find((bet) => bet.type === "dollar_stroke");
  assert.ok(clearedDollar && clearedDollar.type === "dollar_stroke");
  assert.equal(clearedDollar.advantageStrokes, 0);
  assert.equal(clearedDollar.advantageReceiverId, undefined);

  const incomplete = planRoundSetup(
    "Dollar a Stroke Said contra Pedro de 20 con ventaja para Pedro.",
    context({ activeDraft: activeDraft() }),
  );
  assert.equal(incomplete.canConfirm, false);
  assert.ok(incomplete.questions.some((question) => question.field === "supplementalBets.dollar_stroke.advantage"));
});

test("Presiones aplica HCP, redondeo y Match Play sólo donde existen", () => {
  const individualPlan = planRoundSetup(
    "Presiones individuales de 150 con HCP al 80%, .5 baja, con Match Play y sin carry.",
    context({ activeDraft: activeDraft() }),
  );
  const individual = individualPlan.draft.supplementalBets.find((bet) => bet.type === "individual_pressures");
  assert.ok(individual && individual.type === "individual_pressures");
  assert.equal(individual.hcpPct, 80);
  assert.equal(individual.decimals, "half_down");
  assert.equal(individual.matchPlayEnabled, true);
  assert.equal(individual.carryEnabled, false);
  assert.equal(individualPlan.canConfirm, true);

  const teamPlan = planRoundSetup(
    "Presiones por parejas Said/Juan contra Pedro/Carlos de 200 con HCP 75% y decimales.",
    context({ activeDraft: activeDraft() }),
  );
  const team = teamPlan.draft.supplementalBets.find((bet) => bet.type === "team_pressures");
  assert.ok(team && team.type === "team_pressures");
  assert.equal(team.hcpPct, 75);
  assert.equal(team.decimals, "decimal");
  assert.equal(teamPlan.canConfirm, true);

  const unsupported = planRoundSetup(
    "Presiones por parejas Said/Juan contra Pedro/Carlos de 200 con Match Play.",
    context({ activeDraft: activeDraft() }),
  );
  assert.equal(unsupported.canConfirm, false);
  assert.ok(unsupported.questions.some((question) => question.field === "supplementalBets.team_pressures.matchPlayEnabled"));
});

test("Chicago aplica cuota, HCP y tabla etiquetada; una tabla posicional queda bloqueada", () => {
  const configured = planRoundSetup(
    "Chicago de 15 con cuota base 36, HCP 80%, puntos birdie 5, par 3, bogey 1, doble -1.",
    context({ activeDraft: activeDraft() }),
  );
  const chicago = configured.draft.supplementalBets.find((bet) => bet.type === "chicago");
  assert.ok(chicago && chicago.type === "chicago");
  assert.equal(chicago.valuePerPoint, 15);
  assert.equal(chicago.quotaBase, 36);
  assert.equal(chicago.hcpPct, 80);
  assert.deepEqual(chicago.points, { birdieOrBetter: 5, par: 3, bogey: 1, doubleBogeyOrWorse: -1 });
  assert.equal(configured.canConfirm, true);

  const positional = planRoundSetup("Chicago de 15 con tabla 4/2/1/0.", context({ activeDraft: activeDraft() }));
  assert.equal(positional.canConfirm, false);
  assert.ok(positional.questions.some((question) => question.field === "supplementalBets.chicago.points"));
});

test("Vegas aplica rotación, bloques, penalty y HCP; tamaños ambiguos no confirman", () => {
  const configured = planRoundSetup(
    "Vegas Said/Juan contra Pedro/Carlos de 10 con rotación por bloques de 6 hoyos, HCP 80%, .6 sube, con penalty birdie vs bogey.",
    context({ activeDraft: activeDraft() }),
  );
  const vegas = configured.draft.supplementalBets.find((bet) => bet.type === "vegas");
  assert.ok(vegas && vegas.type === "vegas");
  assert.equal(vegas.rotation, "blocks");
  assert.equal(vegas.blockSize, 6);
  assert.equal(vegas.hcpPct, 80);
  assert.equal(vegas.decimals, "six_up");
  assert.equal(vegas.birdiePenalty, true);
  assert.equal(configured.canConfirm, true);

  const partial = planRoundSetup("Vegas cada hoyo sin penalty de birdie.", context({ activeDraft: configured.draft }));
  const updatedVegas = partial.draft.supplementalBets.find((bet) => bet.type === "vegas");
  assert.ok(updatedVegas && updatedVegas.type === "vegas");
  assert.equal(updatedVegas.rotation, "each_hole");
  assert.equal(updatedVegas.birdiePenalty, false);
  assert.equal(updatedVegas.valuePerUnit, 10);

  const invalidBlock = planRoundSetup(
    "Vegas Said/Juan contra Pedro/Carlos de 10 por bloques de 4 hoyos.",
    context({ activeDraft: activeDraft() }),
  );
  assert.equal(invalidBlock.canConfirm, false);
  assert.ok(invalidBlock.questions.some((question) => question.field === "supplementalBets.vegas.blockSize"));
});

test("Polla y Nassau grupal aplican su porcentaje y redondeo propios", () => {
  const component = planRoundSetup(
    "Polla de la primera vuelta de 250 con HCP 75% y decimales cuentan.",
    context({ activeDraft: activeDraft() }),
  );
  assert.equal(component.draft.bets.polla.first9.hcpPct, 75);
  assert.equal(component.draft.bets.polla.first9.decimals, "partial");
  assert.equal(component.canConfirm, true);

  const group = planRoundSetup("Nassau de 500 con HCP 80% y redondear.", context({ activeDraft: activeDraft() }));
  for (const polla of [group.draft.bets.polla.first9, group.draft.bets.polla.second9, group.draft.bets.polla.total18]) {
    assert.equal(polla.hcpPct, 80);
    assert.equal(polla.decimals, "round");
  }
  assert.equal(group.canConfirm, true);

  const ambiguous = planRoundSetup(
    "Polla primera vuelta de 250 con redondeo bancario.",
    context({ activeDraft: activeDraft() }),
  );
  assert.equal(ambiguous.canConfirm, false);
  assert.ok(ambiguous.questions.some((question) => question.field === "bets.polla.first9.decimals"));
});

test("Nassau individual incompleto nunca cae silenciosamente en Nassau grupal", () => {
  const plan = planRoundSetup("Nassau individual de 500.", context({ activeDraft: activeDraft() }));

  assert.equal(plan.interpretation.actions.some((action) => action.type === "configure_group_nassau"), false);
  assert.equal(plan.draft.bets.polla.first9.enabled, false);
  assert.equal(plan.draft.bets.polla.second9.enabled, false);
  assert.equal(plan.draft.bets.polla.total18.enabled, false);
  assert.ok(plan.questions.some((question) => question.field === "supplementalBets.individual_nassau.players"));
  assert.equal(plan.canConfirm, false);
});

test("una exclusión de Nassau conserva por separado los rosters divergentes de cada componente", () => {
  const draft = activeDraft();
  draft.bets.polla.first9 = { ...draft.bets.polla.first9, enabled: true, value: 100, participantIds: ["said", "pedro", "juan", "carlos"] };
  draft.bets.polla.second9 = { ...draft.bets.polla.second9, enabled: true, value: 200, participantIds: ["said", "pedro", "juan"] };
  draft.bets.polla.total18 = { ...draft.bets.polla.total18, enabled: true, value: 300, participantIds: ["said", "pedro", "carlos"] };

  const plan = planRoundSetup("Carlos hoy no juega Nassau.", context({ activeDraft: draft }));

  assert.deepEqual(plan.draft.bets.polla.first9.participantIds, ["said", "pedro", "juan"]);
  assert.deepEqual(plan.draft.bets.polla.second9.participantIds, ["said", "pedro", "juan"]);
  assert.deepEqual(plan.draft.bets.polla.total18.participantIds, ["said", "pedro"]);
  assert.deepEqual(
    [plan.draft.bets.polla.first9.value, plan.draft.bets.polla.second9.value, plan.draft.bets.polla.total18.value],
    [100, 200, 300],
  );
});

test("Nassau grupal con carry, press o multiplicador no confirma con defaults inventados", () => {
  for (const input of ["Nassau de 500 con carry.", "Nassau de 500 con presión 3x.", "Nassau de 500 con multiplicador 2x."]) {
    const plan = planRoundSetup(input, context({ activeDraft: activeDraft() }));
    assert.equal(plan.draft.bets.polla.first9.value, 500, input);
    assert.ok(plan.questions.some((question) => question.field === "bets.polla.advanced"), input);
    assert.equal(plan.questions.some((question) => question.field === "bets.pressures"), false, input);
    assert.equal(plan.canConfirm, false, input);
  }
});

test("una suplementaria incompleta pregunta sólo el dato faltante", () => {
  const missingPair = planRoundSetup("Dollar a Stroke de 20.", context({ activeDraft: activeDraft() }));
  assert.ok(missingPair.questions.some((question) => question.field === "supplementalBets.dollar_stroke.players"));
  assert.equal(missingPair.canConfirm, false);

  const missingTeams = planRoundSetup("Vegas de 10.", context({ activeDraft: activeDraft() }));
  assert.ok(missingTeams.questions.some((question) => question.field === "supplementalBets.vegas.teams"));
  assert.equal(missingTeams.canConfirm, false);

  const missingAmount = planRoundSetup("Chicago.", context({ activeDraft: activeDraft() }));
  assert.ok(missingAmount.questions.some((question) => question.field === "supplementalBets.chicago.value"));
  assert.equal(missingAmount.canConfirm, false);
});

test("carry y montos quedan acotados a cada modalidad dentro de una sola instrucción", () => {
  const plan = planRoundSetup(
    "Skins de 100 con carry y Presiones individuales de 200 sin carry. Chicago de 10 y Menos Putts de 50.",
    context({ activeDraft: activeDraft() }),
  );
  const pressures = plan.draft.supplementalBets.find((candidate) => candidate.type === "individual_pressures");
  const chicago = plan.draft.supplementalBets.find((candidate) => candidate.type === "chicago");
  const putts = plan.draft.supplementalBets.find((candidate) => candidate.type === "minimum_putts");

  assert.equal(plan.draft.bets.skins.value, 100);
  assert.equal(plan.draft.bets.skins.mode, "carry");
  assert.ok(pressures && pressures.type === "individual_pressures");
  assert.equal(pressures.value, 200);
  assert.equal(pressures.carryEnabled, false);
  assert.ok(chicago && chicago.type === "chicago");
  assert.equal(chicago.valuePerPoint, 10);
  assert.ok(putts && putts.type === "minimum_putts");
  assert.equal(putts.ante, 50);
});

test("cambiar sólo el monto de una suplementaria preserva participantes excluidos", () => {
  const draft = activeDraft();
  const pressures = createSupplementalBet("individual_pressures", roundPlayers, "pressures-existing");
  const chicago = createSupplementalBet("chicago", roundPlayers, "chicago-existing");
  const putts = createSupplementalBet("minimum_putts", roundPlayers, "putts-existing");
  if (pressures.type !== "individual_pressures" || chicago.type !== "chicago" || putts.type !== "minimum_putts") throw new Error("fixture inválido");
  pressures.participantIds = ["said", "pedro", "juan"];
  chicago.participantIds = ["said", "pedro", "juan"];
  putts.participantIds = ["said", "pedro", "juan"];
  draft.supplementalBets = [pressures, chicago, putts];

  const updated = planRoundSetup(
    "Presiones individuales a 220. Chicago a 25. Menos Putts a 80.",
    context({ activeDraft: draft }),
  );
  for (const bet of updated.draft.supplementalBets) {
    if (bet.type === "individual_pressures" || bet.type === "chicago" || bet.type === "minimum_putts") {
      assert.deepEqual(bet.participantIds, ["said", "pedro", "juan"]);
    }
  }
});

test("una suplementaria repetida se modifica o elimina sólo por su identidad explícita", () => {
  const draft = activeDraft();
  const first = createSupplementalBet("dollar_stroke", roundPlayers, "dollar-said-pedro");
  const second = createSupplementalBet("dollar_stroke", roundPlayers, "dollar-juan-carlos");
  if (first.type !== "dollar_stroke" || second.type !== "dollar_stroke") throw new Error("fixture inválido");
  first.playerAId = "said"; first.playerBId = "pedro"; first.valuePerStroke = 10;
  second.playerAId = "juan"; second.playerBId = "carlos"; second.valuePerStroke = 20;
  draft.supplementalBets = [first, second];

  const changed = planRoundSetup("Dollar a Stroke Juan contra Carlos de 35.", context({ activeDraft: draft }));
  const unchangedFirst = changed.draft.supplementalBets.find((bet) => bet.id === first.id);
  const changedSecond = changed.draft.supplementalBets.find((bet) => bet.id === second.id);
  assert.ok(unchangedFirst?.type === "dollar_stroke" && changedSecond?.type === "dollar_stroke");
  assert.equal(unchangedFirst.valuePerStroke, 10);
  assert.equal(changedSecond.valuePerStroke, 35);

  const removed = planRoundSetup("Quita Dollar a Stroke Juan contra Carlos.", context({ activeDraft: changed.draft }));
  assert.equal(removed.draft.supplementalBets.find((bet) => bet.id === first.id)?.enabled, true);
  assert.equal(removed.draft.supplementalBets.find((bet) => bet.id === second.id)?.enabled, false);

  const ambiguous = planRoundSetup("Dollar a Stroke de 50.", context({ activeDraft: draft }));
  assert.ok(ambiguous.questions.some((question) => question.field === "supplementalBets.dollar_stroke.instance"));
  const ambiguousFirst = ambiguous.draft.supplementalBets.find((bet) => bet.id === first.id);
  const ambiguousSecond = ambiguous.draft.supplementalBets.find((bet) => bet.id === second.id);
  assert.ok(ambiguousFirst?.type === "dollar_stroke" && ambiguousSecond?.type === "dollar_stroke");
  assert.equal(ambiguousFirst.valuePerStroke, 10);
  assert.equal(ambiguousSecond.valuePerStroke, 20);
});

test("con separa modalidades y no permite que un monto contamine la siguiente", () => {
  const plan = planRoundSetup("Skins de 100 con Chicago de 25.", context({ activeDraft: activeDraft() }));
  const chicago = plan.draft.supplementalBets.find((bet) => bet.type === "chicago");
  assert.equal(plan.draft.bets.skins.value, 100);
  assert.ok(chicago && chicago.type === "chicago");
  assert.equal(chicago.valuePerPoint, 25);
});

test("una exclusión parcial conserva el subconjunto previo salvo que diga todos", () => {
  const draft = activeDraft();
  draft.bets.skins = { ...draft.bets.skins, enabled: true, value: 100, participantIds: ["said", "pedro"] };
  draft.bets.polla.first9 = { ...draft.bets.polla.first9, enabled: true, value: 200, participantIds: ["said", "pedro"] };
  const chicago = createSupplementalBet("chicago", roundPlayers, "chicago-subset");
  if (chicago.type !== "chicago") throw new Error("fixture inválido");
  chicago.participantIds = ["said", "pedro", "carlos"];
  draft.supplementalBets = [chicago];

  const partial = planRoundSetup("Pedro hoy no juega Skins. Pedro hoy no juega Nassau. Chicago menos Carlos.", context({ activeDraft: draft }));
  assert.deepEqual(partial.draft.bets.skins.participantIds, ["said"]);
  assert.deepEqual(partial.draft.bets.polla.first9.participantIds, ["said"]);
  const changedChicago = partial.draft.supplementalBets.find((bet) => bet.id === chicago.id);
  assert.ok(changedChicago && changedChicago.type === "chicago");
  assert.deepEqual(changedChicago.participantIds, ["said", "pedro"]);

  const explicitAll = planRoundSetup("Todos juegan Skins menos Carlos.", context({ activeDraft: draft }));
  assert.deepEqual(new Set(explicitAll.draft.bets.skins.participantIds), new Set(["said", "pedro", "juan"]));
});

test("un grupo frecuente reutiliza GroupGameTemplate y remapea todos sus IDs", () => {
  const memberIds = ["member-said", "member-pedro", "member-juan", "member-carlos"];
  const templatePlayers: Player[] = memberIds.map((id, index) => ({
    id,
    name: roundPlayers[index].name,
    handicap: roundPlayers[index].handicap,
    ...(index === 0 ? { accountUserId: "user-said" } : {}),
  }));
  const bets = initialBets(memberIds);
  bets.skins = { ...bets.skins, enabled: true, value: 240 };
  const gameTemplate = createGroupGameTemplate({
    ownerId: memberIds[0],
    players: templatePlayers,
    startHole: 10,
    roundHoles: 18,
    roundHandicapBasis: "relative",
    bets,
    segments: [],
    personalBets: [],
    supplementalBets: [],
    manualBets: [],
  }, Object.fromEntries(memberIds.map((id) => [id, id])));
  const group: FrequentGroup = {
    id: "wednesday-group",
    name: "Los Miércoles",
    players: templatePlayers.map((player) => ({
      memberId: player.id,
      name: player.name,
      handicap: player.handicap,
      ...(player.accountUserId ? { accountUserId: player.accountUserId } : {}),
    })),
    gameTemplate,
    uses: 12,
    updatedAt: "2026-09-06T12:00:00Z",
  };
  const plan = planRoundSetup("Como el grupo Los Miércoles.", context({ frequentGroups: [group], idFactory: ids("group") }));

  assert.equal(plan.draft.bets.skins.value, 240);
  assert.equal(plan.draft.startHole, 10);
  assert.ok(plan.draft.players.every((player) => player.accountUserId || player.id.startsWith("group-")));
  assert.deepEqual(new Set(plan.draft.bets.skins.participantIds), new Set(plan.draft.players.map((player) => player.id)));
  assert.equal(plan.memory.some((entry) => entry.id === group.id), true);
});
