"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import styles from "./competition.module.css";

type Rule = { id: string; category: string; title: string; body: string };
type CompetitionPayload = { competition?: { name?: string; type?: string; description?: string; format?: string; handicapMaximum?: number; handicapPercentage?: number; prizes?: string; tieBreak?: string }; ruleSet?: { title: string; version: number } | null; rules?: Rule[] };

export function CompetitionRules({ competitionId }: { competitionId: string }) {
  const [data, setData] = useState<CompetitionPayload | null>(null); const [error, setError] = useState("");
  useEffect(() => { const controller = new AbortController(); void fetch(`/api/competitions/${encodeURIComponent(competitionId)}/rules`, { signal: controller.signal, cache: "no-store" }).then(async (response) => { const payload = await response.json() as CompetitionPayload & { error?: string }; if (!response.ok) throw new Error(payload.error || "Reglamento no disponible."); setData(payload); }).catch((reason) => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Reglamento no disponible."); }); return () => controller.abort(); }, [competitionId]);
  return <main className={styles.page}><header><Link href="/">← The Backyard</Link><span>COMPETICIÓN</span></header><section className={styles.hero}><p>{data?.competition?.type || "REGLAMENTO"}</p><h1>{data?.competition?.name || (error ? "No disponible" : "Cargando reglamento…")}</h1>{data?.competition?.description && <p>{data.competition.description}</p>}{data?.ruleSet && <small>{data.ruleSet.title} · versión {data.ruleSet.version}</small>}</section>{error && <section className={styles.notice}>{error}</section>}{data?.competition && <section className={styles.facts}>{data.competition.format && <article><span>Formato</span><b>{data.competition.format}</b></article>}{typeof data.competition.handicapPercentage === "number" && <article><span>Handicap</span><b>{data.competition.handicapPercentage}%</b></article>}{data.competition.prizes && <article><span>Premios</span><b>{data.competition.prizes}</b></article>}{data.competition.tieBreak && <article><span>Desempate</span><b>{data.competition.tieBreak}</b></article>}</section>}<section className={styles.rules}>{(data?.rules || []).map((rule) => <article key={rule.id}><span>{rule.category}</span><h2>{rule.title}</h2><p>{rule.body}</p></article>)}</section></main>;
}
