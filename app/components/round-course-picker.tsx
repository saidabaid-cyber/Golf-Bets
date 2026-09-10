"use client";

import { useEffect, useMemo, useState } from "react";
import { AnchoredSearch, AnchoredSearchOption } from "./anchored-search";

type CourseResult = {
  id: string;
  courseId: string;
  clubId?: string;
  name: string;
  clubName?: string;
  city?: string;
  tee?: { id: string; name: string; rating?: number; slope?: number; yards?: number };
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

function mergeCourseResults(current: CourseResult[], incoming: CourseResult[]) {
  const merged = new Map(current.map((course) => [course.courseId, course]));
  for (const course of incoming) if (!merged.has(course.courseId)) merged.set(course.courseId, course);
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

  useEffect(() => {
    if (selectedId && selectedName) {
      setSelectedCourseId(selectedId);
      setQuery(selectedName);
    }
  }, [selectedId, selectedName]);

  useEffect(() => {
    const normalized = query.trim();
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
  }, [query, selectedCourseId]);

  const visibleResults = useMemo(() => mergeCourseResults([], results), [results]);
  const expanded = !selectedCourseId && (visibleResults.length > 0 || status === "loading" || status === "error");

  return <div className={`courseSelectionField ${invalid ? "isMissing" : ""}`} aria-describedby={describedBy}>
    <AnchoredSearch
      label="Campo"
      value={query}
      onChange={(value) => {
        setQuery(value);
        setSelectedCourseId("");
      }}
      placeholder={pendingName ? `Busca ${pendingName}` : "Busca campo o club"}
      expanded={expanded}
      status={status === "loading"
        ? "Buscando campos…"
        : status === "error"
          ? "No pudimos consultar el catálogo. Usa Buscar / cerca o crea el campo manualmente."
          : selectedCourseId
            ? "Campo seleccionado ✓"
            : "Escribe al menos dos letras. Los tees se eligen después por jugador."}
    >
      {visibleResults.map((course) => <AnchoredSearchOption key={course.courseId} label={`Seleccionar ${course.name}`} onSelect={() => {
        setQuery(course.name);
        setSelectedCourseId(course.courseId);
        setResults([]);
        onSelect(course);
      }}><b>{course.name}</b><small>{[course.clubName && course.clubName !== course.name ? course.clubName : "", course.city].filter(Boolean).join(" · ") || "Catálogo Backyard"}</small></AnchoredSearchOption>)}
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
  </div>;
}
