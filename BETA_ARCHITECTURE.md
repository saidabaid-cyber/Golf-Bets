# The Backyard Beta — arquitectura

Estado documentado: 2026-09-06. Rama de trabajo: `beta`.

## Límites de entorno

- `main`, el tag estable y `https://app.thebackyard.com.mx` son producción y quedan fuera del alcance de escritura.
- Todo cambio de esta iteración vive en `beta`. Su despliegue debe ser Preview/Beta; nunca debe promoverse a Production.
- El único proyecto Supabase encontrado es `zhqmlpljloumldaczcfp` (`The Backyard`) y no tiene branches de base de datos. Por tanto puede contener datos de producción y no es un destino seguro para DDL de Beta.
- No se aplicarán migraciones ni cambios de variables Production hasta disponer de una base/branch Beta aislada y verificar explícitamente su referencia.

## Aplicación actual

The Backyard usa Next.js 16 App Router, React 19 y TypeScript. La experiencia privada principal es una SPA cliente en `app/page.tsx`, separada en componentes para cuenta, grupos, scorecard, apuestas, resultados, reglas y Polla Live. La navegación interna se modela como estados de pantalla y conserva integración con el historial del navegador.

Los Route Handlers bajo `app/api` atienden cuenta, sincronización cloud, reglas y la infraestructura de Polla Live. La lógica determinística de HCP, apuestas y liquidación vive en `lib`; la IA de reglas está separada de esos cálculos y no puede cambiar scores ni balances.

## Identidad y autorización

- La app funciona en modo invitado sin Supabase.
- Cuando Supabase está configurado, admite sesión persistente, email OTP y Google si el proveedor está habilitado.
- El navegador usa únicamente la llave pública `anon`/`publishable`.
- La service role se limita a código de servidor y no debe exponerse con prefijo `NEXT_PUBLIC_`.
- Las APIs cloud validan el usuario y las rutas de Polla validan sesión/rol o acceso invitado antes de operaciones privilegiadas.
- Los consentimientos legales y de datos de apuestas se conservan; el texto del Aviso de Privacidad no se modifica en esta iteración.

## Ronda privada y persistencia

`RoundSnapshot` es el snapshot histórico persistido y versionado de una ronda cerrada. Incluye campo, jugadores, HCP usado, scores, estadísticas opcionales, configuración y resultados de apuestas, gastos, balances, eventos, lifecycle y metadatos de cierre. Puede actualizarse deliberadamente mediante el flujo de edición histórica conservando el mismo ID; el catálogo editable nunca altera por sí solo su `courseSnapshot`.

La persistencia es local-first:

1. `localStorage` mantiene compatibilidad y acceso inmediato a borrador, histórico, campos, jugadores frecuentes, grupos frecuentes, rivales y preferencias.
2. IndexedDB guarda una copia durable por identidad y una outbox idempotente.
3. Si IndexedDB falla, se usa un fallback verificado en `localStorage`.
4. Al reconectar, la cola reintenta con espera exponencial acotada.
5. La nube confirma el fingerprint exacto antes de retirar una mutación pendiente.
6. La sincronización usa timestamps, compare-and-swap, tombstones y conflictos explícitos para evitar sobrescrituras silenciosas o resurrección de datos borrados.

Los “grupos” actuales son plantillas locales/frecuentes de jugadores. Todavía no equivalen a grupos sociales persistentes con admin, membresías e invitaciones.

## Validación y liquidación determinística

`lib/bet-config-validation.ts` centraliza la validación fail-closed de apuestas activas. Setup, restauración de drafts, inicio de ronda y liquidación comparten los mismos invariantes para participantes, equipos, rivales, bases HCP, valores finitos, carry y press. Una configuración legacy inválida se conserva para poder repararla, pero no se ejecuta silenciosamente.

El motor sigue siendo determinístico y separado de IA. Balances usa resultados históricos persistidos como ledger derivado: no muta snapshots, no acepta edición arbitraria, no registra pagos y no afirma que una sugerencia de liquidación sea una deuda pagada. Los invitados usan identidad acotada a la ronda; las cuentas estables requieren un ID persistido no ambiguo.

La Scorecard calcula una vista previa de neto a HCP de ronda al 100% exclusivamente para contexto de golf. Acepta HCP cero, plus y ciclos adicionales por encima de 18; si falta HCP o score no fabrica un neto. Este helper no entra al motor de apuestas: cada modalidad conserva su propia base y porcentaje.

`lifecycleState` añade `draft`, `live`, `completed` y `cancelled` de forma compatible. Las rondas legacy sin estado se leen como `completed` sin migración destructiva. La captura avanzada es opcional: `scoreCaptureMode` y `advancedStats` se persisten con la ronda, pero nunca alimentan el motor de apuestas.

El perfil ampliado normaliza username, ubicación, club, tee, mano, bio y visibilidad en la caché local por identidad. Nombre, HCP y avatar conservan el write cloud existente; los campos nuevos no se presentan como sincronizados hasta contar con columnas y RLS en una base Beta aislada.

Perfil y Cuenta son vistas distintas. Sólo una sesión autenticada puede editar la identidad persistente; un workspace invitado conserva rondas y estadísticas locales, pero no se etiqueta como cuenta ni perfil sincronizable. Los errores de formulario/guardado usan estados accesibles separados del éxito.

Social y notificaciones son actualmente una proyección privada de actividad local. El estado leído se guarda por identidad en el dispositivo, deduplica eventos exactos y no crea una relación social remota. Los avisos compartidos seguirán bloqueados hasta disponer de tablas, RLS y pruebas multiusuario en Beta.

## Supabase existente

Las migraciones ya versionadas en `supabase/migrations` cubren, entre otras entidades:

- perfiles, preferencias, aceptaciones legales y migración de cuenta;
- snapshots cloud de rondas, jugadores, scores, campos, grupos frecuentes y rivales;
- configuración/resultados de apuestas, gastos, campo y reglas locales por ronda;
- tombstones, estado de nube y fotos privadas de scorecard;
- infraestructura de torneos/Polla Live, acceso, grupos, miembros, scores, auditoría, premios, Oyes e invitaciones;
- rate limiting persistente para IA de reglas.

Las tablas expuestas cuentan con RLS en las migraciones y políticas basadas en `auth.uid()` o propiedad indirecta. Funciones privilegiadas tienen grants explícitos. Antes de ampliar el modelo deben verificarse tanto grants como RLS en una base Beta aislada y ejecutar pruebas de dos usuarios/roles y los advisors de seguridad y rendimiento.

La inspección read-only del proyecto alojado encontró drift y riesgos que deben corregirse primero en una base aislada, nunca directamente sobre el proyecto compartido:

- privilegios predeterminados y ACL históricos más amplios que los contratos actuales de las migraciones;
- una función `is_polla_admin` con `SECURITY DEFINER` que requiere revisar su superficie de ejecución;
- relaciones de Polla cuya pertenencia al mismo torneo no está reforzada en todos los casos mediante claves compuestas;
- canales Realtime que publican filas más amplias que la señal/leaderboard sanitizado descrito por el código actual;
- un bucket temporal de marketing con capacidad de carga pública que requiere confirmar necesidad y límites;
- `profiles` limitado al propio usuario, por lo que una búsqueda de amigos no debe abrir la tabla completa: necesita una proyección pública mínima y autorizada;
- restricciones de consentimientos legales distintas entre esquema vivo y migraciones versionadas;
- protección de contraseñas filtradas deshabilitada en Auth.

Estas observaciones no implicaron DDL ni cambios de configuración. El orden seguro es: capturar baseline/drift, cerrar ACL/grants, probar RLS con dos usuarios y sólo después añadir perfiles públicos mínimos, amistades, grupos y permisos de ronda.

No se creó ni aplicó una migración durante este milestone. Amistades, grupos sociales, feed compartido, notificaciones, participación multi-dispositivo y administración ampliada requieren un diseño aditivo y pruebas RLS en una base Beta separada.

## Proveedores de golf

`lib/golf-providers.ts` define contratos tipados para:

- `CourseDataProvider`
- `HandicapProvider`
- `GolfProfileProvider`
- `GolfMapProvider`
- `DistanceProvider`

El único proveedor concreto es `internalCourseDataProvider`: busca, sin red, únicamente sobre los objetos `Course[]` que la app ya posee. No crea campos, tees, yardas ni coordenadas. Los contratos externos no implican una integración activa, licencia, autorización ni exactitud oficial.

`lib/course-catalog.ts` construye un read model provider-neutral que separa Course, Tee, Hole y yardaje por tee sin reescribir drafts o históricos legacy. Sólo proyecta registros con ID/nombre/tee, 9 o 18 hoyos completos, Par válido y SI único; metadatos opcionales inválidos se omiten y se auditan como warnings. Persistir esas entidades en tablas normalizadas queda bloqueado hasta disponer de una base Beta aislada.

La UI debe distinguir siempre el HCP manual/de juego de cualquier índice oficial. Una futura integración solo podrá etiquetarse como oficial si el proveedor y la autorización correspondientes lo permiten.

## PWA y offline

La app ya dispone de manifest, iconos normales/maskable, Apple touch icon, modo standalone y service worker. El worker precachea el shell/activos estáticos, evita cachear APIs y usa navegación network-first con fallback local. La durabilidad de score depende del flujo local-first, no de cachear respuestas privadas.

El store offline lee tanto IndexedDB como el fallback verificado en `localStorage` y selecciona el snapshot/outbox más reciente. Un watermark de ACK más compare-and-swap transaccional impide que respuestas o reintentos antiguos eliminen una mutación nueva; un guardado local-only nunca borra por accidente una cola cloud pendiente.

## Feature flags

Flags de servidor existentes:

- `CLOUD_ENABLED`
- `POLLA_LIVE_ENABLED`
- `AUTH_SOCIAL_ENABLED`
- `RULES_AI_ENABLED`

Polla Live debe permanecer visible solo como “Próximamente” y deshabilitado en esta iteración. `POLLA_LIVE_ENABLED` falla cerrado: únicamente los valores normalizados `1`, `true`, `on` y `yes` habilitan el backend; ausente, vacío, falso o desconocido impide instanciar también el cliente con service role. GPS, integraciones de campos/HCP/perfil, pagos, suscripciones y módulos incompletos deben quedar ocultos o protegidos por flags; no deben generar botones muertos.

## Flujo de despliegue seguro

1. Confirmar `git branch --show-current` = `beta`.
2. Ejecutar lint, typecheck/pruebas y build.
3. Crear commits pequeños de milestone en `beta`.
4. Hacer push solo a `origin/beta` para obtener Preview.
5. Verificar que la URL Preview esté READY, responda 200 y corresponda al SHA de `origin/beta`.
6. Confirmar por metadata Git/deployment que `main`, el tag estable y Production no cambiaron, sin navegar ni modificar producción.

Nunca usar merge a `main`, despliegue `--prod`, promoción de deployment ni variables Production para cerrar un milestone Beta.
