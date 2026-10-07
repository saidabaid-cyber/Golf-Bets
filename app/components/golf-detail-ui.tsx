"use client";
import type { ReactNode } from "react";
import { BackyardIcon } from "./backyard-icon";
import { useGolfNavigation } from "./golf-object-navigation";
import styles from "./golf-object.module.css";
export function GolfDetailHeader({ title, subtitle, action, onBack }: { title: string; subtitle?: string; action?: ReactNode; onBack?: () => void }) {
  const navigation = useGolfNavigation();
  return <header className={styles.detailHeader}><button type="button" aria-label="Volver" onClick={onBack || navigation?.back}><BackyardIcon name="chevron" size={24}/></button><div><h1 tabIndex={-1}>{title}</h1>{subtitle && <small>{subtitle}</small>}</div>{action || <span/>}</header>;
}
export function GolfEmptyState({ title, copy, retry }: { title: string; copy: string; retry?: () => void }) {
  return <div className={styles.empty} role={retry ? "status" : undefined}><BackyardIcon name="flag" size={32}/><h2>{title}</h2><p>{copy}</p>{retry && <button type="button" className={styles.primary} onClick={retry}>Reintentar</button>}</div>;
}
export function GolfDetailSkeleton({ profile = false }: { profile?: boolean }) {
  return <div className={styles.skeleton} role="status" aria-label={profile ? "Cargando perfil" : "Cargando información"}><div className={styles.skeletonIdentity}><i/><div><i/><i/></div></div><div className={styles.skeletonMetrics}>{[0,1,2,3].map(n => <i key={n}/>)}</div>{[0,1,2,3,4,5].map(n => <i className={styles.skeletonRow} key={n}/>)}</div>;
}
export function golfDate(value: string) {
  const date = new Date(value.length === 10 ? `${value}T12:00:00Z` : value);
  return Number.isNaN(date.valueOf()) ? "Fecha no disponible" : date.toLocaleDateString("es-MX", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}
