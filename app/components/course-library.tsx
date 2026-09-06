"use client";

import { useEffect, useMemo, useState } from "react";
import { buildInternalCourseCatalog } from "../../lib/course-catalog";
import { internalCourseDataProvider, searchInternalCourses, type CourseSearchData } from "../../lib/golf-providers";
import type { NearbyCourseMatch } from "../../lib/course-distance";
import type { Course } from "../../lib/types";

type CourseFilter = "all" | "favorites" | "recent" | "nearby" | "mine";
type SearchState =
  | { status: "loading"; data: CourseSearchData }
  | { status: "ready"; data: CourseSearchData }
  | { status: "error"; data: CourseSearchData; message: string };
type NearbyState =
  | { status: "idle" }
  | { status: "requesting" }
  | { status: "ready"; matches: NearbyCourseMatch[] }
  | { status: "empty" }
  | { status: "denied" | "unsupported" | "error"; message: string };

const EMPTY_NEARBY_MATCHES: NearbyCourseMatch[] = [];

export type CourseLibraryProps = {
  courses: Course[];
  favoriteCourseIds: string[];
  recentCourseIds?: string[];
  selectedCourseId?: string | null;
  onToggleFavorite: (courseId: string) => void;
  onSelectCourse: (course: Course) => void;
  onCreateCourse: () => void;
  onEditCourse?: (course: Course) => void;
};

function updatedLabel(updatedAt: string | undefined) {
  if (!updatedAt) return null;
  const date = new Date(updatedAt.length === 10 ? `${updatedAt}T12:00:00-06:00` : updatedAt);
  if (Number.isNaN(date.getTime())) return updatedAt;
  return new Intl.DateTimeFormat("es-MX", { day: "numeric", month: "short", year: "numeric", timeZone: "America/Mexico_City" }).format(date);
}

function groupSelections(courses: Course[]) {
  const groups = new Map<string, Course[]>();
  for (const course of courses) {
    const id = course.catalogCourseId || course.id;
    groups.set(id, [...(groups.get(id) || []), course]);
  }
  return Array.from(groups, ([id, selections]) => ({
    id,
    selections: selections.sort((left, right) => left.teeName.localeCompare(right.teeName, "es-MX")),
  }));
}

export function CourseLibrary({ courses, favoriteCourseIds, recentCourseIds = [], selectedCourseId, onToggleFavorite, onSelectCourse, onCreateCourse, onEditCourse }: CourseLibraryProps) {
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [filter, setFilter] = useState<CourseFilter>("all");
  const [searchRetry, setSearchRetry] = useState(0);
  const [searchState, setSearchState] = useState<SearchState>(() => ({ status: "ready", data: searchInternalCourses({ courses, limit: 40 }) }));
  const [nearbyState, setNearbyState] = useState<NearbyState>({ status: "idle" });
  const [teeSelections, setTeeSelections] = useState<Record<string, string>>({});
  const favoriteSet = useMemo(() => new Set(favoriteCourseIds), [favoriteCourseIds]);
  const recentRank = useMemo(() => new Map(recentCourseIds.map((id, index) => [id, index])), [recentCourseIds]);
  const manualCourseCount = useMemo(() => courses.filter((course) => course.builtIn !== true).length, [courses]);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedQuery(query.trim()), 280);
    return () => window.clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    let cancelled = false;
    setSearchState((current) => ({ status: "loading", data: current.data }));
    void internalCourseDataProvider.searchCourses({ courses, query: debouncedQuery, limit: 40 })
      .then((result) => {
        if (cancelled) return;
        if (result.ok) setSearchState({ status: "ready", data: result.data });
        else setSearchState((current) => ({ status: "error", data: current.data, message: "No pudimos actualizar la búsqueda. Intenta de nuevo." }));
      })
      .catch(() => {
        if (!cancelled) setSearchState((current) => ({ status: "error", data: current.data, message: "No pudimos actualizar la búsqueda. Intenta de nuevo." }));
      });
    return () => { cancelled = true; };
  }, [courses, debouncedQuery, searchRetry]);

  async function loadMoreCourses() {
    const cursor = searchState.data.nextCursor;
    if (!cursor) return;
    setSearchState((current) => ({ status: "loading", data: current.data }));
    try {
      const result = await internalCourseDataProvider.searchCourses({ courses, query: debouncedQuery, limit: 40, cursor });
      if (!result.ok) throw new Error("course search failed");
      setSearchState((current) => {
        const combined = [...current.data.courses, ...result.data.courses.filter((course) => !current.data.courses.some((existing) => existing.id === course.id))];
        return { status: "ready", data: { ...result.data, courses: combined, catalog: buildInternalCourseCatalog(combined) } };
      });
    } catch {
      setSearchState((current) => ({ status: "error", data: current.data, message: "No pudimos cargar más campos. Intenta de nuevo." }));
    }
  }

  function requestNearbyCourses() {
    setFilter("nearby");
    if (!("geolocation" in navigator)) {
      setNearbyState({ status: "unsupported", message: "Este dispositivo no ofrece ubicación. Puedes buscar el campo manualmente." });
      return;
    }
    setNearbyState({ status: "requesting" });
    navigator.geolocation.getCurrentPosition((position) => {
      void internalCourseDataProvider.nearbyCourses({
        courses,
        origin: { latitude: position.coords.latitude, longitude: position.coords.longitude },
        radiusKm: 100,
        limit: 100,
      }).then((result) => {
        if (!result.ok) {
          setNearbyState({ status: "error", message: "No pudimos calcular los campos cercanos. Puedes buscarlos manualmente." });
          return;
        }
        setNearbyState(result.data.matches.length ? { status: "ready", matches: result.data.matches } : { status: "empty" });
      }).catch(() => setNearbyState({ status: "error", message: "No pudimos calcular los campos cercanos. Puedes buscarlos manualmente." }));
    }, (error) => {
      if (error.code === error.PERMISSION_DENIED) {
        setNearbyState({ status: "denied", message: "No compartiste tu ubicación. No la necesitas para jugar: busca el campo manualmente." });
      } else {
        setNearbyState({ status: "error", message: "No pudimos obtener tu ubicación. Puedes buscar el campo manualmente." });
      }
    }, { enableHighAccuracy: false, maximumAge: 300_000, timeout: 8_000 });
  }

  const nearbyMatches = nearbyState.status === "ready" ? nearbyState.matches : EMPTY_NEARBY_MATCHES;
  const nearbyBySelection = useMemo(() => new Map(nearbyMatches.map((match) => [match.course.id, match.distanceKm])), [nearbyMatches]);
  const searchedCourses = filter === "nearby" && nearbyState.status === "ready"
    ? nearbyMatches.map((match) => match.course)
    : searchState.data.courses;
  const displayCatalog = useMemo(() => buildInternalCourseCatalog(searchedCourses), [searchedCourses]);
  const catalogEntryBySelection = useMemo(
    () => new Map(displayCatalog.entries.map((entry) => [entry.selectionId, entry])),
    [displayCatalog.entries],
  );
  const visibleCourses = useMemo(() => [...searchedCourses]
    .filter((course) => {
      if (filter === "favorites" && !favoriteSet.has(course.id)) return false;
      if (filter === "recent" && !recentRank.has(course.id)) return false;
      if (filter === "mine" && course.builtIn === true) return false;
      return true;
    })
    .sort((left, right) => {
      if (filter === "nearby") return (nearbyBySelection.get(left.id) ?? Number.MAX_SAFE_INTEGER) - (nearbyBySelection.get(right.id) ?? Number.MAX_SAFE_INTEGER);
      const favoriteDifference = Number(favoriteSet.has(right.id)) - Number(favoriteSet.has(left.id));
      if (favoriteDifference) return favoriteDifference;
      const leftRecent = recentRank.get(left.id) ?? Number.MAX_SAFE_INTEGER;
      const rightRecent = recentRank.get(right.id) ?? Number.MAX_SAFE_INTEGER;
      if (leftRecent !== rightRecent) return leftRecent - rightRecent;
      return left.name.localeCompare(right.name, "es-MX");
    }), [favoriteSet, filter, nearbyBySelection, recentRank, searchedCourses]);
  const visibleGroups = useMemo(() => groupSelections(visibleCourses), [visibleCourses]);
  const searchPending = searchState.status === "loading" || query.trim() !== debouncedQuery;
  const nearbyMessage = filter === "nearby" && nearbyState.status !== "ready" ? nearbyState : null;

  return <section className="betaCourseLibrary" aria-labelledby="beta-courses-title">
    <section className="hero betaCoursesHero"><div><span className="eyebrow">THE BACKYARD · CAMPOS</span><h1 id="beta-courses-title">Elige dónde jugar.</h1><p>Campo, tee y datos guardados; tu ronda conserva su propia tarjeta.</p></div><button type="button" className="primary" onClick={onCreateCourse}>Crear campo</button></section>

    <section className="card betaCourseSearch">
      <label className="betaSearchLabel" htmlFor="course-library-search">Buscar campo</label>
      <div className="betaSearchInput"><span aria-hidden="true">⌕</span><input id="course-library-search" type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Campo, club, ciudad o tee" autoComplete="off" />{query && <button type="button" onClick={() => setQuery("")} aria-label="Limpiar búsqueda">×</button>}</div>
      <div className="segmented betaCourseFilters" aria-label="Filtrar campos">
        <button type="button" className={filter === "nearby" ? "active" : ""} aria-pressed={filter === "nearby"} onClick={requestNearbyCourses}>Cerca de mí</button>
        <button type="button" className={filter === "recent" ? "active" : ""} aria-pressed={filter === "recent"} onClick={() => setFilter("recent")}>Recientes · {recentCourseIds.length}</button>
        <button type="button" className={filter === "favorites" ? "active" : ""} aria-pressed={filter === "favorites"} onClick={() => setFilter("favorites")}>Favoritos · {favoriteCourseIds.length}</button>
        <button type="button" className={filter === "all" ? "active" : ""} aria-pressed={filter === "all"} onClick={() => setFilter("all")}>Buscar · {courses.length}</button>
        <button type="button" className={filter === "mine" ? "active" : ""} aria-pressed={filter === "mine"} onClick={() => setFilter("mine")}>Mis campos · {manualCourseCount}</button>
      </div>
      <p className="betaLocationNotice">Usamos tu ubicación únicamente al tocar “Cerca de mí”. No necesitas compartirla para jugar.</p>
      <p className="srOnly" role="status" aria-live="polite">{searchPending ? "Buscando campos." : `${visibleGroups.length} campo${visibleGroups.length === 1 ? "" : "s"} visible${visibleGroups.length === 1 ? "" : "s"}.`}</p>
    </section>

    {searchState.status === "error" && <div className="notice bad betaCourseState" role="alert"><span>{searchState.message}</span><button type="button" className="secondary" onClick={() => setSearchRetry((value) => value + 1)}>Reintentar</button></div>}
    {searchPending && <section className="card betaCourseState" aria-live="polite"><span className="betaCourseSpinner" aria-hidden="true" /><div><b>Buscando campos…</b><p>Revisando resultados disponibles.</p></div></section>}

    {nearbyMessage?.status === "requesting" && <section className="card betaCourseState" aria-live="polite"><span className="betaCourseSpinner" aria-hidden="true" /><div><b>Buscando cerca de ti…</b><p>Tu ubicación no se guarda en tu perfil.</p></div></section>}
    {nearbyMessage?.status === "empty" && <section className="card betaCoursesEmpty" aria-live="polite"><span className="betaEmptyFlag" aria-hidden="true">⌖</span><h2>Aún no hay campos con ubicación verificada.</h2><p>Los campos guardados siguen disponibles en búsqueda manual. No mostramos distancias inventadas.</p><button type="button" className="secondary" onClick={() => setFilter("all")}>Buscar manualmente</button></section>}
    {nearbyMessage && ["denied", "unsupported", "error"].includes(nearbyMessage.status) && <section className="card betaCoursesEmpty" role="status"><span className="betaEmptyFlag" aria-hidden="true">⌖</span><h2>Usa la búsqueda manual</h2><p>{"message" in nearbyMessage ? nearbyMessage.message : "La ubicación no está disponible."}</p><button type="button" className="secondary" onClick={() => setFilter("all")}>Buscar manualmente</button></section>}

    {displayCatalog.rejectedCount > 0 && <div className="notice bad" role="alert">No mostramos {displayCatalog.rejectedCount} registro{displayCatalog.rejectedCount === 1 ? "" : "s"} con datos incompletos o ambiguos. Sus datos siguen guardados y no se usarán en una ronda hasta quedar válidos.</div>}

    {!nearbyMessage && visibleGroups.length ? <section className="betaCourseList" aria-label={`${visibleGroups.length} campos`}>
      {visibleGroups.map((group) => {
        const selectedInGroup = group.selections.find((selection) => selection.id === selectedCourseId);
        const requestedTeeId = teeSelections[group.id];
        const chosen = group.selections.find((selection) => selection.id === requestedTeeId) || selectedInGroup || group.selections[0];
        const entry = catalogEntryBySelection.get(chosen.id);
        if (!entry?.course || !entry.tee) return null;
        const yardage = entry.tee.totalYardage;
        const updated = updatedLabel(entry.course.updatedAt || entry.course.verifiedAt);
        const favorite = favoriteSet.has(chosen.id);
        const selected = Boolean(selectedInGroup);
        const distanceKm = nearbyBySelection.get(chosen.id);
        return <article className={`card betaCourseCard ${selected ? "selected" : ""}`} key={group.id}>
          <div className="betaCourseCardHead">
            <div>{selected && <span className="betaSelectedCourse">SELECCIONADO</span>}<h2>{entry.course.name}</h2><p>{entry.course.clubName || `Tee ${entry.tee.name}`}{entry.course.city ? ` · ${entry.course.city}` : ""}</p></div>
            <button type="button" className={`betaFavoriteCourse ${favorite ? "active" : ""}`} aria-pressed={favorite} aria-label={`${favorite ? "Quitar" : "Agregar"} ${chosen.name} ${favorite ? "de" : "a"} favoritos`} onClick={() => onToggleFavorite(chosen.id)}>{favorite ? "★" : "☆"}</button>
          </div>
          {group.selections.length > 1 ? <label className="betaCourseTeeSelect">Tee<select value={chosen.id} onChange={(event) => setTeeSelections((current) => ({ ...current, [group.id]: event.target.value }))}>{group.selections.map((selection) => <option key={selection.id} value={selection.id}>{selection.teeName}{selection.totalYards ? ` · ${selection.totalYards.toLocaleString("es-MX")} yd` : ""}</option>)}</select></label> : <div className="betaCourseSingleTee"><span>Tee</span><b>{chosen.teeName}</b></div>}
          <div className="betaCourseFacts"><span><small>Hoyos</small><b>{entry.course.holesCount}</b></span><span><small>Par</small><b>{entry.course.par}</b></span>{yardage !== undefined && <span><small>Yardas</small><b>{yardage.toLocaleString("es-MX")}</b></span>}{entry.tee.rating !== undefined && <span><small>Rating</small><b>{entry.tee.rating}</b></span>}{entry.tee.slope !== undefined && <span><small>Slope</small><b>{entry.tee.slope}</b></span>}{distanceKm !== undefined && <span className="betaCourseDistance"><small>Distancia</small><b>{distanceKm.toFixed(1)} km</b></span>}</div>
          {updated && <p className="betaCourseUpdated">Datos revisados {updated}</p>}
          <div className="betaCourseActions"><button type="button" className="primary" onClick={() => onSelectCourse(chosen)}>{selected && chosen.id === selectedCourseId ? "Usar este tee" : "Seleccionar campo"}</button>{onEditCourse && <button type="button" className="secondary" onClick={() => onEditCourse(chosen)}>Editar</button>}</div>
        </article>;
      })}
    </section> : !nearbyMessage && !searchPending && <section className="card betaCoursesEmpty" aria-live="polite">
      <span className="betaEmptyFlag" aria-hidden="true">⌖</span>
      <h2>{filter === "mine" ? "Aún no tienes campos propios." : courses.length ? "No encontramos campos con ese filtro." : "Aún no tienes campos."}</h2>
      <p>{filter === "mine" ? "Crea un campo manual con su par y stroke index; quedará disponible sin alterar el catálogo interno." : courses.length ? "Prueba otro nombre o vuelve a la búsqueda." : "Crea un campo manual con el par y stroke index de cada hoyo."}</p>
      {filter === "mine" || !courses.length ? <button type="button" className="primary" onClick={onCreateCourse}>{courses.length ? "Crear campo" : "Crear primer campo"}</button> : <button type="button" className="secondary" onClick={() => { setQuery(""); setFilter("all"); }}>Volver a buscar</button>}
    </section>}

    {!nearbyMessage && searchState.data.hasMore && <button type="button" className="secondary betaCourseLoadMore" disabled={searchPending} onClick={() => void loadMoreCourses()}>Cargar más campos</button>}
    <aside className="betaCourseDataNote"><b>Datos de campos</b><span>Esta biblioteca usa campos internos o creados manualmente. Las distancias solo aparecen cuando existen coordenadas con procedencia; no consulta ni copia proveedores externos.</span></aside>
  </section>;
}
