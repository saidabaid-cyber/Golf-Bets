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
  if (section === "Social") {
    return <IconFrame><path d="M4 5.5h16v11H9l-5 4z" /><path d="M8 10h8M8 13h5" /></IconFrame>;
  }
  if (section === "Más") {
    return <IconFrame><circle cx="5" cy="12" r="1.4" fill="currentColor" stroke="none" /><circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none" /><circle cx="19" cy="12" r="1.4" fill="currentColor" stroke="none" /></IconFrame>;
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
