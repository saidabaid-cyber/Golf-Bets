"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AnchoredSearch, AnchoredSearchOption } from "./anchored-search";

type CourseResult = {
  id: string;
  courseId: string;
  clubId?: string;
  name: string;
  clubName?: string;
  city?: string;
  distanceKm?: number;
  localIndexTeeAvailable?: boolean;
  tee?: { id: string; name: string; rating?: number; slope?: number; yards?: number; localIndexRated?: boolean };
};

type CoursePage = {
  courses?: CourseResult[];
  hasMore?: boolean;
  nextCursor?: string | null;
};

async function loadCoursePage(query: string, cursor?: string | null, signal?: AbortSignal): Promise<CoursePage> {
  const params = new URLSearchParams({ q: query, limit: "12" });
  if (cursor) params.set("cursor", cursor);
  const response = await fetch(`/api/courses/search?${params}`, { signal });
  if (!response.ok) throw new Error("course-search-failed");
  return response.json() as Promise<CoursePage>;
}

async function loadNearbyCoursePage(latitude: number, longitude: number, signal?: AbortSignal): Promise<CoursePage> {
  const params = new URLSearchParams({ nearby: "1", lat: String(latitude), lng: String(longitude), limit: "12" });
  const response = await fetch(`/api/courses/search?${params}`, { signal, cache: "no-store" });
  if (!response.ok) throw new Error("nearby-course-search-failed");
  return response.json() as Promise<CoursePage>;
}

function mergeCourseResults(current: CourseResult[], incoming: CourseResult[]) {
  const merged = new Map(current.map((course) => [course.courseId, course]));
  for (const course of incoming) {
    const previous = merged.get(course.courseId);
    if (!previous || (course.tee?.localIndexRated && !previous.tee?.localIndexRated)) merged.set(course.courseId, course);
  }
  return [...merged.values()];
}

export function RoundCoursePicker({
  selectedName,
  selectedId,
  pendingName,
  invalid,
  describedBy,
  onSelect,
}: {
  selectedName: string;
  selectedId: string;
  pendingName?: string;
  invalid: boolean;
  describedBy?: string;
  onSelect: (course: CourseResult) => void;
}) {
  const [query, setQuery] = useState(selectedName);
  const [selectedCourseId, setSelectedCourseId] = useState(selectedId);
  const [results, setResults] = useState<CourseResult[]>([]);
  const [status, setStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [hasMore, setHasMore] = useState(false);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [nearbyStatus, setNearbyStatus] = useState<"idle" | "locating" | "empty" | "denied" | "error">("idle");
  const [resultMode, setResultMode] = useState<"name" | "nearby">("name");
  const nearbyRequestRef = useRef(0);

  useEffect(() => {
    if (selectedId && selectedName) {
      ++nearbyRequestRef.current;
      setSelectedCourseId(selectedId);
      setQuery(selectedName);
      setResultMode("name");
    }
  }, [selectedId, selectedName]);

  useEffect(() => {
    const normalized = query.trim();
    if (resultMode === "nearby") return;
    if (selectedCourseId || normalized.length < 2) {
      setResults([]);
      setStatus("idle");
      setHasMore(false);
      setNextCursor(null);
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setStatus("loading");
      try {
        const page = await loadCoursePage(normalized, null, controller.signal);
        if (controller.signal.aborted) return;
        setResults(mergeCourseResults([], page.courses ?? []));
        setHasMore(page.hasMore === true);
        setNextCursor(typeof page.nextCursor === "string" ? page.nextCursor : null);
        setStatus("ready");
      } catch {
        if (!controller.signal.aborted) {
          setResults([]);
          setStatus("error");
        }
      }
    }, 250);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [query, selectedCourseId, resultMode]);

  const visibleResults = useMemo(() => mergeCourseResults([], results), [results]);
  const expanded = !selectedCourseId && (visibleResults.length > 0 || status === "loading" || status === "error");

  function requestNearbyCourses() {
    if (!navigator.geolocation) {
      setResultMode("name");
      setNearbyStatus("error");
      return;
    }
    const requestId = ++nearbyRequestRef.current;
    // Switching modes aborts the pending name search. Otherwise its delayed
    // response could replace the distance-sorted nearby results.
    setResultMode("nearby");
    setSelectedCourseId("");
    setResults([]);
    setStatus("idle");
    setHasMore(false);
    setNextCursor(null);
    setNearbyStatus("locating");
    navigator.geolocation.getCurrentPosition((position) => {
      if (requestId !== nearbyRequestRef.current) return;
      void loadNearbyCoursePage(position.coords.latitude, position.coords.longitude).then((page) => {
        if (requestId !== nearbyRequestRef.current) return;
        const next = mergeCourseResults([], page.courses ?? []);
        setResults(next);
        setHasMore(false);
        setNextCursor(null);
        setStatus("ready");
        setNearbyStatus(next.length ? "idle" : "empty");
      }).catch(() => {
        if (requestId !== nearbyRequestRef.current) return;
        setResults([]);
        setStatus("idle");
        setResultMode("name");
        setNearbyStatus("error");
      });
    }, (error) => {
      if (requestId !== nearbyRequestRef.current) return;
      setResultMode("name");
      setNearbyStatus(error.code === error.PERMISSION_DENIED ? "denied" : "error");
    }, { enableHighAccuracy: false, timeout: 8_000, maximumAge: 300_000 });
  }

  return <div className={`courseSelectionField ${invalid ? "isMissing" : ""}`}>
    <AnchoredSearch
      label="Campo"
      value={query}
      onChange={(value) => {
        ++nearbyRequestRef.current;
        setQuery(value);
        setSelectedCourseId("");
        setResultMode("name");
        setNearbyStatus("idle");
      }}
      placeholder={pendingName ? `Busca ${pendingName}` : "Busca campo o club"}
      invalid={invalid}
      describedBy={describedBy}
      expanded={expanded}
      status={status === "loading"
        ? "Buscando campos…"
        : status === "error"
          ? "No pudimos consultar el catálogo. Usa Buscar / cerca o crea el campo manualmente."
          : selectedCourseId
            ? "Campo seleccionado ✓"
            : resultMode === "nearby" && visibleResults.length
              ? "Campos cercanos del catálogo, ordenados por distancia. También puedes escribir para buscar por nombre."
            : "Escribe al menos dos letras para buscar por nombre."}
    >
      {visibleResults.map((course) => <AnchoredSearchOption key={course.courseId} label={`Seleccionar ${course.name}`} onSelect={() => {
        ++nearbyRequestRef.current;
        setQuery(course.name);
        setSelectedCourseId(course.courseId);
        setResultMode("name");
        setNearbyStatus("idle");
        setResults([]);
        onSelect(course);
      }}><b>{course.name}</b><small>{[course.clubName && course.clubName !== course.name ? course.clubName : "", course.city, typeof course.distanceKm === "number" ? `${course.distanceKm.toFixed(1)} km` : "", course.localIndexTeeAvailable ? "Tees con Rating/Slope publicados · Index local" : ""].filter(Boolean).join(" · ") || "Catálogo Backyard"}</small></AnchoredSearchOption>)}
      {hasMore && nextCursor && <button type="button" role="option" aria-selected="false" className="textButton" disabled={status === "loading"} onClick={async () => {
        setStatus("loading");
        try {
          const page = await loadCoursePage(query.trim(), nextCursor);
          setResults((current) => mergeCourseResults(current, page.courses ?? []));
          setHasMore(page.hasMore === true);
          setNextCursor(typeof page.nextCursor === "string" ? page.nextCursor : null);
          setStatus("ready");
        } catch {
          setStatus("error");
        }
      }}>Más resultados</button>}
    </AnchoredSearch>
    <button type="button" className="roundCourseLocation secondary" disabled={nearbyStatus === "locating"} onClick={requestNearbyCourses} aria-label="Buscar campos cercanos con mi ubicación"><span aria-hidden="true">➤</span>{nearbyStatus === "locating" ? "Buscando cerca…" : "Campos cercanos"}</button>
    {nearbyStatus === "denied" && <p className="roundCourseLocationStatus" role="status">No diste permiso de ubicación. Puedes seguir usando la búsqueda por nombre.</p>}
    {nearbyStatus === "empty" && <p className="roundCourseLocationStatus" role="status">No hay campos con coordenadas verificadas cerca en el catálogo actual. La búsqueda manual sigue disponible.</p>}
    {nearbyStatus === "error" && <p className="roundCourseLocationStatus" role="status">No pude obtener campos cercanos. La búsqueda por nombre sigue disponible.</p>}
  </div>;
}
