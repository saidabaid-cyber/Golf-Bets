# Perfil: avatar y ubicación

## Avatar canónico

`BackyardProfile.avatarUrl` / `profiles.avatar_url` sigue siendo la única
selección persistida: emoji Unicode completo, imagen optimizada o cadena vacía
(Sin imagen). No se guarda otra selección en cada pantalla. `ProfileAvatarMedia`
y los consumidores existentes interpretan el mismo valor; Home no cambia.
`profileAvatarType` expone photo, emoji, generated_avatar y none. Generated
queda reservado para un proveedor futuro, no para una simulación.

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

Crear avatar muestra Próximamente: `BLOCKED_EXTERNAL_IMAGE_PROVIDER`.
No se envían descripciones ni fotos a un generador desconectado.

## País / estado

Onboarding y editores reutilizan `ProfileLocationPicker`: 249 países ISO,
etiquetas españolas, subdivisiones locales MX/US/CA; región manual normalizada
para países aún sin subdivisiones locales. No utiliza GPS ni API de países.
Cambiar país limpia código y nombre de región. La procedencia y licencia están
en `lib/PROFILE_GEOGRAPHY_SOURCES.md`.

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
