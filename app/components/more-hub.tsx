"use client";

import styles from "./more-hub.module.css";

type MoreHubProps = {
  hasActiveRound: boolean;
  onOpenCourses: () => void;
  onOpenEquipment: () => void;
  onOpenHandicap: () => void;
  onOpenFitting: () => void;
  onOpenGps: () => void;
  onOpenRules: () => void;
  onOpenHelp: () => void;
  onOpenSettings: () => void;
};

type ToolIcon = "course" | "bag" | "hcp" | "fit" | "gps" | "rules" | "help" | "settings";

function Icon({ name }: { name: ToolIcon }) {
  const paths: Record<ToolIcon, string> = {
    course: "M5 21V3M5 3c5-4 9 4 14 0v10c-5 4-9-4-14 0",
    bag: "M8 7V5a4 4 0 0 1 8 0v2M6 7h12l1 14H5zM9 11h6",
    hcp: "M12 2v20M2 12h20M5 5l14 14M19 5 5 19",
    fit: "M4 6h16M7 6v12M17 6v12M4 18h16M10 10h4v4h-4z",
    gps: "M12 21s7-6.2 7-12A7 7 0 1 0 5 9c0 5.8 7 12 7 12M12 11.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5",
    rules: "M5 4.5A2.5 2.5 0 0 1 7.5 2H20v18H7.5A2.5 2.5 0 0 0 5 22V4.5ZM5 19.5A2.5 2.5 0 0 1 7.5 17H20M9 7h7M9 11h7",
    help: "M9.6 9a2.5 2.5 0 1 1 3.4 2.3c-.9.4-1.5 1-1.5 2.2M12 18h.01M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20",
    settings: "M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V21h-4v-.1a1.7 1.7 0 0 0-1-1.5 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H3v-4h.1a1.7 1.7 0 0 0 1.5-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1a1.7 1.7 0 0 0 1.9.3 1.7 1.7 0 0 0 1-1.5V3h4v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.5 1h.1v4h-.1a1.7 1.7 0 0 0-1.5 1",
  };
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name]} /></svg>;
}

export function MoreHub({ hasActiveRound, onOpenCourses, onOpenEquipment, onOpenHandicap, onOpenFitting, onOpenGps, onOpenRules, onOpenHelp, onOpenSettings }: MoreHubProps) {
  const tools = [
    { icon: "course" as const, title: "Campos", copy: "Busca campos, tees y datos guardados.", action: onOpenCourses },
    { icon: "bag" as const, title: "Mi Bolsa", copy: "Bastones, varillas y bola actual.", action: onOpenEquipment },
    { icon: "hcp" as const, title: "Handicap / GHIN", copy: "Tu índice manual. GHIN oficial: próximamente.", action: onOpenHandicap },
    { icon: "fit" as const, title: "Fitting", copy: "Ball Fit y Launch Monitor, desde Equipo.", action: onOpenFitting },
    { icon: "gps" as const, title: "GPS / Hole Map", copy: hasActiveRound ? "Abre la ronda activa y consulta el hoyo." : "Disponible durante una ronda cuando hay datos.", action: onOpenGps },
    { icon: "rules" as const, title: "Reglas de golf", copy: "Consulta reglas y criterios del juego.", action: onOpenRules },
    { icon: "help" as const, title: "Ayuda", copy: "Reglas, respuestas rápidas y soporte.", action: onOpenHelp },
    { icon: "settings" as const, title: "Configuración adicional", copy: "Cuenta, privacidad y preferencias.", action: onOpenSettings },
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
