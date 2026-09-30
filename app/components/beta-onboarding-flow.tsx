"use client";

import Image from "next/image";
import { useEffect, useRef, useState, type RefObject } from "react";
import { useViewScrollReset } from "./use-view-scroll-reset";
import { CatalogCoursePicker } from "./catalog-course-picker";
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
  requiredBetaOnboardingResume,
  type BetaOnboardingProgress,
  type BetaOnboardingStep,
} from "../../lib/beta-onboarding";
import { PLAN_CATALOG, selectablePlanId, type PlanId } from "../../lib/plans";
import { STORAGE_KEYS } from "../../lib/round-utils";
import { ballFitDefaultsFromProfile } from "../../lib/ball-fitting";
import { selectedHandicapIndex } from "../../lib/handicap-source";
import { BrandLockup } from "./brand-lockup";
import { EquipmentOnboarding } from "./equipment-onboarding";
import { HandicapSourceChoices, ghinIndexHeading } from "./handicap-source-selector";
import { ModalShell } from "./modal-shell";
import { InitialDevicePermissions } from "./device-permission-settings";
import { useGhinReadOnlyProfile } from "./use-ghin-read-only-profile";
import { useBackyardIndexPreference } from "./use-backyard-index-preference";
import { requestFeedback } from "./feedback-dialog";
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
  LOWER_HANDICAP: "Bajar mi hándicap",
};

const IMPROVEMENT_VISUALS: Record<GolfImprovementGoal, string> = {
  DRIVER: "/brand/equipment/backyard-driver-clean.png",
  IRONS: "/brand/equipment/backyard-irons-clean.png",
  APPROACH: "/brand/ball-fit/improvements/approach-target.svg",
  SHORT_GAME: "/brand/equipment/backyard-wedge-clean.png",
  BUNKER: "/brand/ball-fit/improvements/bunker.svg",
  PUTTING: "/brand/equipment/backyard-putter-clean.png",
  CONSISTENCY: "/brand/ball-fit/improvements/consistency-bars.svg",
  COURSE_STRATEGY: "/brand/ball-fit/improvements/course-strategy.svg",
  MENTAL_CONFIDENCE: "/brand/ball-fit/improvements/mental-confidence.svg",
  LOWER_HANDICAP: "/brand/ball-fit/improvements/lower-handicap.svg",
};

const IMPROVEMENT_DESCRIPTIONS: Record<GolfImprovementGoal, string> = {
  DRIVER: "Más distancia y precisión.",
  IRONS: "Mayor control en todas las distancias.",
  APPROACH: "Acércate más a la bandera.",
  SHORT_GAME: "Mejora chips, pitches y lies difíciles.",
  BUNKER: "Más confianza desde la arena.",
  PUTTING: "Más consistencia en el green.",
  CONSISTENCY: "Mantén un nivel más estable.",
  COURSE_STRATEGY: "Toma mejores decisiones.",
  MENTAL_CONFIDENCE: "Juega con una mente más fuerte.",
  LOWER_HANDICAP: "Progresa y alcanza tus metas.",
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

type OnboardingEntryMode = "quick" | "complete";

export function withBetaOnboardingMode(progress: BetaOnboardingProgress, mode: OnboardingEntryMode, now = new Date().toISOString()): BetaOnboardingProgress {
  return { ...progress, mode, updatedAt: now };
}

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
    ? ["welcome", "permissions", "course", "ghin"]
    : ["welcome", "permissions", "course", "ghin", "equipment", "improvements", "objective", "plan"];
  const index = Math.max(0, visibleSteps.indexOf(progress.step));
  const titleRef = useRef<HTMLHeadingElement>(null);
  const [confirmExit, setConfirmExit] = useState(false);
  const [highContrast, setHighContrast] = useState(true);
  useEffect(() => { setHighContrast(localStorage.getItem(STORAGE_KEYS.contrast) !== 'false'); }, []);
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "auto" });
    titleRef.current?.focus({ preventScroll: true });
  }, [progress.step]);
  return <main className={`${styles.screen} ${highContrast ? 'highContrast' : ''}`} data-onboarding-step={progress.step}><section className={styles.card}>
    <header className={styles.header}><BrandLockup compact /><span className={styles.brandPromise} aria-hidden="true">GOLF<br />FOR A<br />BETTER YOU</span><span className={styles.step}>PASO {index + 1} DE {visibleSteps.length}</span>{onSaveAndExit && <button type="button" className="textButton" onClick={() => setConfirmExit(true)}>Guardar y salir</button>}</header>
    <div className={styles.progress}><span style={{ width: `${((index + 1) / visibleSteps.length) * 100}%` }} /></div>
    <div className={styles.copy}><div className={styles.eyebrow}>{eyebrow}</div><h1 ref={titleRef} tabIndex={-1}>{title}</h1>{description && <p>{description}</p>}<span className={styles.heroScript} aria-hidden="true">More<br />Golf Ahead</span></div>
    <div className={styles.body}>{children}</div><footer className={styles.actions}>{actions}<div className={styles.flowNav}>{onBack && <button type="button" className="textButton" onClick={onBack}>← Anterior</button>}</div></footer>
    <div className={styles.brandFooter} aria-hidden="true"><span />TU JUEGO. UN MEJOR TÚ.<span /></div>
  </section><ModalShell open={confirmExit} onClose={() => setConfirmExit(false)} label="Guardar configuración y salir"><h2>¿Guardar esta configuración y continuar después?</h2><p>Conservaremos el borrador en este dispositivo.</p><div className="dialogActions"><button type="button" className="secondary" onClick={() => setConfirmExit(false)}>Cancelar</button><button type="button" className="primary" onClick={() => { setConfirmExit(false); onSaveAndExit?.(); }}>Guardar y salir</button></div></ModalShell></main>;
}

export function OnboardingWelcomeStep({
  profileUserId,
  accessToken,
  legalConsentRequired,
  entryMode,
  consentSectionRef,
  onSelectEntryMode,
  onAcceptRequiredConsents,
  onContinue,
}: {
  profileUserId: string;
  accessToken: string | null;
  legalConsentRequired: boolean;
  entryMode: OnboardingEntryMode | null;
  consentSectionRef: RefObject<HTMLDivElement | null>;
  onSelectEntryMode: (mode: OnboardingEntryMode) => void;
  onAcceptRequiredConsents: () => Promise<void>;
  onContinue: () => void;
}) {
  return <>
    <div className={styles.welcomeHero} aria-hidden="true"><span className={styles.heroFlag}>⛳</span><div><b>Tu golf, en un solo lugar</b><small>Rondas rápidas · amigos · equipo · estadísticas</small></div><span className={styles.heroBall}>●</span></div>
    <div className={styles.entryGrid}>
      <button type="button" className={entryMode === "quick" ? styles.entrySelected : styles.entryChoice} aria-pressed={entryMode === "quick"} onClick={() => onSelectEntryMode("quick")}><span aria-hidden="true">⚡</span><div><b>Rápida</b><p>Elige tu campo habitual, fuente de índice y permisos opcionales. Equipo y fitting quedan disponibles para después.</p></div></button>
      <button type="button" className={entryMode === "complete" ? styles.entrySelected : styles.entryChoice} aria-pressed={entryMode === "complete"} onClick={() => onSelectEntryMode("complete")}><span aria-hidden="true">⛳</span><div><b>Completa</b><p>Configura campo habitual, índice, bolsa, objetivos y permisos opcionales.</p></div></button>
    </div>
    {entryMode && <div ref={consentSectionRef} data-onboarding-consents-revealed="true">
      <InitialOnboardingConsents key={profileUserId} userId={profileUserId} accessToken={accessToken} legalRequired={legalConsentRequired} canContinue={Boolean(entryMode)} onAcceptRequired={onAcceptRequiredConsents} onContinue={onContinue} />
    </div>}
  </>;
}

const acceptNoInitialConsent = async () => undefined;
export function BetaOnboardingFlow({ profile, accessToken, onUpdateProfile, legalConsentRequired = false, onAcceptRequiredConsents = acceptNoInitialConsent, onComplete }: {
  profile: BackyardProfile;
  accessToken: string | null;
  onUpdateProfile: (profile: BackyardProfileUpdate) => Promise<"local" | "cloud">;
  legalConsentRequired?: boolean;
  onAcceptRequiredConsents?: () => Promise<void>;
  onComplete: () => void;
}) {
  const [progress, setProgress] = useState<BetaOnboardingProgress | null>(null);
  const ghinControl = useGhinReadOnlyProfile(accessToken);
  const indexControl = useBackyardIndexPreference(profile.userId, Boolean(accessToken));
  const accountIndex = selectedHandicapIndex(indexControl.preference, [], profile.userId, ghinControl.profile);
  useViewScrollReset(progress?.step ?? null);
  const [draft, setDraft] = useState<BetaDraft | null>(null);
  const [message, setMessage] = useState("");
  const [entryMode, setEntryMode] = useState<"quick" | "complete" | null>(null);
  const [homeClubSelectionReady, setHomeClubSelectionReady] = useState(Boolean(profile.homeClubId && profile.homeCourseId));
  const initializedUser = useRef('');
  const consentSectionRef = useRef<HTMLDivElement>(null);
  const checkpointQueue = useRef<Promise<void>>(Promise.resolve());
  const [finishing, setFinishing] = useState(false);
  const finishingRef = useRef(false);
  const checkpoint = (value: BetaOnboardingProgress) => {
    const write = checkpointQueue.current.catch(() => {}).then(() => saveOnboardingCheckpoint(accessToken || '', value));
    checkpointQueue.current = write;
    return write;
  };

  useEffect(() => {
    if (initializedUser.current === profile.userId) return;
    initializedUser.current = profile.userId;
    const restored = readBetaOnboardingProgress(localStorage, profile.userId) || createBetaOnboardingProgress(profile.userId);
    const existing = requiredBetaOnboardingResume(restored, {
      homeCourseSelected: Boolean(profile.homeClubId && profile.homeCourseId),
    });
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
  const selectEntryMode = (mode: OnboardingEntryMode) => {
    setEntryMode(mode);
    const next = withBetaOnboardingMode(progress, mode);
    persistBetaOnboardingProgress(localStorage, next);
    setMessage("");
    window.requestAnimationFrame(() => consentSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" }));
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
    permissions: "welcome", course: "permissions", ghin: "course", equipment: "ghin", improvements: "equipment", objective: "improvements", plan: "objective",
  };
  const navigationProps = {
    ...(previousByStep[progress.step] ? { onBack: () => goTo(previousByStep[progress.step]!) } : {}),
    onSaveAndExit: () => {
      try {
        localStorage.setItem(betaOnboardingDraftStorageKey(profile.userId), JSON.stringify(draft));
        persistBetaOnboardingProgress(localStorage, entryMode ? withBetaOnboardingMode(progress, entryMode) : progress);
        onComplete();
      } catch { setMessage("No pudimos guardar el borrador. Reintenta antes de salir."); }
    },
  };

  if (progress.step === "course") return <Shell progress={progress} {...navigationProps} eyebrow="TU CAMPO" title="Elige tu campo habitual" description="Busca tu club habitual, revisa campos relevantes o usa la ubicación que ya autorizaste para ordenar los más cercanos." actions={<button className="primary big" disabled={!profile.homeClubId || !profile.homeCourseId || !homeClubSelectionReady} onClick={() => advance("ghin")}>Continuar: Handicap / Índice</button>}>
    <CatalogCoursePicker key={`onboarding-home-${profile.userId}`} purpose="home-club" token={accessToken} permissionOwnerId={profile.userId} selectedName={[profile.homeClub, profile.homeCourse].filter(Boolean).join(" · ")} selectedClubId={profile.homeClubId} selectedCourseId={profile.homeCourseId} onSelectionReadyChange={setHomeClubSelectionReady} onRequest={(searchedName) => requestFeedback("COURSE", searchedName ? { name: searchedName } : undefined)} onSelectHomeCourse={async (selection) => {
      setMessage("");
      await onUpdateProfile({ displayName: profile.displayName, avatarUrl: profile.avatarUrl, defaultHandicap: profile.defaultHandicap, homeClub: selection.clubName, homeClubId: selection.clubId, homeCourse: selection.courseName, homeCourseId: selection.courseId });
    }} />
    <p>Este campo queda como tu club habitual. Podrás cambiarlo en Perfil.</p>{message && <p role="alert">{message}</p>}
  </Shell>;
  if (progress.step === "welcome") return <Shell progress={progress} {...navigationProps} eyebrow="EMPIEZA A TU MANERA" title="Tu Backyard, sin fricción" description="En ambas opciones elegirás tu campo habitual, fuente de índice y permisos opcionales." actions={null}>
    <OnboardingWelcomeStep profileUserId={profile.userId} accessToken={accessToken} legalConsentRequired={legalConsentRequired} entryMode={entryMode} consentSectionRef={consentSectionRef} onSelectEntryMode={selectEntryMode} onAcceptRequiredConsents={onAcceptRequiredConsents} onContinue={() => advance("permissions")} />
  </Shell>;

  if (progress.step === "equipment") return <EquipmentOnboarding
    userId={profile.userId}
    accessToken={accessToken}
    defaultHandicap={accountIndex.value}
    defaultHandicapSource={accountIndex.source}
    defaultHandedness={profile.handedness}
    ballFitDefaults={ballFitDefaultsFromProfile(profile)}
    onComplete={() => advance("improvements")}
    onBack={() => goTo("ghin")}
    onSaveAndExit={onComplete}
  />;

  if (progress.step === "ghin") {
    const ghinLinked = ghinControl.profile?.associationStatus === "VERIFIED";
    const continueFlow = () => {
      if (entryMode === "quick") {
        setFinishing(false);
        finish();
        return true;
      }
      advance("equipment", true);
      return false;
    };
    const saveProfileSource = async () => {
      const linked=ghinControl.profile?.associationStatus==="VERIFIED";
      await onUpdateProfile({ displayName: profile.displayName, avatarUrl: profile.avatarUrl, defaultHandicap: profile.defaultHandicap, ghinLinkStatus: linked ? "LINKED" : profile.ghinLinkStatus === "LINKED" ? "LINKED" : "SKIPPED" });
    };
    const sourceChosen = accountIndex.source === "GHIN" || accountIndex.source === "BACKYARD";
    return <Shell progress={progress} {...navigationProps} eyebrow="HANDICAP / ÍNDICE" title={ghinLinked ? ghinIndexHeading(ghinControl.profile?.handicapIndex) : "Elige tu fuente de índice"} description={ghinLinked ? "GHIN está vinculado y activo. Para elegir otra fuente, primero desvincula GHIN." : "Vincula GHIN o usa Backyard Index como tu fuente de índice."} actions={sourceChosen ? <button className="primary big" disabled={finishing} onClick={async () => { let delegated = false; try { setFinishing(true); await saveProfileSource(); delegated = continueFlow(); } catch(error) { setMessage(error instanceof Error ? error.message : 'No pudimos guardar. Reintenta.'); } finally { if (!delegated) setFinishing(false); } }}>{finishing ? 'Guardando…' : 'Continuar con esta fuente'}</button> : null}>
    <HandicapSourceChoices control={indexControl} authenticated={Boolean(profile.userId && profile.userId !== "guest")} ghinControl={ghinControl} />
    <p className={styles.trust}>Elige GHIN o Backyard Index para continuar.</p>{message && <p role="alert">{message}</p>}
  </Shell>;
  }

  if (progress.step === "improvements") return <Shell progress={progress} {...navigationProps} eyebrow="TU JUEGO" title="¿Qué te gustaría mejorar?" description="Elige todas las áreas que quieras. Usaremos estas señales para personalizar recomendaciones, IA, análisis y ejercicios." actions={<button className="primary big" disabled={!draft.improvementGoals.length} onClick={async () => { await onUpdateProfile({ displayName: profile.displayName, avatarUrl: profile.avatarUrl, defaultHandicap: profile.defaultHandicap, improvementGoals: draft.improvementGoals, golfProfileUpdatedAt: new Date().toISOString() }); advance("objective"); }}>CONTINUAR →</button>}>
    <div className={styles.choiceGrid}>{GOLF_IMPROVEMENT_GOALS.map((goal) => {
      const active = draft.improvementGoals.includes(goal);
      const visual = IMPROVEMENT_VISUALS[goal];
      return <button
        type="button"
        key={goal}
        data-focus-area={goal}
        className={active ? styles.choiceActive : styles.choice}
        aria-pressed={active}
        onClick={() => setDraft((current) => current ? { ...current, improvementGoals: active ? current.improvementGoals.filter((item) => item !== goal) : [...current.improvementGoals, goal] } : current)}
      >
        <span className={styles.choiceIcon} data-improvement-visual={goal} aria-hidden="true">
          <Image className={styles.choiceVisual} src={visual} alt="" width={72} height={72} sizes="58px" unoptimized={visual.endsWith(".svg")} />
        </span>
        <span className={styles.choiceCopy}><b>{IMPROVEMENT_LABELS[goal]}</b><small>{IMPROVEMENT_DESCRIPTIONS[goal]}</small></span>
        <strong aria-hidden="true">{active ? "✓" : ""}</strong>
      </button>;
    })}</div>
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

  if (progress.step === "plan") return <Shell progress={progress} {...navigationProps} eyebrow="MEMBRESÍA BETA" title="Elige tu plan" description="No hay cobros ni precios definitivos en esta Beta. La cuenta inicia en GRATIS." actions={<button className="primary big" onClick={async () => { const planId = selectablePlanId(draft.planId); await onUpdateProfile({ displayName: profile.displayName, avatarUrl: profile.avatarUrl, defaultHandicap: profile.defaultHandicap, planId }); finish(); }}>Continuar con GRATIS</button>}>
    <div className={styles.planGrid}>{PLAN_CATALOG.map((plan) => <button type="button" key={plan.id} disabled={plan.availability !== "available"} className={`${styles.planCard} ${draft.planId === plan.id ? styles.planSelected : ""}`} onClick={() => setDraft((current) => current ? { ...current, planId: plan.id } : current)}><span>{plan.eyebrow}</span><b>{plan.name}</b><p>{plan.description}</p><small>{plan.availability === "available" ? "Incluido en Beta" : "Próximamente · sin cobro"}</small></button>)}</div>
  </Shell>;

  if (progress.step === "permissions") return <Shell progress={progress} {...navigationProps} eyebrow="PERMISOS OPCIONALES" title="Decide una sola vez" description="Puedes usar The Backyard sin ubicación ni notificaciones. Después podrás revisar o desactivar estos permisos desde Configuración." actions={null}>
    <InitialDevicePermissions key={`initial-permissions-${profile.userId}`} userId={profile.userId} onContinue={() => advance("course")} />
  </Shell>;

  return null;
}
