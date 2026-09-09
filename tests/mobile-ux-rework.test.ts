import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path: string) => readFileSync(path, "utf8");

test("el editor de apuestas permite borrar cero, retirar y editar las reglas relevantes", () => {
  const editor = read("app/components/group-bet-template-editor.tsx");
  assert.match(editor, /NumericCaptureInput/);
  assert.match(editor, /emptyWhenZero/);
  assert.doesNotMatch(editor, /<input[^>]+type="number"[^>]+value=\{value\}/);
  assert.match(editor, /Quitar esta apuesta/);
  assert.match(editor, /Base de ventajas/);
  assert.match(editor, /Entre jugadores/);
  assert.match(editor, /Sobre campo/);
  assert.match(editor, /Carry al siguiente hoyo/);
  assert.match(editor, /generateAutomaticFoursomes/);
  assert.match(editor, /Generada por Backyard/);
  assert.match(editor, /Índice actual/);
  assert.match(editor, /Sliding/);
});

test("onboarding conserva salida, regreso y progreso multiselección", () => {
  const flow = read("app/components/beta-onboarding-flow.tsx");
  const equipment = read("app/components/equipment-onboarding.tsx");
  assert.match(flow, /Guardar y continuar después/);
  assert.match(flow, /← Anterior/);
  assert.match(flow, /primaryGoals/);
  assert.match(flow, /Los usaremos para personalizar recomendaciones/);
  assert.match(equipment, /Guardar y continuar después/);
  assert.match(equipment, /← Anterior/);
});

test("perfil y grupos usan archivos o avatares, nunca placeholders URL", () => {
  const picker = read("app/components/profile-image-picker.tsx");
  const provider = read("app/components/account-provider.tsx");
  const group = read("app/components/beta-onboarding-flow.tsx");
  assert.match(picker, /accept="image\/jpeg,image\/png,image\/webp"/);
  assert.match(picker, /Subir foto/);
  assert.match(picker, /Avatares disponibles/);
  assert.match(provider, /<ProfileImagePicker value=\{avatarUrl\}/);
  assert.match(group, /<ProfileImagePicker[^>]+kind="group"/);
  assert.doesNotMatch(`${provider}\n${group}`, /placeholder="https:\/\//);
});

test("la sesión persistente es una elección explícita y conserva el origin OAuth", () => {
  const provider = read("app/components/account-provider.tsx");
  const supabase = read("lib/supabase/client.ts");
  const authFlow = read("lib/auth-flow.ts");
  assert.match(provider, /Mantener sesión iniciada en este dispositivo/);
  assert.match(provider, /setAuthSessionPersistence\(rememberSession\)/);
  assert.match(supabase, /AUTH_SESSION_PERSISTENCE_KEY/);
  assert.match(supabase, /localStorage/);
  assert.match(supabase, /sessionStorage/);
  assert.match(authFlow, /authCallbackUrl/);
  assert.match(authFlow, /new URL\("\/auth\/callback", `\$\{parsed\.protocol\}\/\/\$\{parsed\.host\}`\)\.toString\(\)/);
});
