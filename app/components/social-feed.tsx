"use client";

import type { PersonalActivity } from "../../lib/golf-insights";

export type SocialFeedProps = {
  activity: PersonalActivity[];
  onOpenRound: (roundId: string) => void;
  onOpenGroup: (groupId: string) => void;
  onCreateRound: () => void;
  onOpenGroups: () => void;
};

function activityDate(value: string) {
  const date = new Date(value.length === 10 ? `${value}T12:00:00-06:00` : value);
  if (Number.isNaN(date.getTime())) return value;
  const hasTime = value.includes("T");
  return new Intl.DateTimeFormat("es-MX", {
    day: "numeric",
    month: "short",
    ...(hasTime ? { hour: "numeric", minute: "2-digit" } : {}),
    timeZone: "America/Mexico_City",
  }).format(date);
}

function openActivity(item: PersonalActivity, onOpenRound: (id: string) => void, onOpenGroup: (id: string) => void) {
  if (item.kind === "round" && item.roundId) onOpenRound(item.roundId);
  if (item.kind === "group" && item.groupId) onOpenGroup(item.groupId);
}

export function SocialFeed({ activity, onOpenRound, onOpenGroup, onCreateRound, onOpenGroups }: SocialFeedProps) {
  return <section className="betaSocialScreen" aria-labelledby="beta-social-title">
    <section className="hero betaSocialHero"><div><span className="eyebrow">THE BACKYARD · SOCIAL</span><h1 id="beta-social-title">Actividad</h1><p>Un vistazo privado a tus rondas y grupos guardados.</p></div></section>

    <aside className="betaPrivacyNotice"><span aria-hidden="true">●</span><p><b>Visible sólo en tu espacio.</b> Esta versión no publica actividad ni resultados a otros usuarios.</p></aside>

    {activity.length ? <section className="card betaFeedCard" aria-label="Actividad reciente">
      <ol className="betaFeedList">
        {activity.map((item) => {
          const canOpen = (item.kind === "round" && Boolean(item.roundId)) || (item.kind === "group" && Boolean(item.groupId));
          const content = <>
            <span className={`betaFeedIcon ${item.kind}`} aria-hidden="true">{item.kind === "round" ? "旗" : "●"}</span>
            <span className="betaFeedCopy"><b>{item.title}</b><small>{item.detail}</small><time dateTime={item.occurredAt}>{activityDate(item.occurredAt)}</time></span>
            {canOpen && <strong className="betaFeedChevron" aria-hidden="true">›</strong>}
          </>;
          const openLabel = item.kind === "group" ? "Abrir grupos" : "Abrir ronda";
          return <li key={item.id}>{canOpen ? <button type="button" onClick={() => openActivity(item, onOpenRound, onOpenGroup)} aria-label={`${item.title} ${openLabel}`}>{content}</button> : <div>{content}</div>}</li>;
        })}
      </ol>
    </section> : <section className="card betaSocialEmpty">
      <span className="betaEmptyFlag" aria-hidden="true">◎</span><h2>Aún no hay actividad.</h2><p>Al guardar una ronda o actualizar un grupo aparecerá aquí, sin publicar nada fuera de tu espacio.</p><div><button type="button" className="primary" onClick={onCreateRound}>Crear una ronda</button><button type="button" className="secondary" onClick={onOpenGroups}>Abrir grupos</button></div>
    </section>}
  </section>;
}
