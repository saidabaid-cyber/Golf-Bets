# Perfil, navegación de ronda e Índice Backyard — 2026-09-15

## Alcance y seguridad

- Rama exclusiva: `phase2/full-platform`.
- HEAD inicial: `0881942dd48c144aa61be9206ba53e0aa6f0fc59`; árbol limpio al comenzar.
- Sin merge, force push, cambios de Production ni escrituras sobre la base compartida.
- Home sigue `VISUAL_APPROVED / NO TOUCH`. Sus componentes, CSS y assets no cambian. La única ampliación de navegación compartida autorizada es JUGAR entre Social y Más cuando hay ronda activa; sin ronda siguen cuatro destinos.
- País/Región, Foto/Emoji, motores de apuestas y consentimiento de Backyard AI se conservan.

## Implementación

### Avatar manual

Editor original de capas SVG locales, sin IA, red, key ni costo. Persona, rostro, piel, pelo/color, ojos, cejas, nariz, boca, barba/color y accesorios; preview instantáneo, aleatorio local, cancelar y guardar con manejo de fallo.

Fuente canónica: `profiles.avatar_url` y el avatar de la identidad existente. El SVG `custom_avatar` incorpora configuración JSON versionada y validada; se reconstruye exactamente para aceptar sólo nuestras capas, no SVG arbitrario. No es una captura raster ni una segunda identidad. Las fotos HTTPS anteriores siguen como fotos. Se retiraron tres endpoints de avatar IA, módulos exclusivos, variables de imagen y dependencia directa de sharp. No se retiró OpenAI de otros flujos existentes.

El editor espera el guardado real del proveedor de perfil; si éste confirma sólo local, se informa sincronización pendiente. La prueba del editor aislado demuestra localStorage/reload, no escritura cloud real. Ver `PROFILE_AVATAR_LOCATION.md`.

### Reset de estadísticas

Causa comprobada mediante lectura del esquema: faltan tabla/RPC de reset y dependencias de auditoría en la base conectada. No era solamente un botón deshabilitado. La ruta ahora distingue esquema ausente, timeout y confirmación; nunca interpreta un fallo GET como ausencia de reset.

El reset usa sesión server-side, `auth.uid()`, ELIMINAR exacto, UUID idempotente y transacción con auditoría. Reintentar después de timeout usa la misma solicitud. Doble submit bloqueado; fallo inline, éxito cierra modal. Cambio de identidad no aplica respuestas de otro usuario.

Estrategia `RESET_FROM_DATE`: conserva rondas, apuestas, balances y grupos. Sólo rondas terminadas después de la frontera alimentan nuevas estadísticas. Corregir un histórico conserva su fecha deportiva original: `updatedAt` no permite que reaparezca en Stats. Durante fallo de lectura autoritativa se ocultan métricas deportivas, no el Histórico.

**PENDING_CONTROLLED_DB_APPLY**: preparar DB Preview aislada y revisar/aplicar dependencias en orden, incluyendo `202609100004_phase2_shots_analytics.sql`, `20260913205122_user_statistics_reset.sql` y `20260915114707_user_statistics_reset_idempotency.sql`. No aplicar sólo el último archivo a una DB incompleta. La nueva migración revoca escritura directa/antiguo RPC y deja el RPC idempotente como único escritor. No se aplicó ninguna migración remota.

### Cuenta: eliminar o conservar

La elección es explícita y distinta del reset. Se persisten política e idempotency key antes del marcador que pausa sincronización. La recuperación verifica el mismo propietario; no inventa elección para marcadores legados. Marcadores sin elección verificable requieren `PENDING_MANUAL_ACCOUNT_RECOVERY` por soporte, no borrado automático.

**LEGAL_REVIEW_REQUIRED / PENDING_CONTROLLED_DB_APPLY**: no está implementada una desactivación recuperable segura ni certificado un grafo irreversible completo. Por ello ambas rutas fallan antes de mutaciones, con explicación visible; no devuelven éxito ficticio. Se necesita:

1. Política aprobada de retención, alcance y recuperación de identidad.
2. Ledger/transacción de archivo o eliminación, incluyendo las tablas nuevas y storage, sobre DB aislada.
3. Revocación de sesiones y control de acceso archivado en RLS y rutas con service role; un ban no invalida por sí solo JWT ya emitidos.
4. Prueba de identidad renovada y restauración segura, sin prometer conservación indefinida.

Los textos explicativos requieren revisión legal. La cuenta actual no se desactiva ni borra al recibir este bloqueo.

### Navegación

Avatar superior: botón accesible de 44 px hacia raíz de Perfil, incluso desde Editar perfil. JUGAR usa el workspace hidratado del usuario y hechos de ronda: inicio durable/captura, campo, participantes, sin cierre/revisión/histórico. Una marca local de navegación no activa un draft. Contexto jugador/tab/hoyo se guarda por usuario/ronda y se valida al recuperar; los scores y apuestas siguen en el draft local/cloud existente. Un draft completado recibido del cloud queda en revisión, no se revive ni se descarta antes de guardar histórico.

### Backyard Index

Motor privado no oficial separado de HCP de juego/GHIN. Differential con score ajustado, Rating, Slope, PCC y snapshot de tee acreditado. Tabla progresiva 3–19 y mejores 8 de los últimos 20; no promedio de scores brutos. Se guarda evidencia por ronda/usuario, sin recalcular desde catálogo mutable. Rondas sin evidencia suficiente quedan NO ELEGIBLE; no se fabrican datos. No hay proveedor acreditado de Rating/PCC conectado en este bloque. Opt-in privado guardado por cuenta en este dispositivo. Ver `BACKYARD_INDEX.md` para reglas verificadas y límites (no certificación WHS, caps ni equivalentes de 9 hoyos).

## Verificación y límites

- Suite Node/TypeScript: **1571/1571 PASS**. ESLint: **PASS**. Next.js 16.3.3 production build: **PASS** (sin rutas de generación de avatar).
- SQL real con PostgreSQL WASM/PGlite aislado: migración/reaplicación, confirmación exacta, permisos/RLS con dos usuarios simulados, idempotencia, monotonicidad y rollback de auditoría. No sustituye concurrencia real multi-conexión ni QA de Supabase Auth.
- Browser Chromium a 390x844, 393x852 y 430x932 con componentes reales en harness aislado. Avatar: rasgos, swatches, fallo/reintento, guardar y reload; sin overflow. Perfil/reset: handler real con transporte local de prueba, no backend compartido; error conserva modal y reintento usa mismo UUID.
- No se aceptaron términos ni consentimientos por el usuario. El acceso a perfil real queda detrás del gate de autenticación/consentimiento. No se presenta harness como screenshot de Preview autenticado ni Chromium como Safari físico.
- Pendiente: QA autenticada Preview con cuenta y DB aisladas; propagación avatar a cloud/Social (proyección social ausente en esquema compartido); cerrar/reset/recuperar ronda tras cierre PWA con cloud real; Safari físico y safe-area de hardware.

No existe PASS global de cierre mientras estos bloqueos y verificaciones pendientes continúen.
