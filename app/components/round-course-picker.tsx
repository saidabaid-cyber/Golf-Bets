"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AnchoredSearch, AnchoredSearchOption } from "./anchored-search";
import { resolveAuthorizedNearbyLocation, type NearbyLocationResolution } from "../../lib/device-permissions";
import { readAccountDevicePermissionPreferences } from "../../lib/account-device-permission-preferences";

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

function authorization(accessToken?: string | null) {
  return accessToken ? { authorization: `Bearer ${accessToken}` } : undefined;
}

async function loadCoursePage(query: string, accessToken?: string | null, cursor?: string | null, signal?: AbortSignal): Promise<CoursePage> {
  const params = new URLSearchParams({ q: query, limit: "12" });
  if (cursor) params.set("cursor", cursor);
  const response = await fetch(`/api/courses/search?${params}`, { signal, cache: "no-store", headers: authorization(accessToken) });
  if (!response.ok) throw new Error("course-search-failed");
  return response.json() as Promise<CoursePage>;
}

async function loadNearbyCoursePage(latitude: number, longitude: number, accessToken?: string | null, cursor?: string | null, signal?: AbortSignal): Promise<CoursePage> {
  const params = new URLSearchParams({ nearby: "1", lat: String(latitude), lng: String(longitude), limit: cursor ? "12" : "3" });
  if (cursor) params.set("cursor", cursor);
  const response = await fetch(`/api/courses/search?${params}`, { signal, cache: "no-store", headers: authorization(accessToken) });
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
  accessToken,
  permissionOwnerId,
  onSelect,
}: {
  selectedName: string;
  selectedId: string;
  pendingName?: string;
  invalid: boolean;
  describedBy?: string;
  accessToken?: string | null;
  permissionOwnerId: string;
  onSelect: (course: CourseResult) => void;
}) {
  const [query, setQuery] = useState(selectedName);
  const [selectedCourseId, setSelectedCourseId] = useState(selectedId);
  const [results, setResults] = useState<CourseResult[]>([]);
  const [status, setStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [hasMore, setHasMore] = useState(false);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [nearbyStatus, setNearbyStatus] = useState<"idle" | "locating" | "empty" | "disabled" | "prompt" | "denied" | "timeout" | "unsupported" | "error">("idle");
  const [resultMode, setResultMode] = useState<"name" | "nearby">("name");
  const nearbyRequestRef = useRef(0);
  const nearbyControllerRef = useRef<AbortController | null>(null);
  const nearbyPointRef = useRef<{ latitude: number; longitude: number } | null>(null);

  useEffect(() => () => nearbyControllerRef.current?.abort(), [permissionOwnerId]);

  useEffect(() => {
    if (selectedId && selectedName) {
      ++nearbyRequestRef.current;
      nearbyPointRef.current = null;
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
        const page = await loadCoursePage(normalized, accessToken, null, controller.signal);
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
  }, [query, selectedCourseId, resultMode, accessToken]);

  const visibleResults = useMemo(() => mergeCourseResults([], results), [results]);
  const expanded = !selectedCourseId && (visibleResults.length > 0 || status === "loading" || status === "error");

  async function requestNearbyCourses() {
    const requestId = ++nearbyRequestRef.current;
    nearbyControllerRef.current?.abort();
    const controller = new AbortController();
    nearbyControllerRef.current = controller;
    // Switching modes aborts the pending name search. Otherwise its delayed
    // response could replace the distance-sorted nearby results.
    setResultMode("nearby");
    nearbyPointRef.current = null;
    setSelectedCourseId("");
    setResults([]);
    setStatus("idle");
    setHasMore(false);
    setNextCursor(null);
    setNearbyStatus("locating");
    let location: NearbyLocationResolution;
    try { location = await resolveAuthorizedNearbyLocation(localStorage, permissionOwnerId, navigator, navigator.geolocation, {
      signal: controller.signal,
      ...(accessToken ? { readCurrent: () => readAccountDevicePermissionPreferences(localStorage, permissionOwnerId) } : {}),
    }); }
    catch { if (!controller.signal.aborted && requestId === nearbyRequestRef.current) { setResultMode("name"); setNearbyStatus("error"); } return; }
    if (requestId !== nearbyRequestRef.current || controller.signal.aborted || location.status === "cancelled") return;
    if (location.status !== "located") {
      setResultMode("name");
      if (location.status === "disabled" || location.status === "prompt" || location.status === "denied" || location.status === "timeout") setNearbyStatus(location.status);
      else setNearbyStatus("unsupported");
      return;
    }
    nearbyPointRef.current = location.point;
    void loadNearbyCoursePage(location.point.latitude, location.point.longitude, accessToken, null, controller.signal).then((page) => {
        if (requestId !== nearbyRequestRef.current || controller.signal.aborted) return;
        const next = mergeCourseResults([], page.courses ?? []);
        setResults(next);
        setHasMore(page.hasMore === true);
        setNextCursor(typeof page.nextCursor === "string" ? page.nextCursor : null);
        setStatus("ready");
        setNearbyStatus(next.length ? "idle" : "empty");
      }).catch(() => {
        if (requestId !== nearbyRequestRef.current || controller.signal.aborted) return;
        setResults([]);
        setStatus("idle");
        setResultMode("name");
        setNearbyStatus("error");
      });
  }

  return <div className={`courseSelectionField ${invalid ? "isMissing" : ""}`}>
    <AnchoredSearch
      label="Campo"
      value={query}
      onChange={(value) => {
        ++nearbyRequestRef.current;
        nearbyPointRef.current = null;
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
        nearbyPointRef.current = null;
        setQuery(course.name);
        setSelectedCourseId(course.courseId);
        setResultMode("name");
        setNearbyStatus("idle");
        setResults([]);
        onSelect(course);
      }}><b>{course.name}</b><small>{[course.clubName && course.clubName !== course.name ? course.clubName : "", course.city, typeof course.distanceKm === "number" ? `${course.distanceKm.toFixed(1)} km` : "", course.localIndexTeeAvailable ? "Tees con Rating/Slope publicados · Index local" : ""].filter(Boolean).join(" · ") || "Campo disponible"}</small></AnchoredSearchOption>)}
      {hasMore && nextCursor && <button type="button" role="option" aria-selected="false" className="textButton" disabled={status === "loading"} onClick={async () => {
        setStatus("loading");
        try {
          const point = nearbyPointRef.current;
          const page = resultMode === "nearby" && point
            ? await loadNearbyCoursePage(point.latitude, point.longitude, accessToken, nextCursor)
            : await loadCoursePage(query.trim(), accessToken, nextCursor);
          setResults((current) => mergeCourseResults(current, page.courses ?? []));
          setHasMore(page.hasMore === true);
          setNextCursor(typeof page.nextCursor === "string" ? page.nextCursor : null);
          setStatus("ready");
        } catch {
          setStatus("error");
        }
      }}>Más resultados</button>}
    </AnchoredSearch>
    <button type="button" className="roundCourseLocation secondary" disabled={nearbyStatus === "locating"} onClick={() => void requestNearbyCourses()} aria-label="Buscar campos cercanos con mi ubicación ya autorizada"><span aria-hidden="true">➤</span>{nearbyStatus === "locating" ? "Buscando cerca…" : "Campos cercanos"}</button>
    {nearbyStatus === "disabled" && <p className="roundCourseLocationStatus" role="status">Ubicación desactivada en The Backyard. Revísala en Perfil → Configuración → Privacidad y permisos, o busca por nombre.</p>}
    {nearbyStatus === "prompt" && <p className="roundCourseLocationStatus" role="status">La ubicación todavía no está resuelta en este dispositivo. Revísala desde Privacidad y permisos; la búsqueda manual sigue disponible.</p>}
    {nearbyStatus === "denied" && <p className="roundCourseLocationStatus" role="status">Ubicación bloqueada en este dispositivo. La búsqueda por nombre sigue disponible.</p>}
    {nearbyStatus === "timeout" && <p className="roundCourseLocationStatus" role="status">La ubicación agotó el tiempo; no significa que la rechazaste. Reintenta o busca por nombre.</p>}
    {nearbyStatus === "unsupported" && <p className="roundCourseLocationStatus" role="status">No podemos consultar la ubicación en este navegador. La búsqueda por nombre sigue disponible.</p>}
    {nearbyStatus === "empty" && <p className="roundCourseLocationStatus" role="status">No hay campos cercanos con ubicación disponible. La búsqueda manual sigue disponible.</p>}
    {nearbyStatus === "error" && <p className="roundCourseLocationStatus" role="status">No pude obtener campos cercanos. La búsqueda por nombre sigue disponible.</p>}
  </div>;
}
