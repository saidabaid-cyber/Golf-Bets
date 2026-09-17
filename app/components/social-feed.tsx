"use client";
import { useCallback, useEffect, useState } from "react";
import { useViewScrollReset } from "./use-view-scroll-reset";
import type { PersonalActivity } from "../../lib/golf-insights";
import type { SocialProfile } from "../../features/social/domain";
import type { SocialNotificationPage } from "../../lib/social-activity-contract";
import { socialRequest } from "../../lib/social-activity-client";
import { SocialConnectionsPanel } from "./social-connections-panel";
import { CloudSocialActivity, CloudSocialNotifications, SocialSharingPreferences } from "./cloud-social-activity";
import { GroupInvitationInbox } from "./group-invitations";
import { PersonalQr, SocialQrScanner } from "./social-qr";
import { useBackyardAccount } from "./account-provider";
import styles from "./social-feed.module.css";
export type SocialView = "activity" | "friends" | "notifications" | "qr" | "scan" | "preferences";
export type SocialFeedProps = {
  initialView?: SocialView; targetId?: string | null; onCloseTarget?: () => void;
  activity: PersonalActivity[]; identityUserId: string; accessToken?: string; knownProfiles: SocialProfile[];
  notificationsEnabled: boolean; onNotificationsEnabledChange: (value: boolean) => void;
  onOpenRound: (roundId: string) => void; onOpenGroup: (groupId: string) => void;
  onCreateRound: () => void; onOpenGroups: () => void; onPrivacy?: () => void;
};
export function SocialFeed({ initialView = "activity", targetId, onCloseTarget, identityUserId, accessToken, onOpenGroups, onPrivacy }: SocialFeedProps) {
  const { identity, retryCloudSync } = useBackyardAccount();
  const [view, setView] = useState<SocialView>(initialView), [menu, setMenu] = useState(false), [unread, setUnread] = useState(0), [target, setTarget] = useState(targetId);
  useViewScrollReset(`${view}:${target ?? ""}`);
  const refreshUnread = useCallback(async (signal?: AbortSignal) => {
    if (!accessToken) return;
    const result = await socialRequest<SocialNotificationPage>("/api/social/notifications", accessToken, { signal });
    if (!signal?.aborted) setUnread(result.data.filter(item => !item.readAt).length);
  }, [accessToken]);
  useEffect(() => { const controller = new AbortController(); void refreshUnread(controller.signal).catch(() => {}); return () => controller.abort(); }, [refreshUnread]);
  function open(next: SocialView) { setMenu(false); setView(next); }
  return <section className={styles.screen} aria-labelledby="social-title">
    <header className={styles.header}><div><span>THE BACKYARD</span><h1 id="social-title">Social</h1></div><div className={styles.actions}>
      <button type="button" aria-label={`Notificaciones${unread ? ` · ${unread} sin leer` : ""}`} onClick={() => open("notifications")}><svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4" /></svg>{unread > 0 && <b className={styles.badge}>{unread > 99 ? "99+" : unread}</b>}<small>Avisos</small></button>
      <button type="button" aria-label="Agregar amigos y QR" aria-expanded={menu} onClick={() => setMenu(!menu)}>＋</button>
    </div></header>
    {menu && <nav className={styles.menu} aria-label="Agregar y compartir"><button type="button" onClick={() => open("friends")}>Agregar amigos</button><button type="button" onClick={() => open("scan")}>Escanear QR</button><button type="button" onClick={() => open("qr")}>Mi QR</button></nav>}
    {view !== "activity" && <button type="button" className="textButton" onClick={() => open("activity")}>← Feed de amigos</button>}
    {view === "activity" && <><CloudSocialActivity key={identityUserId} viewerId={identityUserId} accessToken={accessToken} friendsOnly /><div className={styles.links}><button type="button" onClick={() => open("friends")}>Amigos y solicitudes</button><button type="button" onClick={() => open("preferences")}>Qué comparto</button></div></>}
    {view === "friends" && <SocialConnectionsPanel key={identityUserId} ownerId={identityUserId} accessToken={accessToken} targetId={target} onCloseTarget={() => { setTarget(null); onCloseTarget?.(); }} onChanged={() => void refreshUnread().catch(() => {})} />}
    {view === "notifications" && <><CloudSocialNotifications key={identityUserId} viewerId={identityUserId} accessToken={accessToken} onFriends={() => open("friends")} onReadChange={() => void refreshUnread().catch(() => {})} /><GroupInvitationInbox accessToken={accessToken} onAccepted={retryCloudSync} /><button type="button" className="secondary" onClick={onOpenGroups}>Ver mis grupos</button></>}
    {view === "qr" && <PersonalQr userId={identityUserId} name={identity.displayName} username={identity.username || ""} avatar={identity.avatarUrl || ""} onClose={() => open("activity")} />}
    {view === "scan" && <SocialQrScanner onFound={id => { setTarget(id); open("friends"); }} onClose={() => open("activity")} />}
    {view === "preferences" && <section className="card"><h2>Privacidad y notificaciones</h2><button type="button" className="secondary" onClick={onPrivacy}>Privacidad del perfil</button>{accessToken && <SocialSharingPreferences accessToken={accessToken} />}</section>}
  </section>;
}
