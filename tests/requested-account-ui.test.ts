import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const page = readFileSync("app/page.tsx", "utf8");
const account = readFileSync("app/components/account-panel.tsx", "utf8");

test("Resultados usa el encabezado seguro Gastos sin interpolar una identidad ausente", () => {
  assert.match(page, /ResultAccordion id="expenses" title="Gastos"/);
  assert.doesNotMatch(page, /Gastos de \$\{owner\?\.name\}/);
});

test("Nueva ronda pide confirmación exacta y conserva respaldo antes de reemplazar", () => {
  assert.match(page, /¿Iniciar una nueva ronda\?/);
  assert.match(page, /Ya tienes una ronda en curso\. Si comienzas una nueva, la ronda actual dejará de ser la ronda activa\./);
  assert.match(page, /Sí, iniciar nueva ronda/);
  assert.match(page, /markRoundDraftCancelled\(activeDraft/);
  assert.match(page, /preserveDraftConflict\(localStorage, cancelledDraft\)/);
});

test("Cuenta invitada muestra solo el estado local y nunca una tarjeta de identidad falsa", () => {
  assert.match(account, /Modo invitado · Los datos permanecen en este dispositivo/);
  assert.match(account, /identity\.mode === "authenticated" && <section className="card profileCard">/);
  assert.doesNotMatch(account, /Sin correo · Invitado/);
});

test("Configuración explica cómo agregar jugadores y grupos guardados", () => {
  assert.match(page, /Toca aquí para agregar un jugador/);
  assert.match(page, /Toca aquí para agregar un grupo/);
});
