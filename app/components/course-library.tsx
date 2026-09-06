"use client";

import { useMemo, useState } from "react";
import { searchInternalCourses } from "../../lib/golf-providers";
import type { Course } from "../../lib/types";

type CourseFilter = "all" | "favorites" | "recent";

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

function coursePar(course: Course) {
  return course.holes.reduce((total, hole) => total + hole.par, 0);
}

function courseYardage(course: Course) {
  if (!course.holes.length || course.holes.some((hole) => typeof hole.yards !== "number" || !Number.isFinite(hole.yards))) return null;
  return course.holes.reduce((total, hole) => total + (hole.yards || 0), 0);
}

function updatedLabel(updatedAt: string | undefined) {
  if (!updatedAt) return null;
  const date = new Date(updatedAt.length === 10 ? `${updatedAt}T12:00:00-06:00` : updatedAt);
  if (Number.isNaN(date.getTime())) return updatedAt;
  return new Intl.DateTimeFormat("es-MX", { day: "numeric", month: "short", year: "numeric", timeZone: "America/Mexico_City" }).format(date);
}

export function CourseLibrary({ courses, favoriteCourseIds, recentCourseIds = [], selectedCourseId, onToggleFavorite, onSelectCourse, onCreateCourse, onEditCourse }: CourseLibraryProps) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<CourseFilter>("all");
  const favoriteSet = useMemo(() => new Set(favoriteCourseIds), [favoriteCourseIds]);
  const recentRank = useMemo(() => new Map(recentCourseIds.map((id, index) => [id, index])), [recentCourseIds]);
  const searchedCourses = useMemo(() => searchInternalCourses({ courses, query, limit: 200 }).courses, [courses, query]);
  const visibleCourses = useMemo(() => searchedCourses
    .filter((course) => {
      if (filter === "favorites" && !favoriteSet.has(course.id)) return false;
      if (filter === "recent" && !recentRank.has(course.id)) return false;
      return true;
    })
    .sort((left, right) => {
      const favoriteDifference = Number(favoriteSet.has(right.id)) - Number(favoriteSet.has(left.id));
      if (favoriteDifference) return favoriteDifference;
      const leftRecent = recentRank.get(left.id) ?? Number.MAX_SAFE_INTEGER;
      const rightRecent = recentRank.get(right.id) ?? Number.MAX_SAFE_INTEGER;
      if (leftRecent !== rightRecent) return leftRecent - rightRecent;
      return left.name.localeCompare(right.name, "es-MX");
    }), [favoriteSet, filter, recentRank, searchedCourses]);

  return <section className="betaCourseLibrary" aria-labelledby="beta-courses-title">
    <section className="hero betaCoursesHero"><div><span className="eyebrow">THE BACKYARD · CAMPOS</span><h1 id="beta-courses-title">Elige dónde jugar.</h1><p>Tu biblioteca interna y manual, sin datos externos inventados.</p></div><button type="button" className="primary" onClick={onCreateCourse}>Crear campo</button></section>

    <section className="card betaCourseSearch">
      <label className="betaSearchLabel" htmlFor="course-library-search">Buscar campo</label>
      <div className="betaSearchInput"><span aria-hidden="true">⌕</span><input id="course-library-search" type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Nombre del campo o tee" autoComplete="off" />{query && <button type="button" onClick={() => setQuery("")} aria-label="Limpiar búsqueda">×</button>}</div>
      <div className="segmented betaCourseFilters" aria-label="Filtrar campos">
        <button type="button" className={filter === "all" ? "active" : ""} aria-pressed={filter === "all"} onClick={() => setFilter("all")}>Todos · {courses.length}</button>
        <button type="button" className={filter === "favorites" ? "active" : ""} aria-pressed={filter === "favorites"} onClick={() => setFilter("favorites")}>Favoritos · {favoriteCourseIds.length}</button>
        <button type="button" className={filter === "recent" ? "active" : ""} aria-pressed={filter === "recent"} onClick={() => setFilter("recent")}>Recientes · {recentCourseIds.length}</button>
      </div>
      <p className="srOnly" role="status" aria-live="polite">{visibleCourses.length} campo{visibleCourses.length === 1 ? "" : "s"} visible{visibleCourses.length === 1 ? "" : "s"}.</p>
    </section>

    {visibleCourses.length ? <section className="betaCourseList" aria-label={`${visibleCourses.length} campos`}>
      {visibleCourses.map((course) => {
        const yardage = courseYardage(course);
        const updated = updatedLabel(course.updatedAt);
        const favorite = favoriteSet.has(course.id);
        const selected = selectedCourseId === course.id;
        return <article className={`card betaCourseCard ${selected ? "selected" : ""}`} key={course.id}>
          <div className="betaCourseCardHead">
            <div>{selected && <span className="betaSelectedCourse">SELECCIONADO</span>}<h2>{course.name}</h2><p>{course.teeName || "Tee sin nombre"}</p></div>
            <button type="button" className={`betaFavoriteCourse ${favorite ? "active" : ""}`} aria-pressed={favorite} aria-label={`${favorite ? "Quitar" : "Agregar"} ${course.name} ${favorite ? "de" : "a"} favoritos`} onClick={() => onToggleFavorite(course.id)}>{favorite ? "★" : "☆"}</button>
          </div>
          <div className="betaCourseFacts"><span><small>Hoyos</small><b>{course.holes.length}</b></span><span><small>Par</small><b>{coursePar(course)}</b></span>{yardage !== null && <span><small>Yardas</small><b>{yardage.toLocaleString("es-MX")}</b></span>}</div>
          {updated && <p className="betaCourseUpdated">Actualizado {updated}</p>}
          <div className="betaCourseActions"><button type="button" className="primary" onClick={() => onSelectCourse(course)}>{selected ? "Usar este campo" : "Seleccionar campo"}</button>{onEditCourse && <button type="button" className="secondary" onClick={() => onEditCourse(course)}>Editar</button>}</div>
        </article>;
      })}
    </section> : <section className="card betaCoursesEmpty" aria-live="polite">
      <span className="betaEmptyFlag" aria-hidden="true">⌖</span><h2>{courses.length ? "No encontramos campos con ese filtro." : "Aún no tienes campos."}</h2><p>{courses.length ? "Prueba otro nombre o vuelve a mostrar todos los campos." : "Crea un campo manual con el par y stroke index de cada hoyo."}</p>{courses.length ? <button type="button" className="secondary" onClick={() => { setQuery(""); setFilter("all"); }}>Mostrar todos</button> : <button type="button" className="primary" onClick={onCreateCourse}>Crear primer campo</button>}
    </section>}

    <aside className="betaCourseDataNote"><b>Datos de campos</b><span>Esta biblioteca usa únicamente campos guardados en The Backyard o creados manualmente. No consulta ni copia proveedores externos.</span></aside>
  </section>;
}
