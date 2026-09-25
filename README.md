# The Backyard

Aplicación móvil para registrar rondas privadas, apuestas de golf e histórico local. V3 agrega Reglas de Golf, “Cómo vamos”, exportación y la base segura de Polla Live para torneos grandes.

## Fuente canónica

La única fuente de verdad vigente es la rama `integration/backyard-current`. El único origen previsto para QA de owner es `https://dev.thebackyard.com.mx`; esta mención define el destino estable, pero **no acredita que el deployment o el dominio ya estén activos**. El estado verificado se registra en el [manifiesto de consolidación](docs/CONSOLIDATION_MANIFEST_2026-09-24.md), el [estado canónico del producto](docs/CANONICAL_PRODUCT_STATUS_2026-09-24.md) y el [ledger canónico de migraciones](docs/CANONICAL_MIGRATION_LEDGER_2026-09-24.md).

Las ramas históricas y sus URLs Preview no son destinos de revisión. Production, `main` y `https://app.thebackyard.com.mx` permanecen fuera del alcance de esta línea de trabajo.

## Desarrollo local

```bash
pnpm install
pnpm dev
```

Gate local canónico:

```bash
pnpm lint
pnpm test
pnpm typecheck
pnpm build
pnpm run audit:assets
git diff --check
```

La ronda privada funciona sin cuentas, OpenAI ni Supabase. Copia `.env.example` a `.env.local` solo para habilitar módulos opcionales.

## Datos y compatibilidad

- Se conservan las claves históricas `golfbets-courses`, `golfbets-history`, `golfbets-personal-rivals` y `golfbets-draft-v1`.
- Los borradores V2.x migran presiones cronológicas a H1–9/H10–18 al cargarse.
- Cada ronda terminada guarda snapshot de campo, jugadores y scores para que futuras ediciones no alteren el histórico.
- Card AI comprime y analiza las fotos en memoria. La copia local en IndexedDB es best effort: si el navegador la rechaza, el análisis puede continuar.

Consulta [configuración de Supabase](docs/SETUP_SUPABASE.md), [Reglas con IA](docs/SETUP_RULES_AI.md) y [alcance técnico V3](docs/V3_ARCHITECTURE.md).
