"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useViewScrollReset } from "./use-view-scroll-reset";
import { CatalogCoursePicker } from './catalog-course-picker';
import { DevicePermissions } from './device-permissions';
import { saveOnboardingCheckpoint } from '../../lib/onboarding-checkpoint';
import {
  GOLF_IMPROVEMENT_GOALS,
  GOLF_PRIMARY_GOALS,
  clampBackyardHandicap,
  profileHandicapInput,
  type BackyardProfile,
  type BackyardProfileUpdate,
  type GolfImprovementGoal,
  type GolfPrimaryGoal,
} from "../../lib/account-state";
import {
  advanceBetaOnboarding,
  betaOnboardingDraftStorageKey,
  completeBetaOnboarding,
  createBetaOnboardingProgress,
  navigateBetaOnboarding,
  persistBetaOnboardingProgress,
  readBetaOnboardingProgress,
  type BetaOnboardingProgress,
  type BetaOnboardingStep,
} from "../../lib/beta-onboarding";
import { groupTemplateConfigurationIssues } from "../../lib/group-template-editor";
import { mergeAcceptedGroupMembers, saveExplicitGroupSnapshot } from "../../lib/group-invitation-sync";
import { addFrequentGroupMember, parseFrequentGroups, serializeFrequentGroups } from "../../lib/frequent-templates";
import { normalizeGroupGameTemplate, templateWithoutPlayerAssignments } from "../../lib/group-game-template";
import { initialBets } from "../../lib/new-round-bets";
import { PLAN_CATALOG, selectablePlanId, type PlanId } from "../../lib/plans";
import { STORAGE_KEYS, readStoredJson } from "../../lib/round-utils";
import { playOrder, segmentDefinitions } from "../../lib/engine";
import type { FrequentGroup, FrequentGroupMember, FrequentPlayer, GroupGameTemplate, Player } from "../../lib/types";
import { ballFitDefaultsFromProfile } from "../../lib/ball-fitting";
import { BrandLockup } from "./brand-lockup";
import { EquipmentOnboarding } from "./equipment-onboarding";
import { GroupBetTemplateEditor } from "./group-bet-template-editor";
import { GroupInviteManager } from "./group-invitations";
import { ProfileImagePicker } from "./profile-image-picker";
import { HandicapSourceSelector } from "./handicap-source-selector";
import { PlayerHandicapControl } from "./player-handicap-control";
import { ModalShell } from "./modal-shell";
import { activeGroupTemplateDefinitions } from "../../lib/group-template-editor";
import styles from "./beta-onboarding-flow.module.css";

const IMPROVEMENT_LABELS: Record<GolfImprovementGoal, string> = {
  DRIVER: "Driver",
  IRONS: "Hierros",
  APPROACH: "Approach",
  SHORT_GAME: "Juego corto",
  BUNKER: "Bunker",
  PUTTING: "Putting",
  CONSISTENCY: "Consistencia",
  COURSE_STRATEGY: "Estrategia de campo",
  MENTAL_CONFIDENCE: "Mental / confianza",
  LOWER_HANDICAP: "Bajar mi HCP",
};

const GOAL_LABELS: Record<Exclude<GolfPrimaryGoal, "">, string> = {
  LOWER_HANDICAP: "Bajar mi handicap",
  MORE_CONSISTENT: "Ser más consistente",
  SPECIFIC_AREA: "Mejorar un área específica",
  ENJOY_MORE: "Disfrutar más el juego",
  COMPETE_TOURNAMENTS: "Competir en torneos",
};

type GroupDraft = {
  groupId: string;
  name: string;
  imageUrl: string;
  privacy: "private" | "invite_only";
  members: FrequentGroupMember[];
  template?: GroupGameTemplate;
};

type BetaDraft = {
  improvementGoals: GolfImprovementGoal[];
  primaryGoals: Exclude<GolfPrimaryGoal, "">[];
  targetHandicap: string;
  planId: PlanId;
  group: GroupDraft;
};

function makeId(prefix: string) {
  return globalThis.crypto?.randomUUID?.() || `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function ownerMember(profile: BackyardProfile): FrequentGroupMember {
  return {
    memberId: `member-${profile.userId}`,
    kind: "account",
    name: profile.displayName || "Jugador",
    handicap: null,
    accountUserId: profile.userId,
  };
}

function freshDraft(profile: BackyardProfile): BetaDraft {
  return {
    improvementGoals: [...(profile.improvementGoals || [])],
    primaryGoals: [...(profile.primaryGoals || (profile.primaryGoal ? [profile.primaryGoal] : []))],
    targetHandicap: profileHandicapInput(profile.targetHandicap ?? null),
    planId: selectablePlanId(profile.planId),
    group: {
      groupId: makeId("group"),
      name: "",
      imageUrl: "",
      privacy: "private",
      members: [ownerMember(profile)],
    },
  };
}

function safeDraft(value: unknown, profile: BackyardProfile): BetaDraft {
  const fallback = freshDraft(profile);
  if (!value || typeof value !== "object") return fallback;
  const raw = value as Partial<BetaDraft>;
  const rawGroup = raw.group && typeof raw.group === "object" ? raw.group : fallback.group;
  const parsedMembers = parseFrequentGroups(JSON.stringify([{
    id: typeof rawGroup.groupId === "string" ? rawGroup.groupId : fallback.group.groupId,
    name: typeof rawGroup.name === "string" && rawGroup.name.trim() ? rawGroup.name : fallback.group.name,
    players: Array.isArray(rawGroup.members) && rawGroup.members.length ? rawGroup.members : fallback.group.members,
    gameTemplate: rawGroup.template,
    uses: 0,
    updatedAt: new Date().toISOString(),
  }]))[0];
  const members = parsedMembers?.players.length ? parsedMembers.players : fallback.group.members;
  return {
    improvementGoals: Array.isArray(raw.improvementGoals)
      ? raw.improvementGoals.filter((goal): goal is GolfImprovementGoal => (GOLF_IMPROVEMENT_GOALS as readonly string[]).includes(String(goal)))
      : fallback.improvementGoals,
    primaryGoals: Array.isArray(raw.primaryGoals)
      ? [...new Set(raw.primaryGoals.filter((goal): goal is Exclude<GolfPrimaryGoal, ""> => typeof goal === "string" && (GOLF_PRIMARY_GOALS as readonly string[]).includes(goal)))]
      : fallback.primaryGoals,
    targetHandicap: typeof raw.targetHandicap === "string" ? raw.targetHandicap : fallback.targetHandicap,
    planId: selectablePlanId(raw.planId),
    group: {
      groupId: parsedMembers?.id || fallback.group.groupId,
      name: typeof rawGroup.name === "string" ? rawGroup.name.slice(0, 80) : fallback.group.name,
      imageUrl: typeof rawGroup.imageUrl === "string" ? rawGroup.imageUrl.slice(0, 180_000) : "",
      privacy: rawGroup.privacy === "invite_only" ? "invite_only" : "private",
      members,
      ...(parsedMembers?.gameTemplate ? { template: parsedMembers.gameTemplate } : {}),
    },
  };
}

function initialTemplate(members: FrequentGroupMember[]) {
  const players = members.flatMap((member) => member.memberId ? [{ id: member.memberId, name: member.name, handicap: member.handicap, ...(member.accountUserId ? { accountUserId: member.accountUserId } : {}) }] : []);
  const ids = players.map((player) => player.id);
  return {
    version: 1,
    ownerMemberId: ids[0] || "",
    roundDefaults: { startHole: 1, roundHoles: 18, handicapBasis: "relative" },
    betConfig: initialBets(ids),
    foursomeSegments: segmentDefinitions(playOrder(1), 6),
    personalBets: [],
    supplementalBets: [],
    manualBets: [],
  } satisfies GroupGameTemplate;
}

function groupPlayers(members: FrequentGroupMember[]): Player[] {
  return members.flatMap((member) => member.memberId ? [{
    id: member.memberId,
    name: member.name,
    handicap: member.handicap,
    ...(member.accountUserId ? { accountUserId: member.accountUserId } : {}),
  }] : []);
}

function activeBetCount(template: GroupGameTemplate) {
  const core = [
    template.betConfig.monkey?.enabled, template.betConfig.rabbits.enabled, template.betConfig.skins.enabled,
    template.betConfig.units.enabled, template.betConfig.foursome.enabled, template.betConfig.ballFriend.enabled,
    template.betConfig.polla.first9.enabled, template.betConfig.polla.second9.enabled, template.betConfig.polla.total18.enabled,
    template.betConfig.miniPolla.enabled, template.betConfig.vipers.enabled, template.betConfig.camels.enabled,
    template.betConfig.fish.enabled, template.betConfig.loba.enabled,
  ].filter(Boolean).length;
  return core + template.personalBets.filter((bet) => bet.enabled !== false).length
    + template.supplementalBets.filter((bet) => bet.enabled).length
    + template.manualBets.filter((bet) => bet.enabled !== false).length;
}

function Shell({ progress, eyebrow, title, description, children, actions, onBack, onSaveAndExit }: { progress: BetaOnboardingProgress; eyebrow: string; title: string; description?: string; children: React.ReactNode; actions: React.ReactNode; onBack?: () => void; onSaveAndExit?: () => void }) {
  const visibleSteps: BetaOnboardingStep[] = progress.mode === 'quick' ? ['welcome', 'course', 'ghin', 'permissions'] : ["welcome", "course", "ghin", "equipment", "improvements", "objective", "plan", "group", "players", "handicaps", "bets", "bet_details", "ready", "permissions"];
  const index = Math.max(0, visibleSteps.indexOf(progress.step));
  const titleRef = useRef<HTMLHeadingElement>(null);
  const [confirmExit, setConfirmExit] = useState(false);
  const [highContrast, setHighContrast] = useState(true);
  useEffect(() => { setHighContrast(localStorage.getItem(STORAGE_KEYS.contrast) !== 'false'); }, []);
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "auto" });
    titleRef.current?.focus({ preventScroll: true });
  }, [progress.step]);
  return <main className={`${styles.screen} ${highContrast ? 'highContrast' : ''}`}><section className={styles.card}>
    <header className={styles.header}><BrandLockup compact /><span className={styles.step}>PASO {index + 1} DE {visibleSteps.length}</span>{onSaveAndExit && <button type="button" className="textButton" onClick={() => setConfirmExit(true)}>Guardar y salir</button>}</header>
    <div className={styles.progress}><span style={{ width: `${((index + 1) / visibleSteps.length) * 100}%` }} /></div>
    <div className={styles.copy}><div className={styles.eyebrow}>{eyebrow}</div><h1 ref={titleRef} tabIndex={-1}>{title}</h1>{description && <p>{description}</p>}</div>
    <div className={styles.body}>{children}</div><footer className={styles.actions}>{actions}<div className={styles.flowNav}>{onBack && <button type="button" className="textButton" onClick={onBack}>← Anterior</button>}</div></footer>
  </section><ModalShell open={confirmExit} onClose={() => setConfirmExit(false)} label="Guardar configuración y salir"><h2>¿Guardar esta configuración y continuar después?</h2><p>Conservaremos el borrador en este dispositivo.</p><div className="dialogActions"><button type="button" className="secondary" onClick={() => setConfirmExit(false)}>Cancelar</button><button type="button" className="primary" onClick={() => { setConfirmExit(false); onSaveAndExit?.(); }}>Guardar y salir</button></div></ModalShell></main>;
}

export function BetaOnboardingFlow({ profile, accessToken, onUpdateProfile, bettingConsentGranted, requestBettingConsent, onComplete, onGroupSaved }: {
  profile: BackyardProfile;
  accessToken: string | null;
  onUpdateProfile: (profile: BackyardProfileUpdate) => Promise<"local" | "cloud">;
  bettingConsentGranted: boolean;
  requestBettingConsent: () => Promise<boolean>;
  onComplete: () => void;
  onGroupSaved?: (group: FrequentGroup) => void;
}) {
  const [progress, setProgress] = useState<BetaOnboardingProgress | null>(null);
  useViewScrollReset(progress?.step ?? null);
  const [draft, setDraft] = useState<BetaDraft | null>(null);
  const [message, setMessage] = useState("");
  const [playerMode, setPlayerMode] = useState<"local" | "guest" | "backyard">("backyard");
  const [localPlayerId, setLocalPlayerId] = useState("");
  const [newPlayer, setNewPlayer] = useState({ name: "", email: "", handicap: "" });
  const [entryMode, setEntryMode] = useState<"quick" | "complete" | null>(null);
  const [homeClubSelectionReady, setHomeClubSelectionReady] = useState(Boolean(profile.homeClubId && profile.homeCourseId));
  const [groupSaving, setGroupSaving] = useState(false);
  const groupSaveInFlight = useRef(false);
  const initializedUser = useRef('');
  const checkpointQueue = useRef<Promise<void>>(Promise.resolve());
  const [finishing, setFinishing] = useState(false);
  const finishingRef = useRef(false);
  const checkpoint = (value: BetaOnboardingProgress) => {
    const write = checkpointQueue.current.catch(() => {}).then(() => saveOnboardingCheckpoint(accessToken || '', value));
    checkpointQueue.current = write;
    return write;
  };
  const liveProfileUserId = useRef(profile.userId);
  useEffect(() => { liveProfileUserId.current = profile.userId; }, [profile.userId]);
  const frequentPlayers = useMemo(() => typeof window === "undefined" ? [] : readStoredJson<FrequentPlayer[]>(localStorage, STORAGE_KEYS.frequentPlayers, []), []);

  useEffect(() => {
    if (initializedUser.current === profile.userId) return;
    initializedUser.current = profile.userId;
    const existing = readBetaOnboardingProgress(localStorage, profile.userId) || createBetaOnboardingProgress(profile.userId);
    let storedDraft: unknown = null;
    try { storedDraft = JSON.parse(localStorage.getItem(betaOnboardingDraftStorageKey(profile.userId)) || "null"); }
    catch { /* A corrupt optional draft restarts only this onboarding. */ }
    const nextDraft = safeDraft(storedDraft, profile);
    persistBetaOnboardingProgress(localStorage, existing);
    setProgress(existing);
    setEntryMode(existing.mode || null);
    setDraft(nextDraft);
  }, [profile]);

  useEffect(() => {
    if (!draft) return;
    try { localStorage.setItem(betaOnboardingDraftStorageKey(profile.userId), JSON.stringify(draft)); }
    catch { setMessage("No pudimos guardar este avance. Libera espacio antes de continuar."); }
  }, [draft, profile.userId]);

  useEffect(() => {
    if (progress?.step === "complete") onComplete();
  }, [progress?.step, onComplete]);

  if (!progress || !draft) return <main className={styles.screen}><div className={styles.loading}>Preparando tu experiencia…</div></main>;

  const advance = (nextStep: BetaOnboardingStep, skipped = false, groupId?: string) => {
    const next = advanceBetaOnboarding({ ...progress, ...(entryMode ? { mode: entryMode } : {}) }, nextStep, { skipped, groupId });
    persistBetaOnboardingProgress(localStorage, next);
    void checkpoint(next).catch(error => setMessage(error.message));
    setProgress(next);
    setMessage("");
    window.scrollTo({ top: 0, behavior: "smooth" });
  };
  const finish = (groupId?: string) => {
    if (progress.step !== 'permissions') { advance('permissions', false, groupId); return; }
    if (finishingRef.current) return;
    finishingRef.current = true; setFinishing(true);
    const complete = completeBetaOnboarding(progress, { groupId });
    void checkpoint(complete).then(() => {
      persistBetaOnboardingProgress(localStorage, complete);
      localStorage.removeItem(betaOnboardingDraftStorageKey(profile.userId));
      setProgress(complete);
    }).catch(error => setMessage(error.message)).finally(() => { finishingRef.current = false; setFinishing(false); });
  };
  const goTo = (step: Exclude<BetaOnboardingStep, "complete">) => {
    const next = navigateBetaOnboarding(progress, step);
    persistBetaOnboardingProgress(localStorage, next);
    void checkpoint(next).catch(error => setMessage(error.message));
    setProgress(next);
    setMessage("");
    window.scrollTo({ top: 0, behavior: "smooth" });
  };
  const previousByStep: Partial<Record<BetaOnboardingStep, Exclude<BetaOnboardingStep, "complete">>> = {
    course: "welcome", ghin: "course", equipment: "ghin", improvements: "equipment", objective: "improvements", plan: "objective",
    group: "plan", players: "group", handicaps: "players", bets: "handicaps",
    bet_details: "bets", ready: "bet_details",
  };
  const navigationProps = {
    ...(previousByStep[progress.step] && !groupSaving ? { onBack: () => goTo(previousByStep[progress.step]!) } : {}),
    onSaveAndExit: groupSaving ? undefined : () => {
      try {
        localStorage.setItem(betaOnboardingDraftStorageKey(profile.userId), JSON.stringify(draft));
        persistBetaOnboardingProgress(localStorage, progress);
        onComplete();
      } catch { setMessage("No pudimos guardar el borrador. Reintenta antes de salir."); }
    },
  };
  const updateGroup = (patch: Partial<GroupDraft>) => setDraft((current) => current ? ({ ...current, group: { ...current.group, ...patch } }) : current);
  const acceptGroupMembers = (members: FrequentGroupMember[]) => setDraft((current) => {
    if (!current) return current;
    const nextMembers = mergeAcceptedGroupMembers(current.group.members, members);
    return nextMembers === current.group.members ? current : { ...current, group: { ...current.group, members: nextMembers } };
  });
  const template = draft.group.template || initialTemplate(draft.group.members);
  const players = groupPlayers(draft.group.members);
  const setTemplate: React.Dispatch<React.SetStateAction<GroupGameTemplate>> = (action) => setDraft((current) => {
    if (!current) return current;
    const prior = current.group.template || initialTemplate(current.group.members);
    return { ...current, group: { ...current.group, template: typeof action === "function" ? action(prior) : action } };
  });

  if (progress.step === "course") return <Shell progress={progress} {...navigationProps} eyebrow="TU CAMPO" title="Elige tu Home Club" description="Busca tu club habitual o explora los campos cercanos. No estás iniciando una ronda." actions={<button className="primary big" disabled={!profile.homeClubId || !profile.homeCourseId || !homeClubSelectionReady} onClick={() => advance('ghin')}>Continuar: Handicap / Índice</button>}>
    <CatalogCoursePicker purpose="home-club" token={accessToken} selectedName={[profile.homeClub,profile.homeCourse].filter(Boolean).join(' · ')} onSelectionReadyChange={setHomeClubSelectionReady} onSelectHomeCourse={async selection => {
      setMessage('');
      const result=await onUpdateProfile({ displayName: profile.displayName, avatarUrl: profile.avatarUrl, defaultHandicap: profile.defaultHandicap, homeClub: selection.clubName, homeClubId: selection.clubId, homeCourse: selection.courseName, homeCourseId: selection.courseId });
      if(result!=='cloud')throw new Error('No pudimos confirmar tu Home Club en la nube. Reintenta para continuar.');
    }} />
    <p>Este campo queda como tu club habitual. Podrás cambiarlo en Perfil.</p>{message && <p role="alert">{message}</p>}
  </Shell>;
  if (progress.step === "permissions") return <Shell progress={progress} eyebrow="A TU MEDIDA" title="Permisos de este dispositivo" description="Tu configuración está lista. Tú decides qué permisos activar." actions={<button type="button" className="primary big" disabled={finishing} onClick={() => finish()}>{finishing ? 'Guardando…' : 'Continuar a The Backyard'}</button>}>
    <DevicePermissions />{message && <p role="alert">{message}</p>}
  </Shell>;
  if (progress.step === "welcome") return <Shell progress={progress} {...navigationProps} eyebrow="EMPIEZA A TU MANERA" title="Tu Backyard, sin fricción" description="En ambas opciones elegirás tu campo e índice. Después puedes completar equipo, objetivos y grupos." actions={<button type="button" className="primary big" disabled={!entryMode} onClick={() => advance("course")}>CONTINUAR</button>}>
    <div className={styles.welcomeHero} aria-hidden="true"><span className={styles.heroFlag}>⛳</span><div><b>Tu golf, en un solo lugar</b><small>Rondas rápidas · amigos · equipo · estadísticas</small></div><span className={styles.heroBall}>●</span></div>
    <div className={styles.entryGrid}>
      <button type="button" className={entryMode === "quick" ? styles.entrySelected : styles.entryChoice} aria-pressed={entryMode === "quick"} onClick={() => setEntryMode("quick")}><span aria-hidden="true">⚡</span><div><b>Rápida</b><p>Elige tu Home Club y fuente de índice. Equipo, fitting y grupos quedan disponibles para después.</p></div></button>
      <button type="button" className={entryMode === "complete" ? styles.entrySelected : styles.entryChoice} aria-pressed={entryMode === "complete"} onClick={() => setEntryMode("complete")}><span aria-hidden="true">⛳</span><div><b>Completa</b><p>Configura HCP, bolsa, objetivos y tu primer grupo para recibir una experiencia más personalizada.</p></div></button>
    </div>
  </Shell>;

  if (progress.step === "equipment") return <EquipmentOnboarding
    userId={profile.userId}
    accessToken={accessToken}
    defaultHandicap={null}
    defaultHandedness={profile.handedness}
    ballFitDefaults={ballFitDefaultsFromProfile(profile)}
    onComplete={() => advance("improvements")}
    onBack={() => goTo("ghin")}
    onSaveAndExit={onComplete}
  />;

  if (progress.step === "ghin") return <Shell progress={progress} {...navigationProps} eyebrow="HANDICAP / ÍNDICE" title="Elige tu fuente de índice" description="Puedes activar Backyard Index sin rondas previas. GHIN estará disponible mediante una integración oficial." actions={<button className="primary big" onClick={async () => { try { await onUpdateProfile({ displayName: profile.displayName, avatarUrl: profile.avatarUrl, defaultHandicap: profile.defaultHandicap, ghinLinkStatus: profile.ghinLinkStatus || "SKIPPED" }); advance(entryMode === 'quick' ? "permissions" : "equipment", true); } catch(error) { setMessage(error instanceof Error ? error.message : 'No pudimos guardar. Reintenta.'); } }}>Continuar</button>}>
    <HandicapSourceSelector userId={profile.userId} authenticated={Boolean(profile.userId && profile.userId !== "guest")} />
    <p className={styles.trust}>Si todavía no tienes índice puedes continuar. No inventaremos un valor.</p>{message && <p role="alert">{message}</p>}
  </Shell>;

  if (progress.step === "improvements") return <Shell progress={progress} {...navigationProps} eyebrow="TU JUEGO" title="¿Qué te gustaría mejorar?" description="Elige todas las áreas que quieras. Usaremos estas señales para personalizar recomendaciones, IA, análisis y ejercicios." actions={<button className="primary big" disabled={!draft.improvementGoals.length} onClick={async () => { await onUpdateProfile({ displayName: profile.displayName, avatarUrl: profile.avatarUrl, defaultHandicap: profile.defaultHandicap, improvementGoals: draft.improvementGoals, golfProfileUpdatedAt: new Date().toISOString() }); advance("objective"); }}>Continuar</button>}>
    <div className={styles.choiceGrid}>{GOLF_IMPROVEMENT_GOALS.map((goal) => { const active = draft.improvementGoals.includes(goal); return <button type="button" key={goal} className={active ? styles.choiceActive : styles.choice} onClick={() => setDraft((current) => current ? { ...current, improvementGoals: active ? current.improvementGoals.filter((item) => item !== goal) : [...current.improvementGoals, goal] } : current)}>{active ? "✓ " : ""}{IMPROVEMENT_LABELS[goal]}</button>; })}</div>
  </Shell>;

  if (progress.step === "objective") return <Shell progress={progress} {...navigationProps} eyebrow="OBJETIVO" title="¿Cuáles son tus objetivos?" description="Elige uno o varios. Los usaremos para personalizar recomendaciones y podrás cambiarlos desde tu perfil." actions={<button className="primary big" disabled={!draft.primaryGoals.length} onClick={async () => {
    const parsedTarget = Number(draft.targetHandicap);
    if (draft.primaryGoals.includes("LOWER_HANDICAP") && (!Number.isFinite(parsedTarget) || parsedTarget < -15 || parsedTarget > 36)) { setMessage("Escribe un HCP objetivo válido entre +15.0 y 36.0."); return; }
    const targetHandicap = draft.primaryGoals.includes("LOWER_HANDICAP") ? clampBackyardHandicap(parsedTarget) : null;
    await onUpdateProfile({ displayName: profile.displayName, avatarUrl: profile.avatarUrl, defaultHandicap: profile.defaultHandicap, primaryGoals: draft.primaryGoals, primaryGoal: draft.primaryGoals[0] || "", targetHandicap, golfProfileUpdatedAt: new Date().toISOString() }); advance("plan");
  }}>Continuar</button>}>
    <div className={styles.goalList}>{GOLF_PRIMARY_GOALS.map((goal) => { const active = draft.primaryGoals.includes(goal); return <button type="button" key={goal} className={active ? styles.goalActive : styles.goal} aria-pressed={active} onClick={() => setDraft((current) => current ? { ...current, primaryGoals: active ? current.primaryGoals.filter((item) => item !== goal) : [...current.primaryGoals, goal] } : current)}><span>{active ? "✓" : "+"}</span>{GOAL_LABELS[goal]}</button>; })}</div>
    {draft.primaryGoals.includes("LOWER_HANDICAP") && <div className={styles.hcpGoal}><label>Objetivo personal de índice<input inputMode="decimal" value={draft.targetHandicap} onChange={(event) => setDraft((current) => current ? { ...current, targetHandicap: event.target.value } : current)} placeholder="Ej. 5.0" /></label><p className={styles.trust}>Es una meta, no tu índice actual.</p></div>}
    {message && <div className={styles.error} role="alert">{message}</div>}
  </Shell>;

  if (progress.step === "plan") return <Shell progress={progress} {...navigationProps} eyebrow="MEMBRESÍA BETA" title="Elige tu plan" description="No hay cobros ni precios definitivos en esta Beta. La cuenta inicia en GRATIS." actions={<button className="primary big" onClick={async () => { const planId = selectablePlanId(draft.planId); await onUpdateProfile({ displayName: profile.displayName, avatarUrl: profile.avatarUrl, defaultHandicap: profile.defaultHandicap, planId }); advance("group"); }}>Continuar con GRATIS</button>}>
    <div className={styles.planGrid}>{PLAN_CATALOG.map((plan) => <button type="button" key={plan.id} disabled={plan.availability !== "available"} className={`${styles.planCard} ${draft.planId === plan.id ? styles.planSelected : ""}`} onClick={() => setDraft((current) => current ? { ...current, planId: plan.id } : current)}><span>{plan.eyebrow}</span><b>{plan.name}</b><p>{plan.description}</p><small>{plan.availability === "available" ? "Incluido en Beta" : "Próximamente · sin cobro"}</small></button>)}</div>
  </Shell>;

  if (progress.step === "group") return <Shell progress={progress} {...navigationProps} eyebrow="TU PRIMER GRUPO" title="Configura tu primer grupo" description="Será una plantilla habitual: jugadores, HCP y apuestas listas para reutilizar." actions={<><button className="primary big" disabled={!draft.group.name.trim()} onClick={() => advance("players")}>Crear grupo</button><button className={styles.skip} onClick={() => finish()}>Omitir por ahora</button></>}>
    <div className={styles.groupIdentity}><label>Nombre del grupo<input maxLength={80} value={draft.group.name} onChange={(event) => updateGroup({ name: event.target.value })} placeholder="Ej. Domingos" autoComplete="off" /></label><ProfileImagePicker kind="group" value={draft.group.imageUrl} onChange={(imageUrl) => updateGroup({ imageUrl })} /></div>
    <fieldset className={styles.privacyChoices}><legend>Privacidad</legend><button type="button" className={draft.group.privacy === "private" ? styles.privacySelected : styles.privacyChoice} aria-pressed={draft.group.privacy === "private"} onClick={() => updateGroup({ privacy: "private" })}><b>Privado</b><span>Sólo los integrantes que agregues pueden ver el grupo.</span></button><button type="button" className={draft.group.privacy === "invite_only" ? styles.privacySelected : styles.privacyChoice} aria-pressed={draft.group.privacy === "invite_only"} onClick={() => updateGroup({ privacy: "invite_only" })}><b>Por invitación</b><span>Permite sumar personas con una invitación segura o un link revocable.</span></button></fieldset>
    {message && <div className={styles.error} role="alert">{message}</div>}
  </Shell>;

  if (progress.step === "players") {
    const addMember = (member: FrequentGroupMember) => {
      const shell: FrequentGroup = { id: draft.group.groupId, name: draft.group.name, players: draft.group.members, uses: 0, updatedAt: "" };
      const next = addFrequentGroupMember(shell, member);
      if (next === shell) { setMessage("Ese jugador, cuenta o correo ya forma parte del grupo."); return; }
      updateGroup({ members: next.players });
      setNewPlayer({ name: "", email: "", handicap: "" }); setMessage("");
    };
    return <Shell progress={progress} {...navigationProps} eyebrow="INTEGRANTES" title="Agrega o vincula jugadores" description="Usuarios Backyard usa cuentas reales y aceptación. Los jugadores guardados sin cuenta y los invitados siguen disponibles por separado." actions={<button className="primary big" onClick={() => advance("handicaps")}>Revisar HCP</button>}>
      <div className={styles.memberList}>{draft.group.members.map((member, index) => <article key={member.memberId || index}><span className={styles.memberAvatar}>{member.name.slice(0, 1).toUpperCase()}</span><span><b>{member.name}</b><small>{member.accountUserId ? "Usuario Backyard" : "Invitado"}</small></span>{index > 0 && <button type="button" aria-label={`Quitar ${member.name}`} onClick={() => updateGroup({ members: draft.group.members.filter((_, memberIndex) => memberIndex !== index) })}>×</button>}<div className={styles.memberHandicap}><PlayerHandicapControl player={member} onChange={handicap => updateGroup({ members: draft.group.members.map((item, memberIndex) => memberIndex === index && !item.accountUserId ? { ...item, handicap } : item) })} /></div></article>)}</div>
      <div className={styles.playerTabs}><button className={playerMode === "backyard" ? styles.tabActive : ""} onClick={() => setPlayerMode("backyard")}>Usuarios Backyard</button><button className={playerMode === "local" ? styles.tabActive : ""} onClick={() => setPlayerMode("local")}>Jugadores guardados</button><button className={playerMode === "guest" ? styles.tabActive : ""} onClick={() => setPlayerMode("guest")}>Invitado</button></div>
      {playerMode === "backyard" && <GroupInviteManager accessToken={accessToken} group={{ id: draft.group.groupId, name: draft.group.name, players: draft.group.members, gameTemplate: template, uses: 0, updatedAt: new Date().toISOString() }} onAcceptedMembers={acceptGroupMembers} />}
      {playerMode === "local" && <div className={styles.addPlayer}><label>Buscar jugador guardado sin cuenta<select value={localPlayerId} onChange={(event) => setLocalPlayerId(event.target.value)}><option value="">Seleccionar jugador…</option>{frequentPlayers.filter(player => !player.accountUserId).map((player) => <option value={player.id} key={player.id}>{player.name}{player.handicap !== null ? ` · HCP ${player.handicap}` : ""}</option>)}</select></label><button className="secondary" disabled={!localPlayerId} onClick={() => { const saved = frequentPlayers.find((player) => player.id === localPlayerId && !player.accountUserId); if (saved) addMember({ memberId: makeId("member"), kind: "guest", name: saved.name, handicap: saved.handicap }); }}>Agregar</button><p className={styles.trust}>Para cuentas registradas usa Usuarios Backyard. Un jugador guardado no implica una amistad.</p></div>}
      {playerMode === "guest" && <div className={styles.addPlayer}><label>Nombre<input value={newPlayer.name} onChange={(event) => setNewPlayer((current) => ({ ...current, name: event.target.value }))} placeholder="Nombre del jugador" /></label><label>HCP manual (opcional)<input inputMode="decimal" value={newPlayer.handicap} onChange={(event) => setNewPlayer((current) => ({ ...current, handicap: event.target.value }))} placeholder="Ej. 18.0" /></label><button className="secondary" disabled={!newPlayer.name.trim()} onClick={() => { const parsed = newPlayer.handicap.trim() ? Number(newPlayer.handicap) : null; if (parsed !== null && (!Number.isFinite(parsed) || parsed < -15)) { setMessage("El HCP debe estar entre +15.0 y 36.0."); return; } addMember({ memberId: makeId("member"), kind: "guest", name: newPlayer.name.trim(), handicap: clampBackyardHandicap(parsed) }); }}>Agregar invitado</button></div>}
      {message && <div className={styles.error} role="alert">{message}</div>}
    </Shell>;
  }

  if (progress.step === "handicaps") return <Shell progress={progress} {...navigationProps} eyebrow="HANDICAPS" title="Revisa los handicaps" description="Estos valores serán el HCP habitual del grupo. El máximo de captura es 36; el HCP de juego se calcula después con el tee de cada jugador." actions={<button className="primary big" onClick={() => { updateGroup({ template: normalizeGroupGameTemplate(draft.group.template, draft.group.members) ?? initialTemplate(draft.group.members) }); advance("bets"); }}>Configurar apuestas</button>}>
    <div className={styles.hcpList}>{draft.group.members.map((member, index) => <article key={member.memberId || index}><b>{member.name}</b><PlayerHandicapControl player={member} onChange={handicap => updateGroup({ members: draft.group.members.map((item, memberIndex) => memberIndex === index && !item.accountUserId ? { ...item, handicap } : item) })} /></article>)}</div>
  </Shell>;

  if (progress.step === "bets") return <Shell progress={progress} {...navigationProps} eyebrow="JUEGO HABITUAL" title="Elegir apuestas habituales" description="Selecciona tus apuestas habituales. En la siguiente pantalla podrás editar valores y reglas." actions={<button className="primary big" onClick={() => advance("bet_details")}>Continuar: configurar apuestas →</button>}>
    <GroupBetTemplateEditor value={template} players={players} ownerId={template.ownerMemberId} mode="selection" onChange={setTemplate} requestActivation={bettingConsentGranted ? undefined : requestBettingConsent} />
  </Shell>;

  if (progress.step === "bet_details") {
    const saveGroup = async () => {
      if (groupSaveInFlight.current) return;
      const normalized = normalizeGroupGameTemplate(template, draft.group.members);
      if (!normalized) { setMessage("No pudimos preparar la plantilla. Revisa los integrantes."); return; }
      const issues = groupTemplateConfigurationIssues(normalized, players);
      if (issues.blocking.length) { setMessage(issues.blocking.map((issue) => issue.message).join(" ")); return; }
      const normalizedTemplate = templateWithoutPlayerAssignments(normalized);
      const existing = parseFrequentGroups(localStorage.getItem(STORAGE_KEYS.frequentGroups));
      if (existing.some((group) => group.id !== draft.group.groupId && group.name.trim().toLocaleLowerCase("es-MX") === draft.group.name.trim().toLocaleLowerCase("es-MX"))) { setMessage("Ya existe un grupo con ese nombre. Regresa y elige otro."); return; }
      const group: FrequentGroup = { id: draft.group.groupId, name: draft.group.name.trim(), ...(draft.group.imageUrl.trim() ? { imageUrl: draft.group.imageUrl.trim() } : {}), privacy: draft.group.privacy, players: draft.group.members, gameTemplate: normalizedTemplate, uses: 0, updatedAt: new Date().toISOString() };
      groupSaveInFlight.current = true; setGroupSaving(true); setMessage("");
      const savingUserId = profile.userId;
      try {
        const saved = await saveExplicitGroupSnapshot({ group, accessToken, authenticated: Boolean(profile.userId && profile.userId !== "guest"), online: navigator.onLine });
        if (liveProfileUserId.current !== savingUserId) return;
        // Read the latest collection after the request; unrelated groups may
        // have synchronized while the explicit save was in flight.
        const latest = parseFrequentGroups(localStorage.getItem(STORAGE_KEYS.frequentGroups));
        localStorage.setItem(STORAGE_KEYS.frequentGroups, serializeFrequentGroups([saved.group, ...latest.filter((item) => item.id !== group.id)]));
        // A resumed flow has an already mounted app writer. Update its state
        // immediately; otherwise its old collection can overwrite this save.
        onGroupSaved?.(saved.group);
        updateGroup({ template: normalizedTemplate, members: saved.group.players });
        advance("ready", false, group.id);
        setMessage(saved.notice);
      } catch (error) {
        if (liveProfileUserId.current === savingUserId) setMessage(error instanceof Error ? error.message : "No pudimos guardar el grupo. Conservamos el borrador.");
      } finally { groupSaveInFlight.current = false; setGroupSaving(false); }
    };
    return <Shell progress={progress} {...navigationProps} eyebrow="DETALLES" title="Configura tus apuestas" description="Ajusta valores, carry, presiones, HCP y reglas. Los jugadores y parejas se eligen al iniciar la ronda." actions={<button className="primary big" disabled={groupSaving} onClick={saveGroup}>{groupSaving ? "Guardando…" : "Guardar grupo"}</button>}>
      {activeBetCount(template) ? <GroupBetTemplateEditor value={template} players={players} ownerId={template.ownerMemberId} mode="details" locked={groupSaving} onChange={setTemplate} requestActivation={bettingConsentGranted ? undefined : requestBettingConsent} /> : <div className={styles.emptyState}><span>⛳</span><b>Grupo básico listo</b><p>La plantilla abrirá con las apuestas desactivadas.</p></div>}
      <div className={styles.readySummary} aria-label="Resumen de apuestas habituales"><b>{activeGroupTemplateDefinitions(template).length} apuestas seleccionadas</b><span>{activeGroupTemplateDefinitions(template).map(item => item.label).join(" · ") || "Sin apuestas"}</span><small>Los pendientes de participantes, HCP o parejas se completan al crear la ronda.</small></div>
      {message && <div className={styles.error} role="alert">{message}</div>}
    </Shell>;
  }

  if (progress.step === "ready") return <Shell progress={progress} {...navigationProps} eyebrow="GRUPO LISTO" title="¡Listo!" description={`Tu grupo ${draft.group.name.trim()} ha sido creado correctamente.`} actions={<><button className="primary big" onClick={() => finish(progress.groupId)}>Ir al inicio</button><button className="secondary big" onClick={() => { const nextDraft = freshDraft(profile); setDraft(nextDraft); const next = { ...progress, status: "in_progress" as const, step: "group" as const, groupId: undefined, updatedAt: new Date().toISOString() }; persistBetaOnboardingProgress(localStorage, next); setProgress(next); }}>Crear otro grupo</button></>}>
    <div className={styles.readyMark}>✓</div><div className={styles.readySummary}><span>{draft.group.members.length} jugadores</span><span>{activeBetCount(template)} apuestas habituales</span><span>{draft.group.privacy === "private" ? "Privado" : "Solo invitación"}</span></div>
    {message && <p role="status">{message}</p>}
    <GroupInviteManager accessToken={accessToken} group={{ id: draft.group.groupId, name: draft.group.name, players: draft.group.members, gameTemplate: template, uses: 0, updatedAt: new Date().toISOString() }} onAcceptedMembers={acceptGroupMembers} />
  </Shell>;

  return null;
}
