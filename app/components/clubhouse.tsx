"use client";
import { clubhouseCapabilities, type ClubhouseConfig, type ClubhouseIntegrations } from "../../lib/clubhouse-capabilities";
import styles from "./play-hub.module.css";
export function Clubhouse({ config, integrations }: { config?: ClubhouseConfig | null; integrations?: ClubhouseIntegrations }) {
  return <section className={styles.clubhouse} aria-labelledby="clubhouse-title">
    <div className={styles.sectionTitle}><div><h2 id="clubhouse-title">Casa Club</h2><p>Todo lo que necesitas, en un solo lugar.</p></div></div>
    {config?.label && <p className={styles.clubName}>{config.label}</p>}
    <div className={styles.services}>{clubhouseCapabilities(config, integrations).map(capability => <button type="button" key={capability.key} disabled={!capability.action} onClick={capability.action} title={capability.action ? capability.label : "Disponible cuando tu club lo active"}><span aria-hidden="true">{capability.icon}</span><b>{capability.label}</b>{!capability.action && <small>Disponible cuando tu club lo active</small>}</button>)}</div>
  </section>;
}
