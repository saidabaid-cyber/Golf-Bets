# Hard closeout — resultados verificados, 2026-09-16

> **EVIDENCIA HISTÓRICA — NO EJECUTAR COMO RUNBOOK.** Rama, URL, resultados y pasos pertenecen a un corte anterior. Usar [activación canónica](./PREVIEW_CONTROLLED_ACTIVATION.md) y [matriz de producto](./CANONICAL_PRODUCT_STATUS_2026-09-24.md) para el estado actual.

## Estado de entrega

- Branch único: `phase2/full-platform`.
- HEAD local inicial: `eed282dee381e4b6b5eb4c3fc8771602620680b7`; working tree inicialmente limpio.
- HEAD remoto inspeccionado: `146a7beee965145312a4018dad78b34eef87fe34`.
- Implementación de este bloque: `5495b4052875ab4a7b515383eb2d60ef4df6862f`.
- El commit local anterior `eed282d` contiene consentimientos de onboarding y aún no está publicado.
- No hubo push, migraciones remotas, fixtures remotos ni modificaciones de Production. No hay nuevo URL Preview de este bloque.
- Preview anterior inspeccionado: `https://historical-preview-url-retired.invalid`, SHA `146a7be`. No contiene estos cambios.

## Implementación

- Eliminados botón, icono, props y navegación global de Settings en Home/Más. Cuenta y privacidad permanece en Perfil. Sin cambios CSS/assets/hero; CONTINUAR RONDA conservado.
- Fuente de Index GHIN/Backyard compartida entre onboarding y Perfil. Activación usa preferencia Auth existente, validación de propietario y readback; GHIN no inventa vinculación. Valores manuales heredados no se promueven a Index vigente. Compatibilidad de snapshots/HCP de juego de invitados preservada; motor progresivo intacto.
- Puebla: la selección canónica ya era válida en el picker, pero el formulario conservaba su error de un intento previo. Seleccionar región limpia ese error; código/nombre canónicos se guardan.
- Dedupe: `/api/account/entry` consulta únicamente la sesión verificada; no acepta email/userId. Perfil terminado o aceptación legal histórica identifica cuenta existente; una fila mínima creada por Auth no basta. Alta Google/email OTP existente muestra YA TIENES UNA CUENTA; se vuelve a verificar antes de guardar alta. Sin borrado/sobrescritura del perfil existente. Timeouts/fallos quedan cerrados con reintento.
- Público/Amigos usa API autenticada + RPC atómico propio. La elección privada antigua permanece protegida hasta decisión explícita. No se amplía visibilidad de correo/geografía/rondas. Directorio público sólo expone la proyección mínima y respeta bloqueos recíprocos.
- Reset/delete: se reutilizó implementación existente; se añadieron pruebas del handler real de Perfil, doble submit, cancelación, reintento idempotente y cambio de cuenta. No se retiraron guards para simular funcionamiento en la base compartida.

## Evidencia y límites

- **1,768/1,768 tests PASS**, cero omitidos.
- **ESLint PASS**, sin warnings. **Next build PASS** (incluye TypeScript).
- SQL real en PostgreSQL local PGlite: reset, account lifecycle, consentimientos y privacidad PASS. Incluye cuenta vacía/con datos, cutoff/histórico, rollback, RLS, shared rounds, archivo y bloqueos recíprocos.
- Chrome headless local: 390×844, 393×852, 430×932. Componentes/handlers/CSS reales; únicamente Auth metadata y guardado reemplazados por servidor loopback en memoria. No equivalen a Supabase, OAuth real, Safari iOS ni Preview.
- `Mx` → México, `Pue` inválido → seleccionar Puebla → error desaparece → guardar `MX/MX-PUE` → reload: PASS local. Backyard activation/readback/reload: PASS local.
- Home: sin engrane y geometría hero/foto/headline/pelota/logo/PLAY idéntica al HEAD inicial en los tres tamaños; sin overflow ni errores JavaScript observados.
- Artefactos locales: `.qa-artifacts/hard-closeout-{tests,lint,build}.log`, `hard-closeout-mobile-local-report.json`, `hard-profile-puebla-local-{390x844,393x852,430x932}.png`, `hard-home-local-{390x844,393x852,430x932}.png`.
- Reproducción móvil sin proveedores: `node scripts/qa-hard-closeout-browser.mjs`. Los fixtures desaparecen al cerrar el proceso; no prueban persistencia cloud.

## Aceptación solicitada

PASS visual/lógico se limita a la evidencia indicada. FAIL pendiente de Preview **no significa que falte código**, sino que no se ha acreditado el flujo real remoto exigido.

| Criterio | Estado | Evidencia / pendiente |
| --- | --- | --- |
| SETTINGS_GLOBAL_REMOVED | PASS | Código + browser local, tres tamaños |
| PROFILE_SETTINGS | PASS | Entrada Perfil preservada, tests de navegación/handlers |
| MANUAL_HCP_REMOVED | PASS | Onboarding/perfil/fitting; invitados conservan HCP de juego |
| GHIN_SOURCE | BLOCKED_EXTERNAL | Placeholder honesto; falta integración oficial autorizada |
| BACKYARD_INDEX_SOURCE | FAIL | Implementado y probado local; falta readback Supabase Preview |
| STATE_SELECTION_BUG | PASS | Reproducción y corrección real del formulario local |
| EXISTING_GOOGLE_ACCOUNT | FAIL | Mapping autenticado probado; falta login Google real en Preview |
| EXISTING_EMAIL_ACCOUNT | FAIL | OTP/mapping probado; falta ingreso email real en Preview |
| ACCOUNT_DEDUP | FAIL | Tests de ownership/UUID/races PASS; falta QA Auth real |
| PREVIEW_DB_ISOLATED | CONTROLLED_DB_ACTION_REQUIRED | Único proyecto visible compartido, cero branches |
| STATS_RESET_ZERO | FAIL | SQL/UI local PASS; no QA remoto aislado |
| STATS_RESET_DATA | FAIL | SQL/UI local PASS; no QA remoto aislado |
| ACCOUNT_DELETE | FAIL | Grafo SQL local PASS; falta Auth/Storage HTTP Preview |
| ACCOUNT_ARCHIVE | FAIL | SQL local PASS; falta Auth Preview; además LEGAL_REVIEW_REQUIRED |
| SHARED_ROUND_INTEGRITY | FAIL | Grafo compartido local PASS; no QA remoto |
| CONSENT_ONBOARDING | FAIL | Componentes + SQL PASS; requiere migración Preview y revisión legal |
| CONSENT_PERSISTENCE | FAIL | SQL versionado local PASS; falta reload/dispositivo real Preview |
| PRIVACY_PUBLIC_FRIENDS_ONLY | FAIL | UI/API/RLS local PASS; migración no aplicada a Preview |
| CONTINUE_ROUND | PASS | Label/estado/callback existentes conservados y probados |
| TESTS | PASS | 1,768 |
| LINT | PASS | Cero errores/warnings |
| BUILD | PASS | Next build + TypeScript |
| HOME_HERO_UNCHANGED | PASS | Diff y geometría comparada contra `eed282d` |

## Única autorización inmediata pendiente

Autorizar rama Supabase **`phase2-full-platform-qa`**, organización **`wrogzsycxchwakaglbpm`**, **sin datos Production**, por **US$0.01344/h** de cómputo (~US$9.68/30 días), más consumo adicional. Cotización real obtenida; no aceptada ni facturada por el agente.

Fingerprint no sensible auditado: proyecto compartido `zhqmlpljloumldaczcfp`; el bundle público del Preview anterior apunta a `https://zhqmlpljloumldaczcfp.supabase.co`. No es destino seguro para QA destructivo.

Tras autorización: crear rama, verificar nueva ref, aplicar las 15 migraciones faltantes según ledger, conectar sólo Vercel Preview de `phase2/full-platform`, ejecutar runners de QA real y publicar. El conector Vercel no ofrece escritura de variables y la CLI local no tiene sesión; si continúa así será necesario completar el acceso normal de Vercel para esa conexión, sin pedir secretos por chat.

Acciones, variables, migraciones exactas y comandos: [PREVIEW_CONTROLLED_ACTIVATION.md](PREVIEW_CONTROLLED_ACTIVATION.md). El push está autorizado pero se retiene hasta aislamiento: publicar el checkpoint de consentimientos contra la DB compartida sin migrar bloquearía el acceso y no entregaría el Preview solicitado.
