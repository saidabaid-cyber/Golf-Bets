"use client";

import type { ReactNode } from "react";
import {
  BOTTOM_NAV_TARGETS,
  primarySectionForTab,
  type AppTab,
  type PrimaryAppSection,
} from "../../lib/app-navigation";

export type AppBottomNavProps = {
  activeTab: AppTab;
  onNavigate: (tab: AppTab) => void;
};

const NAV_ITEMS = Object.entries(BOTTOM_NAV_TARGETS) as Array<[PrimaryAppSection, AppTab]>;

function IconFrame({ children }: { children: ReactNode }) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{children}</svg>;
}

function NavIcon({ section }: { section: PrimaryAppSection }): ReactNode {
  if (section === "Inicio") {
    return <IconFrame><path d="m3.5 10.5 8.5-7 8.5 7v9a1 1 0 0 1-1 1h-5v-6h-5v6h-5a1 1 0 0 1-1-1z" /></IconFrame>;
  }
  if (section === "Jugar") {
    return <IconFrame><path d="M8 21h8M12 21v-7M12 14c-2.8 0-5-1.6-5-4.4V3l10 2.5-5 2.2" /><circle cx="17.5" cy="17.5" r="2.5" /></IconFrame>;
  }
  if (section === "Grupos") {
    return <IconFrame><circle cx="8" cy="8" r="3" /><circle cx="17" cy="9" r="2.5" /><path d="M2.5 20c.4-4.2 2.2-6.2 5.5-6.2s5.1 2 5.5 6.2M13.5 14.5c1-.8 2.1-1.1 3.5-1.1 2.7 0 4.2 1.8 4.5 5.2" /></IconFrame>;
  }
  if (section === "Social") {
    return <IconFrame><path d="M4 5.5h16v11H9l-5 4z" /><path d="M8 10h8M8 13h5" /></IconFrame>;
  }
  return <IconFrame><circle cx="12" cy="8" r="4" /><path d="M4.5 21c.5-5 3-7.5 7.5-7.5s7 2.5 7.5 7.5" /></IconFrame>;
}

export function AppBottomNav({ activeTab, onNavigate }: AppBottomNavProps) {
  const activeSection = primarySectionForTab(activeTab);

  return <nav className="bottomNav betaBottomNav" aria-label="Navegación principal">
    {NAV_ITEMS.map(([label, target]) => {
      const active = activeSection === label;
      return <button
        key={label}
        type="button"
        className={active ? "active" : ""}
        aria-current={active ? "page" : undefined}
        aria-label={label}
        onClick={() => onNavigate(target)}
      >
        <span className="betaNavIcon"><NavIcon section={label} /></span>
        <span className="betaNavLabel">{label}</span>
      </button>;
    })}
  </nav>;
}
