# Configurar Reglas de Golf con IA

El buscador curado funciona siempre. `/api/rules/ask` recupera evidencia del índice local versionado y entrega únicamente esos fragmentos al proveedor seleccionado. La generación no puede responder de memoria cuando la recuperación no encuentra fundamento suficiente.

## Gemini (proveedor predeterminado)

Crea una clave en Google AI Studio y configura estas variables server-side:

```dotenv
RULES_AI_PROVIDER=gemini
GEMINI_API_KEY=...
GEMINI_RULES_MODEL=gemini-3.5-flash-lite
RULES_AI_ENABLED=true
```

No uses el prefijo `NEXT_PUBLIC_` para la clave. En Vercel, cualquier activación de esta línea debe limitarse al entorno **Preview** de `integration/backyard-current`, con variables restringidas a esa rama y origen `https://dev.thebackyard.com.mx`. Un push de la rama por Git Integration genera el Preview que deberá verificarse; este documento no acredita que ya exista ni que la IA esté habilitada. No agregues estas variables a Production ni despliegues `main` siguiendo esta guía.

## OpenAI (alternativa opcional)

La misma recuperación local puede usar OpenAI sin depender de `file_search`:

```dotenv
RULES_AI_PROVIDER=openai
OPENAI_API_KEY=...
OPENAI_RULES_MODEL=gpt-5.4-mini
RULES_AI_ENABLED=true
```

`OPENAI_RULES_VECTOR_STORE_ID` ya no es requisito del endpoint. Se conserva únicamente para el script heredado `pnpm rules:index`; los PDFs privados permanecen fuera del repositorio en `rules-source/` o `rules-sources/`.

La API key activa jamás se entrega al cliente ni se registra. Si falta configuración, el endpoint devuelve un estado controlado y el buscador manual sigue disponible. Cambiar variables del Preview requiere un nuevo deployment de `integration/backyard-current` para que surtan efecto.

El requisito de base de datos es `20260904104145_rules_ai_rate_limit.sql`, cuyo estado debe verificarse en el [ledger canónico de migraciones](./CANONICAL_MIGRATION_LEDGER_2026-09-24.md) y en la ref QA aislada antes de habilitar el flag. No lo reapliques por nombre o por una lista histórica y no lo apliques a Production siguiendo esta guía. El límite de costo es persistente y atómico; solo `service_role` puede usar su RPC. La tabla guarda un HMAC del origen y contadores por ventana, nunca el texto de las consultas, scores, apuestas, históricos ni datos personales.

Las respuestas son informativas: en competencia, el Comité o árbitro tiene la decisión final.
