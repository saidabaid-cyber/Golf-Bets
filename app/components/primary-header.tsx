"use client";

import { ProfileNavigationButton } from "./profile-navigation-button";
import { AdminModeMenu } from "./admin-mode-menu";
import { type AppTab } from "../../lib/app-navigation";

export function BackyardWordmark() {
  return <span className="editorialWordmark"><span>The Backyard</span><svg viewBox="0 0 22 34" aria-hidden="true"><path d="M2 33V2m0 0c7-4 10 6 18 2l-1 7c-8 4-10-6-17-2" /></svg><small>GOLF MORE TOGETHER</small></span>;
}

export function PrimaryHeader({ avatarUrl, displayName, onProfile, onNotifications, onHome }: { tab: AppTab; avatarUrl: string; displayName: string; onProfile: () => void; onNotifications: () => void; onHome: () => void }) {
  return <header className="primaryHeader">
    <div className="primaryHeaderTop"><button type="button" className="wordmarkButton" onClick={onHome} aria-label="Ir a Inicio"><BackyardWordmark /></button><div className="primaryHeaderActions"><AdminModeMenu /><button type="button" className="notificationButton" aria-label="Notificaciones" onClick={onNotifications}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4" /></svg></button><ProfileNavigationButton avatarUrl={avatarUrl} displayName={displayName} onClick={onProfile} /></div></div>
  </header>;
}
