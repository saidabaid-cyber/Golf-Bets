"use client";

import { ProfileAvatarMedia } from "./profile-avatar-media";
import { CloudSocialActivity } from "./cloud-social-activity";
import styles from "./home-dashboard-clean.module.css";

export type ActiveRoundSummary = {
  courseName: string; roundDate: string; startedAt?: string;
  status: "setup" | "live" | "review"; totalHoles: 9 | 18;
  currentHole?: number; playedHoles?: number; playerCount: number;
  partialGross?: number; partialToPar?: number;
};

export type HomeDashboardProps = {
  displayName: string; avatarUrl?: string | null; identityUserId: string; accessToken?: string;
  onOpenRounds: () => void; onOpenFriends: () => void; onPrivacy: () => void;
  onOpenAchievements: () => void;
};

/** Home composes the existing server-filtered activity feed, never local private snapshots. */
export function HomeDashboard({ displayName, avatarUrl, identityUserId, accessToken, onOpenRounds, onOpenFriends, onPrivacy, onOpenAchievements }: HomeDashboardProps) {
  return <section className={styles.home} data-home-version="community-feed-v3" aria-label="Feed de Inicio">
    <section className={styles.composer} aria-label="Compartir actividad">
      <div className={styles.prompt}><ProfileAvatarMedia className={styles.avatar} value={avatarUrl} fallback={displayName.trim()[0] || "G"} alt={`Avatar de ${displayName}`} /><span>¿Qué estás compartiendo hoy?</span></div>
      <div className={styles.composerActions}>
        <button type="button" disabled title="Próximamente">▧ Foto</button>
        <button type="button" onClick={onOpenRounds}>⚑ Ronda</button>
        <button type="button" disabled title="Los logros se comparten desde las rondas verificadas">♜ Logro</button>
        <button type="button" disabled title="Próximamente">▥ Encuesta</button>
      </div>
      <small>Las rondas y sus logros se comparten al guardarlas, según tu privacidad.</small>
    </section>
    <div className={styles.community}><button type="button" onClick={onOpenFriends}>Amigos y solicitudes</button><button type="button" onClick={onPrivacy}>Qué comparto</button></div>
    <CloudSocialActivity key={identityUserId} viewerId={identityUserId} accessToken={accessToken} friendsOnly onOpenAchievements={onOpenAchievements} />
  </section>;
}
