"use client";

import styles from "./more-hub.module.css";

type MoreHubProps = {
  hasActiveRound: boolean;
  onOpenCourses: () => void;
  onOpenEquipment: () => void;
  onOpenHandicap: () => void;
  onOpenFitting: () => void;
  onOpenGps: () => void;
};

type ToolIcon = "course" | "bag" | "hcp" | "fit" | "gps";

function Icon({ name }: { name: ToolIcon }) {
  const paths: Record<ToolIcon, string> = {
    course: "M5 21V3M5 3c5-4 9 4 14 0v10c-5 4-9-4-14 0",
    bag: "M8 7V5a4 4 0 0 1 8 0v2M6 7h12l1 14H5zM9 11h6",
    hcp: "M12 2v20M2 12h20M5 5l14 14M19 5 5 19",
    fit: "M4 6h16M7 6v12M17 6v12M4 18h16M10 10h4v4h-4z",
    gps: "M12 21s7-6.2 7-12A7 7 0 1 0 5 9c0 5.8 7 12 7 12M12 11.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5",
  };
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name]} /></svg>;
}

export function MoreHub({ hasActiveRound, onOpenCourses, onOpenEquipment, onOpenHandicap, onOpenFitting, onOpenGps }: MoreHubProps) {
  const tools = [
    { icon: "course" as const, title: "Campos", copy: "Busca campos, tees y datos guardados.", action: onOpenCourses },
    { icon: "bag" as const, title: "Mi Bolsa", copy: "Bastones, varillas y bola actual.", action: onOpenEquipment },
    { icon: "hcp" as const, title: "Handicap / GHIN", copy: "Tu índice manual. GHIN oficial: próximamente.", action: onOpenHandicap },
    { icon: "fit" as const, title: "Fitting", copy: "Ball Fit y Launch Monitor, desde Equipo.", action: onOpenFitting },
    { icon: "gps" as const, title: "GPS / Hole Map", copy: hasActiveRound ? "Abre la ronda activa y consulta el hoyo." : "Disponible durante una ronda cuando hay datos.", action: onOpenGps },
  ];

  return <section className={styles.more} aria-labelledby="more-hub-title">
    <header><span>THE BACKYARD</span><h1 id="more-hub-title">Más</h1><p>Tu equipo y herramientas de golf, sin saturar Inicio.</p></header>
    <div className={styles.grid}>{tools.map((tool) => <button type="button" key={tool.title} onClick={tool.action}>
      <span className={styles.icon}><Icon name={tool.icon} /></span>
      <span className={styles.copy}><b>{tool.title}</b><small>{tool.copy}</small></span>
      <strong aria-hidden="true">›</strong>
    </button>)}</div>
  </section>;
}
