"use client";

import { ProfileAvatarMedia } from "./profile-avatar-media";
import styles from "./profile-navigation-button.module.css";

export function ProfileNavigationButton({ avatarUrl, displayName, onClick }: { avatarUrl: string; displayName: string; onClick: () => void }) {
  return <button type="button" className={`accountButton ${styles.button}`} onClick={onClick} aria-label="Ir a Mi Perfil">
    <span><ProfileAvatarMedia value={avatarUrl} fallback={(displayName.trim()[0] || "G").toUpperCase()} alt={`Avatar de ${displayName}`} /></span>
  </button>;
}
