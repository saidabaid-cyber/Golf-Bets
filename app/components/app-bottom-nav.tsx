"use client";

import Image from "next/image";
import { type ReactNode } from "react";
import styles from "./app-bottom-nav.module.css";
import { BOTTOM_NAV_TARGETS, primarySectionForTab, type AppTab, type PrimaryAppSection } from "../../lib/app-navigation";

export type AppBottomNavProps = { activeTab: AppTab; onNavigate: (tab: AppTab) => void; onResumeRound?: () => void };
const NAV_ITEMS = Object.entries(BOTTOM_NAV_TARGETS) as Array<[PrimaryAppSection, AppTab]>;

function IconFrame({ children }: { children: ReactNode }) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{children}</svg>;
}

function NavIcon({ section }: { section: PrimaryAppSection }) {
  if (section === "Inicio") return <IconFrame><path d="m3 11 9-8 9 8M5 10v11h5v-7h4v7h5V10" /></IconFrame>;
  if (section === "Carrera") return <IconFrame><path d="M7 3h10v6a5 5 0 0 1-10 0zM7 5H3v3a4 4 0 0 0 4 4m10-7h4v3a4 4 0 0 1-4 4M12 14v6M8 21h8" /></IconFrame>;
  if (section === "My Coach") return <IconFrame><path d="M5 20v-7M12 20V8M19 20V3" /></IconFrame>;
  return <IconFrame><path d="M12 5c-3-2-7-2-10-1v16c3-1 7-1 10 1 3-2 7-2 10-1V4c-3-1-7-1-10 1zM12 5v16" /></IconFrame>;
}

export function OfficialPlaySymbol({ className = "", priority = false }: { className?: string; priority?: boolean }) {
  return <Image className={className} src="/brand/play-symbol-official.jpg" alt="Símbolo oficial de Play de The Backyard" width={869} height={1072} priority={priority} />;
}

export function AppBottomNav({ activeTab, onNavigate }: AppBottomNavProps) {
  const activeSection = primarySectionForTab(activeTab);
  return <nav className={styles.nav} aria-label="Navegación principal">
    {NAV_ITEMS.map(([label, target]) => <button key={label} type="button" className={[styles.item, label === "Play" ? styles.play : "", activeSection === label ? styles.active : ""].join(" ")} aria-current={activeSection === label ? "page" : undefined} aria-label={label} onClick={() => onNavigate(target)}>
      {label === "Play" ? <span className={styles.playCircle}><OfficialPlaySymbol className={styles.playSymbol} priority /></span> : <span className={styles.icon}><NavIcon section={label} /></span>}
      <span className={styles.label}>{label}</span>
    </button>)}
  </nav>;
}
