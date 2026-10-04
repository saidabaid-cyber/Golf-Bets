"use client";
import { useState } from "react";
import { useViewScrollReset } from "./use-view-scroll-reset";
import type { PersonalActivity } from "../../lib/golf-insights";
import type { SocialProfile } from "../../features/social/domain";
import type { FriendsView } from "./social-connections-panel";
import { CloudSocialNotifications, SocialSharingPreferences } from "./cloud-social-activity";
import { BottomBackAction } from "./bottom-back-action";
import { GroupInvitationInbox, useGroupNotificationsBadge } from "./group-invitations";
import { useBackyardAccount } from "./account-provider";
import styles from "./social-feed.module.css";
export type SocialView = "activity" | "friends" | "notifications" | "qr" | "scan" | "preferences";
export type SocialFeedProps = {
  initialView?: SocialView; onOpenFriends: (view?: FriendsView, targetId?: string) => void;
  activity: PersonalActivity[]; identityUserId: string; accessToken?: string; knownProfiles: SocialProfile[];
  notificationsEnabled: boolean; onNotificationsEnabledChange: (value: boolean) => void;
  onOpenRound: (roundId: string) => void; onOpenGroup: (groupId: string) => void;
  onCreateRound: () => void; onOpenGroups: () => void; onPrivacy?: () => void;
  onHome?: () => void;
};
export function SocialFeed({ initialView = "activity", onOpenFriends, identityUserId, accessToken, onOpenGroups, onPrivacy, onHome }: SocialFeedProps) {
  const { retryCloudSync } = useBackyardAccount();
  const [view, setView] = useState<SocialView>(initialView), [menu, setMenu] = useState(false);
  const { unread, refreshUnread } = useGroupNotificationsBadge(accessToken);
  useViewScrollReset(view);
  function open(next: SocialView) { setMenu(false); if (next === "friends" || next === "qr" || next === "scan") { onOpenFriends(next === "friends" ? "list" : next); return; } setView(next); }
  function backToActivity() { if (onHome) onHome(); else open("activity"); }
  return <section className={styles.screen} aria-labelledby="social-title">
    <header className={styles.header}><div><span>THE BACKYARD</span><h1 id="social-title">Comunidad</h1></div><div className={styles.actions}>
      <button type="button" aria-label={`Notificaciones${unread ? ` · ${unread} sin leer` : ""}`} onClick={() => open("notifications")}><svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4" /></svg>{unread > 0 && <b className={styles.badge}>{unread > 99 ? "99+" : unread}</b>}<small>Avisos</small></button>
      <button type="button" aria-label="Agregar amigos y QR" aria-expanded={menu} onClick={() => setMenu(!menu)}>＋</button>
    </div></header>
    {menu && <nav className={styles.menu} aria-label="Agregar y compartir"><button type="button" onClick={() => open("friends")}>Agregar amigos</button><button type="button" onClick={() => open("scan")}>Escanear QR</button><button type="button" onClick={() => open("qr")}>Mi QR</button></nav>}
    {view !== "activity" && view !== "qr" && view !== "scan" && <button type="button" className="textButton" onClick={backToActivity}>← Feed de amigos</button>}
    {view === "activity" && <div className={styles.links}><button type="button" onClick={onHome}>Feed de Inicio</button><button type="button" onClick={() => open("friends")}>Amigos y solicitudes</button><button type="button" onClick={() => open("qr")}>Mi QR</button><button type="button" onClick={() => open("scan")}>Escanear QR</button><button type="button" onClick={() => open("preferences")}>Qué comparto</button></div>}
    {view === "friends" && <button type="button" className="primary" onClick={() => onOpenFriends()}>Abrir Carrera → Amigos</button>}
    {view === "notifications" && <><CloudSocialNotifications key={identityUserId} viewerId={identityUserId} accessToken={accessToken} onFriends={() => open("friends")} onReadChange={() => void refreshUnread().catch(() => {})} /><GroupInvitationInbox accessToken={accessToken} onAccepted={async () => { await retryCloudSync(); await refreshUnread(); }} /><button type="button" className="secondary" onClick={onOpenGroups}>Ver mis grupos</button></>}
    {view === "qr" && <button type="button" className="primary" onClick={() => onOpenFriends("qr")}>Mi código QR en Amigos</button>}
    {view === "scan" && <button type="button" className="primary" onClick={() => onOpenFriends("scan")}>Escanear QR en Amigos</button>}
    {view === "preferences" && <section className="card"><h2>Privacidad y notificaciones</h2><button type="button" className="secondary" onClick={onPrivacy}>Privacidad del perfil</button>{accessToken && <SocialSharingPreferences accessToken={accessToken} />}</section>}
    {view !== "activity" && view !== "qr" && view !== "scan" && <BottomBackAction label="← Feed de amigos" onBack={backToActivity} />}
  </section>;
}
