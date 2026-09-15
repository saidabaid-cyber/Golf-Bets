# Perfil: avatar y ubicación

## Avatar canónico

`BackyardProfile.avatarUrl` / `profiles.avatar_url` sigue siendo la única
selección persistida: emoji Unicode completo, imagen optimizada o cadena vacía
(Sin imagen). No se guarda otra selección en cada pantalla. `ProfileAvatarMedia`
y los consumidores existentes interpretan el mismo valor; Home no cambia.
`profileAvatarType` expone photo, emoji, generated_avatar y none. El tipo generado
se recupera desde el path inmutable de Storage `generated-avatar/<usuario>/<asset>`
tras reload; ese marcador es sólo presentación, nunca autorización.

Una foto se valida por MIME y firma, se decodifica con orientación EXIF, se
recorta al centro sin deformar y se comprime a 512×512 (320×320 en Grupos).
Se admiten originales de hasta 20 MiB; el resultado cabe en el límite existente
de 180,000 caracteres de avatar. HEIC/HEIF sólo funciona si el navegador puede
decodificarlo; de lo contrario se pide JPEG/PNG/WebP explícitamente.

La proyección `social_profiles.avatar_url`, cuando existe, se actualiza sólo
después de guardar el perfil. No crea identidades sociales ni cambia privacidad.
Errores de permisos o escrituras no confirmadas mantienen la cola pendiente.
Una tabla Social ausente se distingue como `unavailable`: no bloquea el
guardado canónico del perfil. La consulta read-only del entorno actual confirmó
que `social_profiles` todavía no existe; propagación Social = BLOCKED_EXTERNAL
hasta su habilitación controlada, sin aplicar esa migración en esta tarea.
Las pantallas
sociales que mantienen snapshots locales de otros jugadores todavía dependen
de su refresco social habitual, no se reescribe el histórico.

Crear avatar ofrece descripción o foto voluntaria, cuatro estilos y autorización
explícita. Reutiliza OpenAI server-side y el ledger de consentimiento existente:
si guardar/verificar consentimiento falla no hay llamada al proveedor. Generar
no publica ni guarda imagen; la previsualización y una prueba firmada quedan en
memoria. `USAR ESTE AVATAR` verifica usuario/hash/caducidad antes de guardar la
salida optimizada en un bucket separado. Se avisa que el asset elegido es
accesible por URL. `Guardar perfil` confirma la selección canónica igual que
Foto/Emoji. Cancelar antes de Usar no escribe Storage; abandonar el editor después
de Usar puede dejar un asset no referenciado. No hay limpieza automática de esos
objetos ni se borran objetos compartidos en este cambio.

La UI consulta readiness real: muestra `BLOCKED_EXTERNAL_IMAGE_PROVIDER` con
explicación cuando faltan configuración/proveedor/storage, no Próximamente ni
una generación simulada. El resto del perfil funciona independientemente.

## País / estado

Onboarding y editores reutilizan `ProfileLocationPicker`: 249 países ISO,
etiquetas españolas, subdivisiones locales MX/US/CA; región manual normalizada
para países aún sin subdivisiones locales. No utiliza GPS ni API de países.
Cambiar país limpia código y nombre de región. La procedencia y licencia están
en `lib/PROFILE_GEOGRAPHY_SOURCES.md`.

Bug reproducido en WebKit táctil: al tocar México después de escribir `Mx`,
`focusout.relatedTarget` era null y el blur desmontaba el dropdown antes de
`onClick`. El matcher ISO sí encontraba México. Además la lista absoluta podía
quedar fuera del viewport al abrir el teclado. La corrección pertenece al picker
de perfil; no cambia el buscador compartido de otras pantallas ni Home.

Se conserva el cache existente. Para cuentas autenticadas, los cuatro campos
geográficos se replican en metadata **privada/descriptiva** de Auth bajo
`backyard_profile_location` (versión y fecha propia); no contienen avatar,
tokens, consentimiento ni decisiones de autorización. `getUser()` verifica
ownership y la respuesta del guardado debe confirmar los valores. No requiere
migración ni expone automáticamente país/estado en Social.

Ubicación tiene un reloj distinto de avatar/HCP. Una edición de foto no renueva
una ubicación antigua pendiente. Los reintentos serializados releen la cola
para no duplicar escrituras capturadas por USER_UPDATED. Auth metadata no
ofrece compare-and-swap atómico: conflictos observados se rechazan, pero no se
promete atomicidad entre dos dispositivos que escriban simultáneamente.

## Verificación y límites

Las pruebas cubren Unicode, compresión/crop/EXIF, cache/reload, cambios de modo,
ubicación dependiente, ownership, cola/reintentos y proyección Social usando
dobles de protocolo. QA navegador local utiliza los componentes reales y
almacenamiento local aislado, no una sesión ni RLS de producción.

Para certificar persistencia cloud end-to-end hace falta una sesión de pruebas
en un entorno aislado autorizado. No se escriben datos de QA en la base
compartida con Production ni se acepta consentimiento legal por el owner.

## Activación controlada de avatar IA

Código completo hasta el boundary de configuración; no habilitado contra
Supabase compartido. Proveedor esperado: OpenAI Images, mediante el SDK
OpenAI existente y sólo desde las rutas de servidor de este cambio.

En Vercel → proyecto `golf-bets` → Settings → Environment Variables,
configurar **Preview / branch `phase2/full-platform` únicamente**:

- `BACKYARD_AVATAR_GENERATION_ENABLED=true`.
- `OPENAI_API_KEY`: credencial con acceso a imágenes.
- `OPENAI_AVATAR_IMAGE_MODEL`: modelo GPT Image explícito, por ejemplo
  `gpt-image-1.5`; no se elige ni se cobra un modelo silenciosamente.
- `BACKYARD_AVATAR_SIGNING_SECRET`: secreto criptográfico de al menos 32 bytes.
- `BACKYARD_AVATAR_STORAGE_BUCKET`: bucket público separado para estos assets.
- `NEXT_PUBLIC_SUPABASE_URL`, su publishable/anon key y la secret/service role
  key: **del proyecto aislado de pruebas**, no del compartido con Production.
- `BACKYARD_AVATAR_PREVIEW_SUPABASE_URL` y
  `BACKYARD_AI_CONSENT_PREVIEW_SUPABASE_URL`: ambos deben coincidir exactamente
  con esa URL aislada. No establecerlos a la URL compartida para saltar el gate.
- `CLOUD_ENABLED` no puede estar desactivado; `VERCEL_ENV=preview` lo establece
  Vercel para el despliegue Preview.

El proyecto aislado también necesita el ledger `ai_processing_consents`,
la RPC existente `consume_rules_ai_rate_limit`, una cuenta QA y el bucket
declarado, confirmado como público. GET `/api/profile/avatar` informa las
variables faltantes sin llamar a OpenAI ni escribir Storage. No realiza una
generación de prueba ni garantiza acceso comercial al modelo: esa validación
se hace al generar, con errores de configuración/timeouts/límites explícitos.

Rutas listas: GET `/api/profile/avatar`, POST
`/api/profile/avatar/generate` y POST `/api/profile/avatar/use`. La segunda
devuelve imagen optimizada y prueba firmada; la tercera verifica firma,
usuario, bytes y consentimiento vigente antes de subir. Un reintento de subida
incierta sólo acepta un objeto ya existente si sus bytes/hash coinciden;
nunca sobrescribe otro asset. Ni una URL construida ni un userId del cliente
se aceptan como prueba de propiedad.

**Retención pendiente antes de activar eliminación de cuenta:** la rutina
actual de eliminación sigue bloqueada por apply controlado y sólo contempla
`scorecard-photos`. Debe integrar la limpieza paginada y por owner del prefijo
`generated-avatar/<auth-user-id>/` del bucket nuevo antes de quitar ese bloqueo.
Un fallo de listado/borrado debe impedir continuar con la eliminación de Auth.
También falta una política controlada para assets subidos al pulsar Usar y
abandonados antes de Guardar perfil. Este cambio no habilita eliminación de
cuenta ni aplica migraciones ni crea buckets.

QA de esta corrección: WebKit 26.6 en Windows con mobile/touch, no Safari en
un iPhone físico. El bug original de tap se reprodujo antes de corregirlo.
Se verifica tap/teclado, selección y reset en 390×844, 393×852 y 430×932;
390×500 aproxima la reducción de viewport por teclado, no simula el teclado
nativo completo. Las capturas locales están rotuladas como harness. Las rutas
simuladas del creador prueban UI, cancelación y protocolo, no generación pagada
ni RLS/persistencia cloud real. No se declara Perfil cerrado end-to-end sin
esa última validación en el entorno aislado.
