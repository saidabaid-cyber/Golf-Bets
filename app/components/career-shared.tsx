"use client";
import { type ReactNode, useEffect, useRef } from "react";
import { CAREER_TABS, type CareerView } from "../../lib/career-navigation";
import styles from "./career-hub.module.css";
export function CareerHeader() {
  return <header className={styles.heading}><span className={styles.eyebrow}>THE BACKYARD · TU TRAYECTORIA</span><h1>Carrera</h1><p>Tu historia en el golf. Rondas, logros y grandes momentos.</p></header>;
}
export function CareerTabs({ view, onView }: { view: CareerView; onView: (view: CareerView) => void }) {
  const navigation = useRef<HTMLElement>(null);
  useEffect(() => {
    const container = navigation.current, selected = container?.querySelector<HTMLElement>('[aria-current="page"]');
    if (!container || !selected) return;
    const parent = container.getBoundingClientRect(), child = selected.getBoundingClientRect();
    if (child.left < parent.left || child.right > parent.right) container.scrollTo({left: container.scrollLeft + child.left - parent.left - (container.clientWidth - child.width) / 2});
  }, [view]);
  return <nav ref={navigation} className={styles.tabs} aria-label="Secciones de Carrera">{CAREER_TABS.map(tab => <button type="button" key={tab.id} aria-current={view === tab.id ? "page" : undefined} onClick={() => onView(tab.id)}>{tab.label}</button>)}</nav>;
}
export function CareerEmptyState({ title, description, action, onAction }: { title: string; description?: string; action?: string; onAction?: () => void }) {
  return <div className={styles.empty}><span className={styles.emptyMark} aria-hidden="true">⚑</span><h3>{title}</h3>{description && <p>{description}</p>}{action && onAction && <button type="button" className={styles.goldButton} onClick={onAction}>{action} <span aria-hidden="true">›</span></button>}</div>;
}
export function CareerSkeleton() { return <div className={styles.skeleton} role="status" aria-label="Cargando Carrera"><span /><div><span /><span /><span /></div><span /><span /></div>; }
export function CareerErrorState({ onRetry }: { onRetry?: () => void }) {
  return <div className={styles.error} role="alert"><p>Esta información no está disponible por el momento.</p>{onRetry && <button type="button" onClick={onRetry}>Reintentar</button>}</div>;
}
export function CareerPanel({ title, children, action, onAction, dark = false }: { title: string; children: ReactNode; action?: string; onAction?: () => void; dark?: boolean }) {
  return <section className={`${styles.panel} ${dark ? styles.darkPanel : ""}`}><div className={styles.sectionTitle}><h2>{title}</h2>{action && onAction && <button type="button" onClick={onAction}>{action} <span aria-hidden="true">›</span></button>}</div>{children}</section>;
}
export function CareerStatCard({ label, value, hint }: { label: string; value: ReactNode; hint?: string }) {
  return <div className={styles.stat}><span>{label}</span><strong>{value ?? "—"}</strong>{hint && <small>{hint}</small>}</div>;
}
export function CareerCta({ title, label, onAction }: { title: string; label: string; onAction: () => void }) {
  return <aside className={styles.cta}><h2>{title}</h2><button type="button" className={styles.goldButton} onClick={onAction}>{label} <span aria-hidden="true">›</span></button></aside>;
}
