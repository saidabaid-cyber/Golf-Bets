import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

import {
  devicePermissionContext,
  locationPermissionPresentation,
  notificationPermissionPresentation,
  type LocationPermissionUiState,
} from "../lib/device-permissions";
import {
  accountUiPreferencesKey,
  displayDistanceFromStoredYards,
  readAccountUiPreferences,
  writeAccountUiPreferences,
} from "../lib/account-ui-preferences";

test("matriz de ubicación nunca ofrece un CTA falso de administración", () => {
  const expected: Record<LocationPermissionUiState, [string, string | null]> = {
    checking: ["Consultando", null],
    requesting: ["Solicitando", null],
    prompt: ["todavía no se ha solicitado", "Permitir ubicación"],
    granted: ["Ubicación permitida", "Cómo cambiar este permiso"],
    denied: ["Ubicación bloqueada", "Cómo habilitarla"],
    "query-unsupported": ["No podemos consultar este permiso", "Cómo revisar este permiso"],
    "geolocation-unavailable": ["no está disponible", "Ver alternativas"],
    timeout: ["tardó demasiado", "Reintentar ubicación"],
    unavailable: ["No pudimos obtener", "Reintentar ubicación"],
  };
  for (const [state, [status, actionLabel]] of Object.entries(expected) as Array<[LocationPermissionUiState, [string, string | null]]>) {
    const view = locationPermissionPresentation(state);
    assert.match(view.status, new RegExp(status, "i"));
    assert.equal(view.actionLabel || null, actionLabel);
    assert.doesNotMatch(view.actionLabel || "", /Administrar/i);
  }
});

test("un contexto sin Notifications API informa indisponibilidad sin instrucciones PWA", () => {
  const iphoneWeb = devicePermissionContext({ userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)", notificationApi: false });
  const unavailable = notificationPermissionPresentation("unavailable", iphoneWeb);
  assert.match(unavailable.status, /no están disponibles/i);
  assert.equal(unavailable.actionLabel, "Más información");
  assert.doesNotMatch(`${unavailable.status} ${unavailable.detail} ${unavailable.actionLabel}`, /instalar|pantalla de inicio/i);

  const iphonePwa = devicePermissionContext({ userAgent: "iPhone", navigatorStandalone: true, notificationApi: true });
  assert.equal(notificationPermissionPresentation("default", iphonePwa).actionLabel, "Permitir notificaciones");
  assert.match(notificationPermissionPresentation("granted", iphonePwa).status, /Permitidas en este dispositivo/);
  assert.match(notificationPermissionPresentation("granted", iphonePwa).detail || "", /envío push.*todavía no está activado/i);
  assert.equal(notificationPermissionPresentation("denied", iphonePwa).actionLabel, "Cómo habilitarlas");
});

test("componente dispara APIs nativas sólo desde CTAs explícitos y ofrece salida instructiva", () => {
  const source = readFileSync("app/components/device-permissions.tsx", "utf8");
  assert.match(source, /requestCourseLocation\(navigator\.geolocation/);
  assert.match(source, /Notification\.requestPermission\(\)/);
  assert.doesNotMatch(source, /Agregar a pantalla de inicio|Cómo instalar The Backyard/);
  assert.match(source, /Ajustes &gt; Apps &gt; Safari &gt; Ubicación/);
  assert.doesNotMatch(source, /Administrar ubicación|Administrar notificaciones/);
});

test("unidades y preferencias de canales persisten por cuenta sin mutar yardas almacenadas", () => {
  const values = new Map<string, string>();
  const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
  const saved = writeAccountUiPreferences(storage, "owner-a", { version: 1, distanceUnit: "meters", push: true, email: true, rounds: false, reminders: true });
  assert.deepEqual(readAccountUiPreferences(storage, "owner-a"), saved);
  assert.equal(readAccountUiPreferences(storage, "owner-b").distanceUnit, "yards");
  assert.notEqual(accountUiPreferencesKey("owner-a"), accountUiPreferencesKey("owner-b"));
  const storedYards = 100;
  assert.equal(displayDistanceFromStoredYards(storedYards, "meters"), "91 m");
  assert.equal(storedYards, 100);
});

test("Home Club usa modo de club sin selección de tee ni ratings", () => {
  const onboarding = readFileSync("app/components/beta-onboarding-flow.tsx", "utf8");
  const picker = readFileSync("app/components/catalog-course-picker.tsx", "utf8");
  const profile = readFileSync("app/components/profile-account-panel.tsx", "utf8");
  assert.match(onboarding, /purpose="home-club"/);
  assert.match(onboarding, /!profile\.homeClubId \|\| !profile\.homeCourseId \|\| !homeClubSelectionReady/);
  assert.match(onboarding, /onSelectHomeCourse=/);
  assert.match(onboarding, /if\(result!==['"]cloud['"]\)throw new Error\(['"]No pudimos confirmar tu Home Club en la nube\. Reintenta para continuar\./);
  assert.doesNotMatch(onboarding, /onSelectClub=\{club =>/);
  assert.match(picker, /if\(purpose==='home-club'\)\{[\s\S]*await onSelectHomeCourse[\s\S]*return;/);
  const homeSelection = picker.indexOf("if(purpose==='home-club'){");
  const homePersisted = picker.indexOf("await onSelectHomeCourse", homeSelection);
  const homeReady = picker.indexOf("onSelectionReadyChange?.(true)", homePersisted);
  const scorecardFetch = picker.indexOf("/api/courses/catalog?courseId", homeSelection);
  assert.ok(homeSelection >= 0 && homeSelection < homePersisted && homePersisted < homeReady && homeReady < scorecardFetch, "Home Club confirma persistencia antes de ready y sale antes del fetch de tees");
  assert.match(picker, /selectedClubCourses\.length>1&&<label>Recorrido/);
  assert.match(picker, /purpose==='round'&&cards\.length>0&&<label>Salida \/ tee inicial/);
  assert.match(picker, /purpose==='round'&&cards\.length>0&&<details/);
  assert.match(profile, /<CatalogCoursePicker purpose="home-club"/);
  assert.match(profile, /homeClubSelectionIncomplete/);
  assert.doesNotMatch(profile, /<ProfileClubPicker/);
});

test("alto contraste inicia activo para cuenta nueva y conserva una elección previa", () => {
  const provider = readFileSync("app/components/account-provider.tsx", "utf8");
  const onboarding = readFileSync("app/components/beta-onboarding-flow.tsx", "utf8");
  assert.match(provider, /accountEntry\.existingAccount && !preferencesResult\.error/);
  assert.match(onboarding, /localStorage\.getItem\(STORAGE_KEYS\.contrast\) !== 'false'/);
});
