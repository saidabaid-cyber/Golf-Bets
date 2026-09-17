# Perfil completado v1

Porcentaje = redondear(100 × secciones completas / 7). Se deriva en servidor; no se guarda un porcentaje del dispositivo.

1. Datos personales: nombre visible, nombre y apellidos guardados.
2. Usuario: username guardado.
3. Golf: mano y club habitual o tee habitual; admite declaración explícita «No aplica».
4. Fuente de hándicap: Backyard Index activado (sin exigir rondas), HCP manual declarado o «No tengo hándicap». Manual no modifica ningún índice oficial/local.
5. Equipo: un bastón guardado o «No aplica» explícito.
6. Bola: bola actual, «sin bola fija» explícito o «No aplica».
7. Fitting: fitting guardado o «No aplica» explícito.

Cada dato cuenta una sola vez. Saltar no cuenta como completar. No exige GHIN, avatar, permisos opcionales, marketing o perfil público. No bloquea jugar.
Perfil/metadata autenticada, snapshot canónico de equipo y decisiones owner-only en `profile_completion_choices` son las fuentes. La consulta se repite al abrir el perfil; otra sesión recupera los mismos datos.
