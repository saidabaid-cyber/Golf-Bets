"use client";

import { useEffect, useState } from "react";
import { internalCourseCatalogProvider } from "../../lib/course-catalog-provider";
import type { GolfClub } from "../../lib/golf-course-directory";

export function ProfileClubPicker({ value, clubId, onChange }: {
  value: string;
  clubId: string;
  onChange: (selection: { name: string; id: string }) => void;
}) {
  const [results, setResults] = useState<GolfClub[]>([]);
  useEffect(() => {
    let current = true;
    void internalCourseCatalogProvider.searchClubs(value, 8).then((result) => {
      if (current && result.ok) setResults(result.data.clubs);
    });
    return () => { current = false; };
  }, [value]);
  const showResults = results.length > 0 && !clubId;
  return <div className="profileClubPicker">
    <label htmlFor="profile-home-club">Club</label>
    <input id="profile-home-club" value={value} onChange={(event) => onChange({ name: event.target.value, id: "" })} placeholder="Busca tu club o escríbelo" autoComplete="off" role="combobox" aria-expanded={showResults} aria-controls="profile-club-results" />
    {showResults && <div id="profile-club-results" className="profileClubResults" role="listbox" aria-label="Clubs encontrados">{results.map((club) => <button type="button" role="option" aria-selected={false} key={club.id} onClick={() => onChange({ name: club.name, id: club.id })}><b>{club.name}</b><small>{[club.city, club.stateRegion].filter(Boolean).join(", ")}</small></button>)}</div>}
    {clubId && <small className="hint">Club del catálogo ✓</small>}
    {!clubId && value.trim() && <small className="hint">Nombre manual; no se mezcla con campo ni tee.</small>}
  </div>;
}
