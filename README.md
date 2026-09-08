# Golf Bets V3

Aplicación móvil para registrar rondas privadas, apuestas de golf e histórico local. V3 agrega Reglas de Golf, “Cómo vamos”, exportación y la base segura de Polla Live para torneos grandes.

## Desarrollo local

```bash
pnpm install
pnpm dev
```

Validación completa:

```bash
pnpm lint
pnpm test
pnpm build
```

La ronda privada funciona sin cuentas, OpenAI ni Supabase. Copia `.env.example` a `.env.local` solo para habilitar módulos opcionales.

## Datos y compatibilidad

- Se conservan las claves históricas `golfbets-courses`, `golfbets-history`, `golfbets-personal-rivals` y `golfbets-draft-v1`.
- Los borradores V2.x migran presiones cronológicas a H1–9/H10–18 al cargarse.
- Cada ronda terminada guarda snapshot de campo, jugadores y scores para que futuras ediciones no alteren el histórico.
- Card AI comprime y analiza las fotos en memoria. La copia local en IndexedDB es best effort: si el navegador la rechaza, el análisis puede continuar.

Consulta [configuración de Supabase](docs/SETUP_SUPABASE.md), [Reglas con IA](docs/SETUP_RULES_AI.md) y [alcance técnico V3](docs/V3_ARCHITECTURE.md).
