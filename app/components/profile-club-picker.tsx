"use client";

import { useEffect, useState } from "react";
import { AnchoredSearch, AnchoredSearchOption } from "./anchored-search";

type ClubResult = { id: string; name: string; city?: string; stateRegion?: string; country?: string };
type ClubPage = { clubs?: ClubResult[]; hasMore?: boolean; nextCursor?: string | null };

async function loadClubPage(query: string, cursor?: string | null, signal?: AbortSignal): Promise<ClubPage> {
  const params = new URLSearchParams({ q: query, limit: "8" });
  if (cursor) params.set("cursor", cursor);
  const response = await fetch(`/api/courses/search?scope=clubs&${params}`, { signal });
  if (!response.ok) throw new Error("club-search-failed");
  return response.json() as Promise<ClubPage>;
}

export function ProfileClubPicker({ value, clubId, onChange }: {
  value: string;
  clubId: string;
  onChange: (selection: { name: string; id: string }) => void;
}) {
  const [results, setResults] = useState<ClubResult[]>([]);
  const [status, setStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [hasMore, setHasMore] = useState(false);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  useEffect(() => {
    const query = value.trim();
    if (clubId || query.length < 2) { setResults([]); setStatus("idle"); setHasMore(false); setNextCursor(null); return; }
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setStatus("loading");
      try {
        const payload = await loadClubPage(query, null, controller.signal);
        setResults(Array.isArray(payload.clubs) ? payload.clubs : []);
        setHasMore(payload.hasMore === true);
        setNextCursor(typeof payload.nextCursor === "string" ? payload.nextCursor : null);
        setStatus("ready");
      } catch {
        if (!controller.signal.aborted) { setResults([]); setStatus("error"); }
      }
    }, 250);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [clubId, value]);
  const showResults = results.length > 0 && !clubId;
  return <div className="profileClubPicker">
    <AnchoredSearch
      label="Club"
      value={value}
      onChange={(name) => onChange({ name, id: "" })}
      placeholder="Busca tu club o escríbelo"
      expanded={showResults}
      status={status === "loading" ? "Buscando clubs…" : status === "error" ? "No pudimos consultar el catálogo. Puedes guardar el nombre manualmente." : undefined}
    >
      {results.map((club) => <AnchoredSearchOption key={club.id} onSelect={() => onChange({ name: club.name, id: club.id })}><b>{club.name}</b><small>{[club.city, club.stateRegion].filter(Boolean).join(", ")}</small></AnchoredSearchOption>)}
      {hasMore && nextCursor && <button type="button" role="option" aria-selected="false" className="textButton" disabled={status === "loading"} onClick={async () => {
        setStatus("loading");
        try {
          const payload = await loadClubPage(value.trim(), nextCursor);
          setResults((current) => [...new Map([...current, ...(payload.clubs || [])].map((club) => [club.id, club])).values()]);
          setHasMore(payload.hasMore === true);
          setNextCursor(typeof payload.nextCursor === "string" ? payload.nextCursor : null);
          setStatus("ready");
        } catch { setStatus("error"); }
      }}>Más resultados</button>}
    </AnchoredSearch>
    {clubId && <small className="hint">Club del catálogo ✓</small>}
    {!clubId && value.trim() && <small className="hint">Nombre manual; no se mezcla con campo ni tee.</small>}
  </div>;
}
