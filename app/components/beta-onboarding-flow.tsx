"use client";

import { useEffect, useRef, useState } from "react";
import { useViewScrollReset } from "./use-view-scroll-reset";
import { CatalogCoursePicker } from './catalog-course-picker';
import { InitialOnboardingConsents } from './account-consent-checkpoint';
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
import { PLAN_CATALOG, selectablePlanId, type PlanId } from "../../lib/plans";
import { STORAGE_KEYS } from "../../lib/round-utils";
import { ballFitDefaultsFromProfile } from "../../lib/ball-fitting";
import { BrandLockup } from "./brand-lockup";
import { EquipmentOnboarding } from "./equipment-onboarding";
import { HandicapSourceSelector } from "./handicap-source-selector";
import { ModalShell } from "./modal-shell";
import { InitialDevicePermissions } from "./device-permission-settings";
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

type BetaDraft = {
  improvementGoals: GolfImprovementGoal[];
  primaryGoals: Exclude<GolfPrimaryGoal, "">[];
  targetHandicap: string;
  planId: PlanId;
};

function freshDraft(profile: BackyardProfile): BetaDraft {
  return {
    improvementGoals: [...(profile.improvementGoals || [])],
    primaryGoals: [...(profile.primaryGoals || (profile.primaryGoal ? [profile.primaryGoal] : []))],
    targetHandicap: profileHandicapInput(profile.targetHandicap ?? null),
    planId: selectablePlanId(profile.planId),
  };
}

function safeDraft(value: unknown, profile: BackyardProfile): BetaDraft {
  const fallback = freshDraft(profile);
  if (!value || typeof value !== "object") return fallback;
  const raw = value as Partial<BetaDraft>;
  return {
    improvementGoals: Array.isArray(raw.improvementGoals)
      ? raw.improvementGoals.filter((goal): goal is GolfImprovementGoal => (GOLF_IMPROVEMENT_GOALS as readonly string[]).includes(String(goal)))
      : fallback.improvementGoals,
    primaryGoals: Array.isArray(raw.primaryGoals)
      ? [...new Set(raw.primaryGoals.filter((goal): goal is Exclude<GolfPrimaryGoal, ""> => typeof goal === "string" && (GOLF_PRIMARY_GOALS as readonly string[]).includes(goal)))]
      : fallback.primaryGoals,
    targetHandicap: typeof raw.targetHandicap === "string" ? raw.targetHandicap : fallback.targetHandicap,
    planId: selectablePlanId(raw.planId),
  };
}

function Shell({ progress, eyebrow, title, description, children, actions, onBack, onSaveAndExit }: { progress: BetaOnboardingProgress; eyebrow: string; title: string; description?: string; children: React.ReactNode; actions: React.ReactNode; onBack?: () => void; onSaveAndExit?: () => void }) {
  const visibleSteps: BetaOnboardingStep[] = progress.mode === "quick"
    ? ["welcome", "course", "ghin", "permissions"]
    : ["welcome", "course", "ghin", "equipment", "improvements", "objective", "plan", "permissions"];
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

const acceptNoInitialConsent = async () => undefined;

export function BetaOnboardingFlow({ profile, accessToken, onUpdateProfile, legalConsentRequired = false, onAcceptInitialConsents = acceptNoInitialConsent, onComplete }: {
  profile: BackyardProfile;
  accessToken: string | null;
  onUpdateProfile: (profile: BackyardProfileUpdate) => Promise<"local" | "cloud">;
  legalConsentRequired?: boolean;
  onAcceptInitialConsents?: (betting: boolean) => Promise<void>;
  onComplete: () => void;
}) {
  const [progress, setProgress] = useState<BetaOnboardingProgress | null>(null);
  useViewScrollReset(progress?.step ?? null);
  const [draft, setDraft] = useState<BetaDraft | null>(null);
  const [message, setMessage] = useState("");
  const [entryMode, setEntryMode] = useState<"quick" | "complete" | null>(null);
  const [homeClubSelectionReady, setHomeClubSelectionReady] = useState(Boolean(profile.homeClubId && profile.homeCourseId));
  const initializedUser = useRef('');
  const checkpointQueue = useRef<Promise<void>>(Promise.resolve());
  const [finishing, setFinishing] = useState(false);
  const [initialConsentsReady, setInitialConsentsReady] = useState(false);
  const finishingRef = useRef(false);
  const checkpoint = (value: BetaOnboardingProgress) => {
    const write = checkpointQueue.current.catch(() => {}).then(() => saveOnboardingCheckpoint(accessToken || '', value));
    checkpointQueue.current = write;
    return write;
  };

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

  const advance = (nextStep: BetaOnboardingStep, skipped = false) => {
    const next = advanceBetaOnboarding({ ...progress, ...(entryMode ? { mode: entryMode } : {}) }, nextStep, { skipped });
    persistBetaOnboardingProgress(localStorage, next);
    void checkpoint(next).catch(error => setMessage(error.message));
    setProgress(next);
    setMessage("");
    window.scrollTo({ top: 0, behavior: "smooth" });
  };
  const finish = () => {
    if (finishingRef.current) return;
    finishingRef.current = true; setFinishing(true);
    const complete = completeBetaOnboarding(progress);
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
    permissions: entryMode === "quick" ? "ghin" : "plan",
  };
  const navigationProps = {
    ...(previousByStep[progress.step] ? { onBack: () => goTo(previousByStep[progress.step]!) } : {}),
    onSaveAndExit: () => {
      try {
        localStorage.setItem(betaOnboardingDraftStorageKey(profile.userId), JSON.stringify(draft));
        persistBetaOnboardingProgress(localStorage, progress);
        onComplete();
      } catch { setMessage("No pudimos guardar el borrador. Reintenta antes de salir."); }
    },
  };

  if (progress.step === "course") return <Shell progress={progress} {...navigationProps} eyebrow="TU CAMPO" title="Elige tu Home Club" description="Busca tu club habitual o explora los campos cercanos. No estás iniciando una ronda." actions={<button className="primary big" disabled={!profile.homeClubId || !profile.homeCourseId || !homeClubSelectionReady} onClick={() => advance('ghin')}>Continuar: Handicap / Índice</button>}>
    <CatalogCoursePicker purpose="home-club" token={accessToken} selectedName={[profile.homeClub,profile.homeCourse].filter(Boolean).join(' · ')} onSelectionReadyChange={setHomeClubSelectionReady} onSelectHomeCourse={async selection => {
      setMessage('');
      const result=await onUpdateProfile({ displayName: profile.displayName, avatarUrl: profile.avatarUrl, defaultHandicap: profile.defaultHandicap, homeClub: selection.clubName, homeClubId: selection.clubId, homeCourse: selection.courseName, homeCourseId: selection.courseId });
      if(result!=='cloud')throw new Error('No pudimos confirmar tu Home Club en la nube. Reintenta para continuar.');
    }} />
    <p>Este campo queda como tu club habitual. Podrás cambiarlo en Perfil.</p>{message && <p role="alert">{message}</p>}
  </Shell>;
  if (progress.step === "welcome") return <Shell progress={progress} {...navigationProps} eyebrow="EMPIEZA A TU MANERA" title="Tu Backyard, sin fricción" description="En ambas opciones elegirás tu campo e índice. Después puedes completar equipo, objetivos y grupos." actions={<button type="button" className="primary big" disabled={!entryMode || !initialConsentsReady} onClick={() => advance("course")}>CONTINUAR</button>}>
    <div className={styles.welcomeHero} aria-hidden="true"><span className={styles.heroFlag}>⛳</span><div><b>Tu golf, en un solo lugar</b><small>Rondas rápidas · amigos · equipo · estadísticas</small></div><span className={styles.heroBall}>●</span></div>
    <div className={styles.entryGrid}>
      <button type="button" className={entryMode === "quick" ? styles.entrySelected : styles.entryChoice} aria-pressed={entryMode === "quick"} onClick={() => setEntryMode("quick")}><span aria-hidden="true">⚡</span><div><b>Rápida</b><p>Elige tu Home Club, fuente de índice y permisos opcionales. Equipo y fitting quedan disponibles para después.</p></div></button>
      <button type="button" className={entryMode === "complete" ? styles.entrySelected : styles.entryChoice} aria-pressed={entryMode === "complete"} onClick={() => setEntryMode("complete")}><span aria-hidden="true">⛳</span><div><b>Completa</b><p>Configura Home Club, índice, bolsa, objetivos y permisos opcionales.</p></div></button>
    </div>
    <InitialOnboardingConsents key={profile.userId} userId={profile.userId} accessToken={accessToken} legalRequired={legalConsentRequired} onAcceptLegal={onAcceptInitialConsents} onReadyChange={setInitialConsentsReady} />
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

  if (progress.step === "ghin") return <Shell progress={progress} {...navigationProps} eyebrow="HANDICAP / ÍNDICE" title="Elige tu fuente de índice" description="Puedes activar Backyard Index sin rondas previas. GHIN estará disponible mediante una integración oficial." actions={<button className="primary big" disabled={finishing} onClick={async () => { try { await onUpdateProfile({ displayName: profile.displayName, avatarUrl: profile.avatarUrl, defaultHandicap: profile.defaultHandicap, ghinLinkStatus: profile.ghinLinkStatus || "SKIPPED" }); if (entryMode === 'quick') advance("permissions"); else advance("equipment", true); } catch(error) { setMessage(error instanceof Error ? error.message : 'No pudimos guardar. Reintenta.'); } }}>{finishing ? 'Guardando…' : 'Continuar'}</button>}>
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

  if (progress.step === "plan") return <Shell progress={progress} {...navigationProps} eyebrow="MEMBRESÍA BETA" title="Elige tu plan" description="No hay cobros ni precios definitivos en esta Beta. La cuenta inicia en GRATIS." actions={<button className="primary big" onClick={async () => { const planId = selectablePlanId(draft.planId); await onUpdateProfile({ displayName: profile.displayName, avatarUrl: profile.avatarUrl, defaultHandicap: profile.defaultHandicap, planId }); advance("permissions"); }}>Continuar con GRATIS</button>}>
    <div className={styles.planGrid}>{PLAN_CATALOG.map((plan) => <button type="button" key={plan.id} disabled={plan.availability !== "available"} className={`${styles.planCard} ${draft.planId === plan.id ? styles.planSelected : ""}`} onClick={() => setDraft((current) => current ? { ...current, planId: plan.id } : current)}><span>{plan.eyebrow}</span><b>{plan.name}</b><p>{plan.description}</p><small>{plan.availability === "available" ? "Incluido en Beta" : "Próximamente · sin cobro"}</small></button>)}</div>
  </Shell>;

  if (progress.step === "permissions") return <Shell progress={progress} {...navigationProps} eyebrow="PERMISOS OPCIONALES" title="Decide una sola vez" description="Puedes usar The Backyard sin ubicación ni notificaciones. Después podrás revisar o desactivar estos permisos desde Configuración." actions={null}>
    <InitialDevicePermissions userId={profile.userId} onContinue={finish} />
  </Shell>;

  return null;
}
