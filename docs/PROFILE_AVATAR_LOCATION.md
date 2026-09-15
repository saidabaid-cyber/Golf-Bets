# Perfil: avatar y ubicación

## Avatar canónico

`BackyardProfile.avatarUrl` / `profiles.avatar_url` sigue siendo la única
selección persistida: emoji Unicode completo, imagen optimizada o cadena vacía
(Sin imagen). No se guarda otra selección en cada pantalla. `ProfileAvatarMedia`
y los consumidores existentes interpretan el mismo valor; Home no cambia.
`profileAvatarType` expone `photo`, `emoji`, `custom_avatar` y `none`. Los assets
HTTPS de generación anterior continúan siendo válidos como fotos legadas; no
se borran ni se intentan recrear.

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

Crear avatar es un editor original de capas SVG locales. Permite editar persona,
rostro, piel, pelo/color, ojos/color, cejas, nariz, boca, barba y accesorios;
piel, pelo y ojos tienen swatches táctiles. La vista previa cambia al instante,
Aleatorio produce otra combinación y Cancelar deja intacto el avatar canónico.
No usa proveedor de imagen, GPS, foto de referencia, consentimiento IA, Storage
ni rutas `/api/profile/avatar/*`.

El valor `custom_avatar` es un `data:image/svg+xml;base64,...` con configuración
JSON estructurada `version: 1` dentro de `<metadata>`. El parser recupera esa
configuración al reabrir el editor. Antes de aceptar un SVG en perfil/cache/cloud
se exige igualdad **exacta** con la salida del renderer determinístico para
esa configuración enumerada. SVG arbitrario, scripts, links, `foreignObject` y
opciones desconocidas no pasan; no hay migración de DB ni segunda fuente de
avatar. El valor se dibuja mediante el componente de medios compartido, sin
modificar el layout de Home ni los snapshots históricos.

En Editar perfil, `GUARDAR AVATAR` utiliza el callback de guardado del perfil:
espera confirmación antes de cambiar el valor seleccionado; si falla conserva
todos los rasgos para reintentar y no cierra el editor. En onboarding, donde
todavía no existe un perfil completo, el mismo botón deja el avatar listo en
el draft y se persiste al completar el perfil. Un avatar ya guardado no abre el
editor automáticamente al recargar; se toca Editar rasgos para reabrirlo.

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

## Dependencias y límites del avatar manual

No requiere modelo, credencial de imágenes, bucket nuevo ni activación en
Vercel. El SDK OpenAI permanece en el repositorio por otras funciones de IA,
pero no participa en este editor. La eliminación de cuenta y la limpieza de
assets legados siguen siendo tareas separadas; este cambio no escribe Storage,
no borra objetos compartidos y no aplica migraciones.

QA de esta corrección: WebKit 26.6 en Windows con mobile/touch, no Safari en
un iPhone físico. El bug original de tap se reprodujo antes de corregirlo.
Se verifica tap/teclado, selección y reset en 390×844, 393×852 y 430×932;
390×500 aproxima la reducción de viewport por teclado, no simula el teclado
nativo completo. Las capturas locales están rotuladas como harness. El harness
del avatar manual importa picker y renderer reales, pero su botón Guardar local
sólo escribe `localStorage` de loopback: no prueba Auth, RLS ni persistencia
cloud autenticada real. No se declara Perfil cerrado end-to-end sin una sesión
de QA autorizada en un entorno aislado.
