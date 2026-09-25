# DEV domain closeout

Fecha de cierre: 2026-09-24 (America/Mexico_City)

## Alcance

- Repositorio: `saidabaid-cyber/Golf-Bets`
- Rama: `integration/backyard-current`
- Proyecto Vercel: `prj_Hin0ieF71l1aSyaOcOPCmu7NzNjn`
- Team Vercel: `team_8pj0WyTTVhVSw78CAZ0qNLEO`
- SHA base y SHA funcional verificado: `cb99678ca98c58d049e557603f52d7860fdbb1d4`
- Deployment funcional verificado: `dpl_8VjxWjq6vSTCRXKLFuJ73NXHDq1x`
- Environment: Vercel Preview, rama `integration/backyard-current`
- URL principal: `https://dev.thebackyard.com.mx`
- URL técnica de respaldo: `https://golf-bets-git-integration-backyard-current-saha8.vercel.app`

No hubo cambio de código de aplicación. El único cambio operativo fue el registro DNS `dev`; este archivo es el único cambio versionado de este cierre.

## Causa raíz

Vercel ya tenía `dev.thebackyard.com.mx` agregado al proyecto y asociado a `integration/backyard-current`, pero lo reportaba como `Invalid Configuration`. El DNS autoritativo de Cloudflare respondía `NXDOMAIN` porque no existía el registro `dev`. Por esa razón no podía comenzar HTTP ni TLS desde el hostname canónico.

## DNS antes y después

Proveedor autoritativo: Cloudflare.

Nameservers observados:

- `dan.ns.cloudflare.com`
- `zelda.ns.cloudflare.com`

Antes:

- `dev.thebackyard.com.mx`: `NXDOMAIN` para CNAME, A y AAAA en ambos servidores autoritativos y en los resolvers públicos 1.1.1.1 y 8.8.8.8.
- `app.thebackyard.com.mx` y `beta.thebackyard.com.mx`: CNAME existentes y sin cambios.

Cambio aplicado exclusivamente a `dev`:

```text
Type:   CNAME
Name:   dev
Target: 44665454e1582174.vercel-dns-017.com
Proxy:  DNS only / Disabled
TTL:    Auto
```

El target fue leído directamente de la configuración del dominio en Vercel; no fue inferido.

Después:

- Ambos nameservers autoritativos, Cloudflare DNS y Google DNS resolvieron el CNAME exacto.
- La transición tuvo una ventana breve esperada: un nameserver publicó primero y ambos coincidieron antes de la validación final.
- No se modificaron nameservers ni registros `@`, `www`, `app`, `beta`, MX, SPF, DKIM o DMARC.

## Estado Vercel antes y después

Antes:

- `dev.thebackyard.com.mx`: `Invalid Configuration`.
- Asociación ya correcta: `integration/backyard-current`.

Después:

- `dev.thebackyard.com.mx`: `Valid Configuration`.
- Asociación conservada: `integration/backyard-current`.
- El deployment quedó `Ready`, en `Preview`, con el SHA funcional `cb99678ca98c58d049e557603f52d7860fdbb1d4`.
- El mismo deployment mostraba como domains el custom domain DEV, el branch alias técnico y su URL inmutable.

La configuración Preview específica de la rama fue auditada sin revelar secretos. Se confirmó:

- `PREVIEW_DB_REF=bymeopxkxapfizeeqeyb`
- `NEXT_PUBLIC_SUPABASE_URL=https://bymeopxkxapfizeeqeyb.supabase.co`
- `NEXT_PUBLIC_APP_ORIGIN=https://dev.thebackyard.com.mx`
- `GROUP_INVITES_APP_URL=https://dev.thebackyard.com.mx`
- La clave publicable y `SUPABASE_SECRET_KEY` están limitadas al Preview de `integration/backyard-current`.

## TLS

- Handshake autorizado: sí.
- Protocolo: TLS 1.3.
- Subject/SAN: `dev.thebackyard.com.mx`.
- Issuer: Let's Encrypt YR2.
- Vigencia observada: 2026-09-25 02:50:46Z a 2026-12-24 02:50:45Z.
- Sin mismatch, 525/526 ni loop de redirección.

## HTTP y assets

Validación final sin seguir redirecciones inesperadas:

| Recurso | Resultado |
| --- | --- |
| `https://dev.thebackyard.com.mx/` | `200`, sin `Location` |
| URL técnica `/` | `200`, sin `Location` |
| `https://app.thebackyard.com.mx/` | `200`, sin `Location`, contenido Production distinto |
| `https://beta.thebackyard.com.mx/` | `200`, sin `Location`, contenido beta distinto |
| DEV `/manifest.webmanifest` | `200`, `application/manifest+json` |
| Cuatro iconos declarados por el manifest | `200`, `image/png` |
| DEV `/api/features` | `200`, JSON |
| DEV `/api/health` | `200`, `environment=preview`, `buildSha=cb99678ca98c58d049e557603f52d7860fdbb1d4` |

`http://dev.thebackyard.com.mx/` respondió con un único `308` hacia `https://dev.thebackyard.com.mx/`. No hubo redirección a Production.

El cuerpo de `/`, el manifest y `/api/features` de DEV coincidieron byte por byte con el branch alias técnico. Esto confirma que el custom domain servía el deployment canónico de la rama.

## Auth y callbacks

- La landing DEV cargó correctamente.
- El acceso invitado llegó al consentimiento inicial manteniendo el hostname DEV; no se aceptaron términos ni se creó perfil.
- El formulario de correo cargó hasta el punto anterior al envío; no se envió email ni se usaron datos reales.
- `/api/features` reportó `authProviders.status=ready`, `email=true`, `google=true` y `apple=false`.
- El inicio de Google con selector de cuenta llegó a Google sin seleccionar ninguna cuenta.
- Callback solicitado observado: `https://dev.thebackyard.com.mx/auth/callback`.
- Redirect URI del provider observado: `https://bymeopxkxapfizeeqeyb.supabase.co/auth/v1/callback`.
- No se observó callback a Production ni a un hostname aleatorio.
- No se requiere un ajuste externo nuevo para el dominio DEV conforme a esta prueba de inicio de OAuth. La autenticación completa no se ejecutó porque el alcance exigía no usar datos reales de usuarios.

## Producción y beta

- `app.thebackyard.com.mx`: no modificado; Vercel continuó mostrando `Valid Configuration` y `Production`; HTTP `200`.
- `beta.thebackyard.com.mx`: no modificado; Vercel continuó mostrando `Valid Configuration` y `codex-dev`; HTTP `200`.
- No se promovió ningún deployment a Production.
- No se modificaron `main`, Supabase, Auth data, usuarios ni lógica funcional.

## Bloqueos externos

Ninguno para el dominio DEV. DNS, TLS, Vercel, HTTP y el inicio de callbacks OAuth quedaron operativos.

## Resultado

`PASS`: `https://dev.thebackyard.com.mx` es la URL estable de revisión de `integration/backyard-current`; la URL técnica permanece como respaldo.
