"use client";

import { useEffect, useMemo, useState } from "react";
import {
  GOLF_IMPROVEMENT_GOALS,
  GOLF_PRIMARY_GOALS,
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
  persistBetaOnboardingProgress,
  readBetaOnboardingProgress,
  type BetaOnboardingProgress,
  type BetaOnboardingStep,
} from "../../lib/beta-onboarding";
import { collectBetConfigurationIssues } from "../../lib/bet-config-validation";
import { addFrequentGroupMember, parseFrequentGroups, serializeFrequentGroups } from "../../lib/frequent-templates";
import { normalizeGroupGameTemplate } from "../../lib/group-game-template";
import { initialBets } from "../../lib/new-round-bets";
import { PLAN_CATALOG, selectablePlanId, type PlanId } from "../../lib/plans";
import { STORAGE_KEYS, readStoredJson } from "../../lib/round-utils";
import { playOrder, segmentDefinitions } from "../../lib/engine";
import type { FrequentGroup, FrequentGroupMember, FrequentPlayer, GroupGameTemplate, Player } from "../../lib/types";
import { ballFitDefaultsFromProfile } from "../../lib/ball-fitting";
import { BrandLockup } from "./brand-lockup";
import { EquipmentOnboarding } from "./equipment-onboarding";
import { GroupBetTemplateEditor } from "./group-bet-template-editor";
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
  primaryGoal: GolfPrimaryGoal;
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
    handicap: profile.defaultHandicap,
    accountUserId: profile.userId,
  };
}

function freshDraft(profile: BackyardProfile): BetaDraft {
  return {
    improvementGoals: [...(profile.improvementGoals || [])],
    primaryGoal: profile.primaryGoal || "",
    targetHandicap: profileHandicapInput(profile.targetHandicap ?? null),
    planId: selectablePlanId(profile.planId),
    group: {
      groupId: makeId("group"),
      name: "Domingos",
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
    primaryGoal: typeof raw.primaryGoal === "string" && (GOLF_PRIMARY_GOALS as readonly string[]).includes(raw.primaryGoal)
      ? raw.primaryGoal as GolfPrimaryGoal
      : fallback.primaryGoal,
    targetHandicap: typeof raw.targetHandicap === "string" ? raw.targetHandicap : fallback.targetHandicap,
    planId: selectablePlanId(raw.planId),
    group: {
      groupId: parsedMembers?.id || fallback.group.groupId,
      name: typeof rawGroup.name === "string" ? rawGroup.name.slice(0, 80) : fallback.group.name,
      imageUrl: typeof rawGroup.imageUrl === "string" ? rawGroup.imageUrl.slice(0, 2000) : "",
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

function Shell({ progress, eyebrow, title, description, children, actions }: { progress: BetaOnboardingProgress; eyebrow: string; title: string; description?: string; children: React.ReactNode; actions: React.ReactNode }) {
  const visibleSteps: BetaOnboardingStep[] = ["ghin", "equipment", "improvements", "objective", "plan", "group", "players", "handicaps", "bets", "bet_details", "ready"];
  const index = Math.max(0, visibleSteps.indexOf(progress.step));
  return <main className={styles.screen}><section className={styles.card}>
    <header className={styles.header}><BrandLockup compact /><span className={styles.step}>PASO {index + 1} DE {visibleSteps.length}</span></header>
    <div className={styles.progress}><span style={{ width: `${((index + 1) / visibleSteps.length) * 100}%` }} /></div>
    <div className={styles.copy}><div className={styles.eyebrow}>{eyebrow}</div><h1>{title}</h1>{description && <p>{description}</p>}</div>
    <div className={styles.body}>{children}</div><footer className={styles.actions}>{actions}</footer>
  </section></main>;
}

export function BetaOnboardingFlow({ profile, accessToken, onUpdateProfile, bettingConsentGranted, requestBettingConsent, onComplete }: {
  profile: BackyardProfile;
  accessToken: string | null;
  onUpdateProfile: (profile: BackyardProfileUpdate) => Promise<"local" | "cloud">;
  bettingConsentGranted: boolean;
  requestBettingConsent: () => Promise<boolean>;
  onComplete: () => void;
}) {
  const [progress, setProgress] = useState<BetaOnboardingProgress | null>(null);
  const [draft, setDraft] = useState<BetaDraft | null>(null);
  const [message, setMessage] = useState("");
  const [playerMode, setPlayerMode] = useState<"local" | "guest" | "invite">("local");
  const [localPlayerId, setLocalPlayerId] = useState("");
  const [newPlayer, setNewPlayer] = useState({ name: "", email: "", handicap: "" });
  const frequentPlayers = useMemo(() => typeof window === "undefined" ? [] : readStoredJson<FrequentPlayer[]>(localStorage, STORAGE_KEYS.frequentPlayers, []), []);

  useEffect(() => {
    const existing = readBetaOnboardingProgress(localStorage, profile.userId) || createBetaOnboardingProgress(profile.userId);
    let storedDraft: unknown = null;
    try { storedDraft = JSON.parse(localStorage.getItem(betaOnboardingDraftStorageKey(profile.userId)) || "null"); }
    catch { /* A corrupt optional draft restarts only this onboarding. */ }
    const nextDraft = safeDraft(storedDraft, profile);
    persistBetaOnboardingProgress(localStorage, existing);
    setProgress(existing);
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
    const next = advanceBetaOnboarding(progress, nextStep, { skipped, groupId });
    persistBetaOnboardingProgress(localStorage, next);
    setProgress(next);
    setMessage("");
    window.scrollTo({ top: 0, behavior: "smooth" });
  };
  const finish = (groupId?: string) => {
    const complete = completeBetaOnboarding(progress, { groupId });
    persistBetaOnboardingProgress(localStorage, complete);
    localStorage.removeItem(betaOnboardingDraftStorageKey(profile.userId));
    setProgress(complete);
    onComplete();
  };
  const updateGroup = (patch: Partial<GroupDraft>) => setDraft((current) => current ? ({ ...current, group: { ...current.group, ...patch } }) : current);
  const template = draft.group.template || initialTemplate(draft.group.members);
  const players = groupPlayers(draft.group.members);
  const setTemplate: React.Dispatch<React.SetStateAction<GroupGameTemplate>> = (action) => setDraft((current) => {
    if (!current) return current;
    const prior = current.group.template || initialTemplate(current.group.members);
    return { ...current, group: { ...current.group, template: typeof action === "function" ? action(prior) : action } };
  });

  if (progress.step === "equipment") return <EquipmentOnboarding
    userId={profile.userId}
    accessToken={accessToken}
    defaultHandicap={profile.defaultHandicap}
    ballFitDefaults={ballFitDefaultsFromProfile(profile)}
    onComplete={() => advance("improvements")}
  />;

  if (progress.step === "ghin") return <Shell progress={progress} eyebrow="HANDICAP" title="Vincular GHIN" description="Cuando exista una integración oficial, podrás mantener tu índice actualizado sin capturas repetidas." actions={<button className="primary big" onClick={async () => { await onUpdateProfile({ displayName: profile.displayName, avatarUrl: profile.avatarUrl, defaultHandicap: profile.defaultHandicap, ghinLinkStatus: "SKIPPED" }); advance("equipment", true); }}>Omitir por ahora</button>}>
    <div className={styles.benefitList}><span>✓ Sincronizar tu índice</span><span>✓ Mantener el HCP actualizado</span><span>✓ Mejorar la precisión de estadísticas</span><span>✓ Preparar futuras funciones oficiales</span></div>
    <button className={styles.comingSoon} disabled>Vincular GHIN <b>PRÓXIMAMENTE</b></button>
    <p className={styles.trust}>No usamos scraping, APIs privadas ni simulamos una conexión. La arquitectura ya acepta un HandicapProvider autorizado cuando esté disponible.</p>
  </Shell>;

  if (progress.step === "improvements") return <Shell progress={progress} eyebrow="TU JUEGO" title="¿Qué te gustaría mejorar?" description="Elige todas las áreas que quieras. Esto formará parte de tu Golf Profile y preparará Mi Coach." actions={<button className="primary big" disabled={!draft.improvementGoals.length} onClick={async () => { await onUpdateProfile({ displayName: profile.displayName, avatarUrl: profile.avatarUrl, defaultHandicap: profile.defaultHandicap, improvementGoals: draft.improvementGoals, golfProfileUpdatedAt: new Date().toISOString() }); advance("objective"); }}>Continuar</button>}>
    <div className={styles.choiceGrid}>{GOLF_IMPROVEMENT_GOALS.map((goal) => { const active = draft.improvementGoals.includes(goal); return <button type="button" key={goal} className={active ? styles.choiceActive : styles.choice} onClick={() => setDraft((current) => current ? { ...current, improvementGoals: active ? current.improvementGoals.filter((item) => item !== goal) : [...current.improvementGoals, goal] } : current)}>{active ? "✓ " : ""}{IMPROVEMENT_LABELS[goal]}</button>; })}</div>
  </Shell>;

  if (progress.step === "objective") return <Shell progress={progress} eyebrow="OBJETIVO" title="¿Cuál es tu objetivo?" description="Podrás cambiarlo después desde tu perfil." actions={<button className="primary big" disabled={!draft.primaryGoal} onClick={async () => {
    const parsedTarget = Number(draft.targetHandicap);
    if (draft.primaryGoal === "LOWER_HANDICAP" && (!Number.isFinite(parsedTarget) || parsedTarget < -15 || parsedTarget > 54)) { setMessage("Escribe un HCP objetivo válido entre +15.0 y 54.0."); return; }
    const targetHandicap = draft.primaryGoal === "LOWER_HANDICAP" ? parsedTarget : null;
    await onUpdateProfile({ displayName: profile.displayName, avatarUrl: profile.avatarUrl, defaultHandicap: profile.defaultHandicap, primaryGoal: draft.primaryGoal, targetHandicap, golfProfileUpdatedAt: new Date().toISOString() }); advance("plan");
  }}>Continuar</button>}>
    <div className={styles.goalList}>{GOLF_PRIMARY_GOALS.map((goal) => <button type="button" key={goal} className={draft.primaryGoal === goal ? styles.goalActive : styles.goal} onClick={() => setDraft((current) => current ? { ...current, primaryGoal: goal } : current)}><span>{draft.primaryGoal === goal ? "●" : "○"}</span>{GOAL_LABELS[goal]}</button>)}</div>
    {draft.primaryGoal === "LOWER_HANDICAP" && <div className={styles.hcpGoal}><div><small>HCP ACTUAL</small><strong>{profile.defaultHandicap ?? "—"}</strong></div><label>HCP objetivo<input inputMode="decimal" value={draft.targetHandicap} onChange={(event) => setDraft((current) => current ? { ...current, targetHandicap: event.target.value } : current)} placeholder="Ej. 5.0" /></label></div>}
    {message && <div className={styles.error} role="alert">{message}</div>}
  </Shell>;

  if (progress.step === "plan") return <Shell progress={progress} eyebrow="MEMBRESÍA BETA" title="Elige tu plan" description="No hay cobros ni precios definitivos en esta Beta. La cuenta inicia en GRATIS." actions={<button className="primary big" onClick={async () => { const planId = selectablePlanId(draft.planId); await onUpdateProfile({ displayName: profile.displayName, avatarUrl: profile.avatarUrl, defaultHandicap: profile.defaultHandicap, planId }); advance("group"); }}>Continuar con GRATIS</button>}>
    <div className={styles.planGrid}>{PLAN_CATALOG.map((plan) => <button type="button" key={plan.id} disabled={plan.availability !== "available"} className={`${styles.planCard} ${draft.planId === plan.id ? styles.planSelected : ""}`} onClick={() => setDraft((current) => current ? { ...current, planId: plan.id } : current)}><span>{plan.eyebrow}</span><b>{plan.name}</b><p>{plan.description}</p><small>{plan.availability === "available" ? "Incluido en Beta" : "Próximamente · sin cobro"}</small></button>)}</div>
  </Shell>;

  if (progress.step === "group") return <Shell progress={progress} eyebrow="TU PRIMER GRUPO" title="Configura tu primer grupo" description="Será una plantilla habitual: jugadores, HCP y apuestas listas para reutilizar." actions={<><button className="primary big" disabled={!draft.group.name.trim()} onClick={() => {
    if (draft.group.imageUrl && !/^https:\/\//i.test(draft.group.imageUrl)) { setMessage("Usa una URL HTTPS para la imagen o deja el campo vacío."); return; }
    advance("players");
  }}>Crear grupo</button><button className={styles.skip} onClick={() => finish()}>Omitir por ahora</button></>}>
    <div className={styles.groupIdentity}><div className={styles.groupAvatar}>{draft.group.imageUrl ? <span>⛳</span> : draft.group.name.trim().slice(0, 1).toUpperCase() || "G"}</div><label>Nombre del grupo<input maxLength={80} value={draft.group.name} onChange={(event) => updateGroup({ name: event.target.value })} placeholder="Ej. Domingos" /></label><label>Imagen opcional<input type="url" inputMode="url" value={draft.group.imageUrl} onChange={(event) => updateGroup({ imageUrl: event.target.value })} placeholder="https://…" /></label><label>Privacidad<select value={draft.group.privacy} onChange={(event) => updateGroup({ privacy: event.target.value === "invite_only" ? "invite_only" : "private" })}><option value="private">Privado</option><option value="invite_only">Solo por invitación</option></select></label></div>
    {message && <div className={styles.error} role="alert">{message}</div>}
  </Shell>;

  if (progress.step === "players") {
    const addMember = (member: FrequentGroupMember) => {
      const shell: FrequentGroup = { id: draft.group.groupId, name: draft.group.name, players: draft.group.members, uses: 0, updatedAt: "" };
      const next = addFrequentGroupMember(shell, member);
      if (next === shell) { setMessage("Ese jugador, cuenta o correo ya forma parte del grupo."); return; }
      updateGroup({ members: next.players, template: undefined });
      setNewPlayer({ name: "", email: "", handicap: "" }); setMessage("");
    };
    return <Shell progress={progress} eyebrow="INTEGRANTES" title="Agrega o vincula jugadores" description="Usamos tus jugadores guardados en este dispositivo. Las invitaciones remotas llegarán cuando el sistema social cloud esté listo." actions={<button className="primary big" onClick={() => advance("handicaps")}>Revisar HCP</button>}>
      <div className={styles.memberList}>{draft.group.members.map((member, index) => <article key={member.memberId || index}><span className={styles.memberAvatar}>{member.name.slice(0, 1).toUpperCase()}</span><span><b>{member.name}</b><small>{member.kind === "account" ? "Tu cuenta" : member.kind === "invited" ? `Invitación local · ${member.email}` : member.kind === "friend" ? "Jugador local vinculado" : "Guest"}</small></span><strong>{member.handicap ?? "—"}</strong>{index > 0 && <button type="button" aria-label={`Quitar ${member.name}`} onClick={() => updateGroup({ members: draft.group.members.filter((_, memberIndex) => memberIndex !== index), template: undefined })}>×</button>}</article>)}</div>
      <div className={styles.playerTabs}><button className={playerMode === "local" ? styles.tabActive : ""} onClick={() => setPlayerMode("local")}>Guardado</button><button className={playerMode === "guest" ? styles.tabActive : ""} onClick={() => setPlayerMode("guest")}>Guest</button><button className={playerMode === "invite" ? styles.tabActive : ""} onClick={() => setPlayerMode("invite")}>Invitar</button></div>
      {playerMode === "local" && <div className={styles.addPlayer}><label>Buscar por nombre<select value={localPlayerId} onChange={(event) => setLocalPlayerId(event.target.value)}><option value="">Seleccionar jugador local…</option>{frequentPlayers.map((player) => <option value={player.id} key={player.id}>{player.name}{player.handicap !== null ? ` · HCP ${player.handicap}` : ""}</option>)}</select></label><button className="secondary" disabled={!localPlayerId} onClick={() => { const saved = frequentPlayers.find((player) => player.id === localPlayerId); if (saved) addMember({ memberId: makeId("member"), kind: saved.accountUserId ? "account" : "friend", name: saved.name, handicap: saved.handicap, ...(saved.accountUserId ? { accountUserId: saved.accountUserId } : {}) }); }}>Agregar</button>{!frequentPlayers.length && <p className={styles.trust}>Aún no hay jugadores guardados. Usa Guest; no bloquearemos el grupo.</p>}</div>}
      {playerMode !== "local" && <div className={styles.addPlayer}><label>Nombre<input value={newPlayer.name} onChange={(event) => setNewPlayer((current) => ({ ...current, name: event.target.value }))} placeholder="Nombre del jugador" /></label>{playerMode === "invite" && <label>Email<input type="email" inputMode="email" value={newPlayer.email} onChange={(event) => setNewPlayer((current) => ({ ...current, email: event.target.value }))} placeholder="jugador@correo.com" /></label>}<label>HCP manual (opcional)<input inputMode="decimal" value={newPlayer.handicap} onChange={(event) => setNewPlayer((current) => ({ ...current, handicap: event.target.value }))} placeholder="Ej. 18.0" /></label><button className="secondary" disabled={!newPlayer.name.trim() || (playerMode === "invite" && !newPlayer.email.includes("@"))} onClick={() => { const parsed = newPlayer.handicap.trim() ? Number(newPlayer.handicap) : null; if (parsed !== null && (!Number.isFinite(parsed) || parsed < -15 || parsed > 54)) { setMessage("El HCP debe estar entre +15.0 y 54.0."); return; } addMember({ memberId: makeId("member"), kind: playerMode === "invite" ? "invited" : "guest", name: newPlayer.name.trim(), handicap: parsed, ...(playerMode === "invite" ? { email: newPlayer.email.trim() } : {}) }); }}>{playerMode === "invite" ? "Guardar invitación" : "Agregar guest"}</button></div>}
      {message && <div className={styles.error} role="alert">{message}</div>}
    </Shell>;
  }

  if (progress.step === "handicaps") return <Shell progress={progress} eyebrow="HANDICAPS" title="Revisa los handicaps" description="Estos valores serán el HCP habitual del grupo. En cada ronda podrás usar un valor distinto sin cambiar el perfil permanente." actions={<button className="primary big" onClick={() => { updateGroup({ template: initialTemplate(draft.group.members) }); advance("bets"); }}>Configurar apuestas</button>}>
    <div className={styles.hcpList}>{draft.group.members.map((member, index) => <label key={member.memberId || index}><span><b>{member.name}</b><small>{member.kind === "account" ? "Perfil" : "Manual"}</small></span><input inputMode="decimal" value={member.handicap ?? ""} onChange={(event) => { const input = event.target.value; const handicap = input === "" ? null : Number(input); if (handicap !== null && (!Number.isFinite(handicap) || handicap < -15 || handicap > 54)) return; updateGroup({ members: draft.group.members.map((item, memberIndex) => memberIndex === index ? { ...item, handicap } : item) }); }} placeholder="HCP" /></label>)}</div>
  </Shell>;

  if (progress.step === "bets") return <Shell progress={progress} eyebrow="JUEGO HABITUAL" title="Configura las apuestas habituales" description="Estas son las modalidades reales que ya existen en The Backyard. No se modifica ninguna regla matemática." actions={<button className="primary big" onClick={() => advance("bet_details")}>{activeBetCount(template) ? "Configurar detalles" : "Continuar sin apuestas"}</button>}>
    <GroupBetTemplateEditor value={template} players={players} ownerId={template.ownerMemberId} mode="selection" onChange={setTemplate} requestActivation={bettingConsentGranted ? undefined : requestBettingConsent} />
  </Shell>;

  if (progress.step === "bet_details") {
    const saveGroup = () => {
      const normalizedTemplate = normalizeGroupGameTemplate(template, draft.group.members);
      if (!normalizedTemplate) { setMessage("No pudimos preparar la plantilla. Revisa los integrantes."); return; }
      const issues = collectBetConfigurationIssues({ players, ownerId: normalizedTemplate.ownerMemberId, bets: normalizedTemplate.betConfig, segments: normalizedTemplate.foursomeSegments, personalBets: normalizedTemplate.personalBets, supplementalBets: normalizedTemplate.supplementalBets, manualBets: normalizedTemplate.manualBets, roundHoles: normalizedTemplate.roundDefaults.roundHoles, startHole: normalizedTemplate.roundDefaults.startHole, handicapBasis: normalizedTemplate.roundDefaults.handicapBasis });
      if (issues.length) { setMessage(issues.map((issue) => issue.message).join(" ")); return; }
      const existing = parseFrequentGroups(localStorage.getItem(STORAGE_KEYS.frequentGroups));
      if (existing.some((group) => group.id !== draft.group.groupId && group.name.trim().toLocaleLowerCase("es-MX") === draft.group.name.trim().toLocaleLowerCase("es-MX"))) { setMessage("Ya existe un grupo con ese nombre. Regresa y elige otro."); return; }
      const group: FrequentGroup = { id: draft.group.groupId, name: draft.group.name.trim(), ...(draft.group.imageUrl.trim() ? { imageUrl: draft.group.imageUrl.trim() } : {}), privacy: draft.group.privacy, players: draft.group.members, gameTemplate: normalizedTemplate, uses: 0, updatedAt: new Date().toISOString() };
      localStorage.setItem(STORAGE_KEYS.frequentGroups, serializeFrequentGroups([group, ...existing.filter((item) => item.id !== group.id)]));
      updateGroup({ template: normalizedTemplate });
      advance("ready", false, group.id);
    };
    return <Shell progress={progress} eyebrow="DETALLES" title={activeBetCount(template) ? "Ajusta los detalles habituales" : "Sin apuestas habituales"} description={activeBetCount(template) ? "Valores, participantes, equipos, HCP y demás preferencias se guardarán en Domingos; nunca resultados." : "Puedes guardar el grupo solo con sus jugadores y agregar apuestas después."} actions={<button className="primary big" onClick={saveGroup}>Guardar grupo</button>}>
      {activeBetCount(template) ? <GroupBetTemplateEditor value={template} players={players} ownerId={template.ownerMemberId} mode="details" onChange={setTemplate} requestActivation={bettingConsentGranted ? undefined : requestBettingConsent} /> : <div className={styles.emptyState}><span>⛳</span><b>Grupo básico listo</b><p>La plantilla abrirá con las apuestas desactivadas.</p></div>}
      {message && <div className={styles.error} role="alert">{message}</div>}
    </Shell>;
  }

  if (progress.step === "ready") return <Shell progress={progress} eyebrow="GRUPO LISTO" title="¡Listo!" description={`Tu grupo ${draft.group.name.trim()} ha sido creado correctamente.`} actions={<><button className="primary big" onClick={() => finish(progress.groupId)}>Ir al inicio</button><button className="secondary big" onClick={() => { const nextDraft = freshDraft(profile); setDraft(nextDraft); const next = { ...progress, status: "in_progress" as const, step: "group" as const, groupId: undefined, updatedAt: new Date().toISOString() }; persistBetaOnboardingProgress(localStorage, next); setProgress(next); }}>Crear otro grupo</button></>}>
    <div className={styles.readyMark}>✓</div><div className={styles.readySummary}><span>{draft.group.members.length} jugadores</span><span>{activeBetCount(template)} apuestas habituales</span><span>{draft.group.privacy === "private" ? "Privado" : "Solo invitación"}</span></div>
  </Shell>;

  return null;
}
