"use client";

import { MEMBERSHIP_CAPABILITIES, membershipEntitlement, type MembershipCapability } from "../../features/memberships/registry";

const SECTIONS: Array<{ title: string; rows: Array<{ label: string; capability: MembershipCapability }> }> = [
  { title: "Scoring & Stats", rows: [{ label: "Score", capability: "SCORING" }, { label: "Stats básicas", capability: "BASIC_STATS" }, { label: "Stats avanzadas", capability: "ADVANCED_STATS" }, { label: "Tendencias e insights", capability: "INSIGHTS" }] },
  { title: "GPS & Shot Tracking", rows: [{ label: "Información básica del campo", capability: "BASIC_COURSE_INFO" }, { label: "GPS avanzado", capability: "ADVANCED_GPS" }, { label: "Shot Tracking", capability: "SHOT_TRACKING" }] },
  { title: "Games", rows: [{ label: "Juegos principales", capability: "BASIC_GAMES" }, { label: "Catálogo completo", capability: "ALL_GAMES" }, { label: "Juegos simultáneos", capability: "MULTIPLE_GAMES" }, { label: "Presiones", capability: "PRESSES" }] },
  { title: "AI", rows: [{ label: "Configurar ronda con AI", capability: "AI_ROUND_SETUP" }, { label: "Card AI", capability: "CARD_AI" }, { label: "Análisis personalizado", capability: "PERSONAL_AI" }] },
  { title: "Equipment", rows: [{ label: "Mi Bolsa", capability: "MY_BAG" }, { label: "Ball Fit", capability: "BALL_FIT" }, { label: "Launch Monitor AI", capability: "LAUNCH_MONITOR_AI" }] },
  { title: "Groups / Social", rows: [{ label: "Grupos", capability: "GROUPS" }, { label: "Funciones avanzadas de grupo", capability: "ADVANCED_GROUPS" }, { label: "Scores de amigos", capability: "FRIENDS_SCORES" }] },
  { title: "Handicap", rows: [{ label: "HCP manual", capability: "MANUAL_INDEX" }, { label: "Course Handicap", capability: "COURSE_HANDICAP" }, { label: "Integraciones autorizadas futuras", capability: "AUTHORIZED_HANDICAP_INTEGRATIONS" }] },
];

function cell(capability: MembershipCapability, plan: "FREE" | "PRO") {
  const value = membershipEntitlement(plan, capability);
  if (value === "AVAILABLE") return <span aria-label="Incluido">✓</span>;
  if (value === "LIMITED") return <span title="Uso limitado">Limitado</span>;
  if (value === "FUTURE") return <span>Futuro</span>;
  return <span aria-label="No incluido">—</span>;
}

export function MembershipBenefits() {
  return <main className="membershipBenefitsPage">
    <header className="hero"><div><span className="eyebrow">THE BACKYARD · BETA PRO</span><h1>Beneficios de membresía</h1><p>Durante Beta tienes acceso Pro completo, sin tarjeta, cobro ni fecha de expiración automática.</p></div></header>
    <aside className="notice">Esta pantalla describe capacidades; no fija precio ni activa un paywall.</aside>
    <div className="membershipBenefitList">
      {SECTIONS.map((section, index) => <details className="card" key={section.title} open={index === 0}>
        <summary><b>{section.title}</b><span>Free / Pro</span></summary>
        <div className="membershipBenefitHeader"><span>Función</span><b>Free</b><b>Pro</b></div>
        {section.rows.map((row) => <div className="membershipBenefitRow" key={row.capability}><span>{row.label}</span><b>{cell(row.capability, "FREE")}</b><b>{cell(row.capability, "PRO")}</b></div>)}
      </details>)}
    </div>
    <p className="hint">Registro técnico: {MEMBERSHIP_CAPABILITIES.length} capacidades versionadas. Las integraciones externas se habilitan sólo tras autorización real.</p>
  </main>;
}

